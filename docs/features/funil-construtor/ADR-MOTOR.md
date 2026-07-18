# ADR-001: Motor durável de automações

**Status:** Aceito  
**Data:** 2026-07-18  
**Decisores:** Junior, Claude e Codex  
**Escopo:** Entrega A, F0

## Contexto

O Construtor de Funil executará sequências multi-tenant com efeitos externos no
WhatsApp. Um tick duplicado, retry cego ou mudança retroativa de definição pode
enviar mensagem duplicada ou errada para um lead real.

As restrições que moldam a decisão são:

- Vercel no plano Hobby, sem cron frequente e com duração limitada de função;
- Supabase Cron via `pg_cron` + `pg_net` como gatilho best-effort;
- Evolution sem transação distribuída com o Postgres;
- worker na VPS já aprovado para compressão com ffmpeg;
- nenhuma mensagem real durante a Entrega A;
- banco compartilhado entre tenants, com RLS e permissões granulares;
- publicação humana e versões em andamento imutáveis.

## Decisão

O motor será um state machine persistido no Postgres, com autoria normalizada,
versões publicadas imutáveis, outbox durável e efeitos externos executados por um
worker da VPS.

### Boundary de execução: worker da VPS

O dispatch de automações rodará **na mesma VPS do worker de mídia**, mas não no
mesmo processo nem na mesma fila:

- `automation-dispatcher`: processo leve, orientado a I/O, responsável por
  consumir `automation_jobs`;
- `media-processor`: processo separado, com concorrência e limites próprios,
  responsável por ffmpeg.

Compartilhar host, deploy e observabilidade reduz a infraestrutura operacional.
Separar processos, filas e limites impede que um transcode consuma CPU/memória e
atrase mensagens.

O fluxo será:

```text
pg_cron (5 min)
  -> pg_net
    -> POST /api/internal/automations/tick
      -> materializa/reconcilia jobs vencidos
      -> retorna sem chamar Evolution

automation-dispatcher (VPS)
  -> POST /api/internal/automations/jobs/claim
    -> recebe lote pequeno com lease
  -> executa o efeito externo
  -> POST /api/internal/automations/jobs/:id/complete
    -> finaliza por compare-and-set
```

O worker acessará o CRM por endpoints internos autenticados por segredo próprio.
Ele não receberá `service_role` do Supabase nem aceitará `organization_id` como
autoridade externa. O servidor resolve tenant, credenciais e payload a partir do
job persistido. Respostas e logs devem redigir credenciais.

Na Entrega A, o dispatcher só exercita `simulation`: nenhuma credencial Evolution
é devolvida e nenhum efeito externo é chamado.

### Por que o tick não executa o dispatch

Manter o envio dentro do tick seria mais simples no primeiro commit, mas:

- acoplaria a vazão ao limite de função da Vercel Hobby;
- tornaria timeout de rede parte da duração do cron;
- faria backlog competir dentro de um lote curto;
- criaria duas infraestruturas de background quando o worker da VPS já é
  necessário para mídia.

O tick continua necessário como scheduler e reconciliador. O worker é o executor.

## State machines

### Automação

```text
draft -> published -> paused -> published
   |         |          |
   +---------+----------+-> archived
```

- `draft`: editável, não inscreve nem executa;
- `published`: possui `published_version_id`;
- `paused`: não cria novas inscrições/jobs; inscrições existentes ficam
  preservadas;
- `archived`: terminal para novas operações, sem apagar histórico.

`delivery_mode` é ortogonal ao lifecycle:

```text
simulation | test | live
```

### Inscrição

```text
active -> waiting -> active
   |         |
   |         +-> paused -> waiting
   +------------> paused -> active
   |
   +-> done
   +-> exited
   +-> failed
   +-> cancelled
```

Estados terminais: `done`, `exited`, `failed`, `cancelled`.

- `done`: chegou ao fim do grafo;
- `exited`: saiu por regra de produto;
- `failed`: falha terminal do motor;
- `cancelled`: cancelamento operacional explícito.

### Job/outbox

```text
pending -> leased -> sent
   ^          |       |
   |          |       +-> terminal
   |          +-> simulated
   |          +-> unknown
   |          +-> failed -> pending
   |                         |
   +------ lease expirado ---+

failed -> dead_letter
unknown -> revisão/reconciliação explícita
```

- somente `pending` vencido ou `leased` com lease expirado pode ser reclamado;
- `sent`, `simulated` e `dead_letter` são terminais;
- `unknown` nunca recebe retry cego;
- `attempt_count` e backoff limitam retry;
- finalização exige `id + lease_owner + estado leased`.

### Espera

```text
pending -> resolved
pending -> expired
```

Resposta e timeout fazem compare-and-set sobre a mesma linha. Somente o primeiro
`UPDATE ... WHERE status = 'pending' RETURNING` vence.

## Versionamento e publicação

O draft vive em:

- `automations`;
- `automation_steps`;
- `automation_step_edges`.

Publicar é uma única transação:

1. validar nós, arestas, variáveis, destinos e regras por tipo;
2. compilar definição canônica;
3. calcular `definition_hash`;
4. inserir uma linha imutável em `automation_versions`;
5. atualizar `automations.published_version_id` e lifecycle.

`automation_enrollments` aponta para `automation_version_id` e guarda
`current_step_key`. Nunca aponta para um passo editável do draft.

Versões publicadas não aceitam `UPDATE` nem `DELETE` operacional. Restaurar uma
versão cria novo draft/publicação; não desfaz efeitos já executados.

## Grafo

Nós e caminhos são entidades separadas:

- `automation_steps`: `step_key`, tipo, config e `sort_key` de UI;
- `automation_step_edges`: origem, outcome e destino.

`sort_key` nunca decide execução. A transição usa arestas explícitas com outcomes:

`success | answered | timeout | failed | true | false | otherwise`

O compiler rejeita:

- passo órfão;
- destino inexistente ou de outra automação/tenant;
- outcome inválido para o tipo;
- mais de uma aresta para outcome singular;
- ciclo não permitido;
- fluxo sem entrada ou sem caminho terminal.

## Idempotência e semântica de entrega

O sistema oferece **effectively once**, não exactly-once distribuído.

Invariantes:

1. todo efeito externo nasce como `automation_job` persistido;
2. `idempotency_key` possui constraint `UNIQUE`;
3. mensagem/conversa pending, job e attempt são persistidos antes do efeito;
4. claim usa lease e compare-and-set;
5. timeout ambíguo depois do POST vira `unknown`;
6. nenhum erro ambíguo dispara tentativa com outro payload;
7. evento duplicado do webhook é barrado por constraint no banco;
8. um tick perdido é reconciliado pelo próximo usando `available_at <= now()`;
9. mensagem automática não muda a thread para takeover humano.

## Safe mode

Envio real exige todos os gates:

1. `AUTOMATION_LIVE_SENDS_ENABLED === "true"`;
2. organização com `automation_live_enabled = true`;
3. automação com `delivery_mode = live`;
4. canal ativo e aprovado para compliance;
5. versão publicada.

Ausência, erro ou valor desconhecido bloqueia envio.

No modo `test`, o destinatário precisa estar em allowlist server-side. No modo
`simulation`, o sistema registra payload renderizado e decisão, mas:

- não resolve/devolve credencial Evolution;
- não chama adapter externo;
- não fabrica provider message ID.

## Multi-tenancy e autorização

- toda tabela operacional possui `organization_id`;
- FKs compostas ou triggers de integridade impedem referência cruzada entre
  tenants;
- RLS compõe `can_access_organization` com `has_permission`;
- editar draft/publicar exige `automation.edit`;
- pausar, retomar, testar ou alterar delivery mode exige `automation.operate`;
- worker usa endpoints internos e o tenant é derivado do job no servidor;
- logs e attempts são append-only para usuários comuns.

## Invariantes consolidados

1. Republicar nunca altera inscrições existentes.
2. Rollback restaura definição, nunca efeitos.
3. IA nunca publica.
4. Nenhum envio existe fora do outbox.
5. Job duplicado não duplica efeito conhecido.
6. Resultado ambíguo não recebe retry automático.
7. Safe mode falha fechado em todas as camadas.
8. Tenant do job nunca vem do browser/worker como fonte de verdade.
9. Automação e takeover humano são estados distintos.
10. Conteúdo efetivo e variantes de mídia da versão publicada são imutáveis.

## Opções consideradas

### Dispatch no tick da aplicação

**Vantagens:** menos componentes no primeiro lote, reuso direto do runtime Next.js.  
**Desvantagens:** limite Hobby, backlog dentro da função, timeout externo no cron,
infra de background duplicada quando o worker de mídia entrar.

### Dispatch e ffmpeg no mesmo processo

**Vantagens:** um único processo para operar.  
**Desvantagens:** CPU/memória do ffmpeg compete com mensagens; falha ou restart de
mídia interrompe dispatch; perfis de concorrência incompatíveis.

### Mesmo host, processos e filas separados — escolhida

**Vantagens:** remove limite da Vercel, consolida host/observabilidade e isola
recursos críticos.  
**Desvantagens:** worker e endpoints internos passam a existir antes da fase de
mídia; exige monitoramento do processo e rotação do segredo interno.

## Consequências

Fica mais fácil:

- reconciliar tick perdido;
- escalar dispatch sem alterar scheduler;
- testar o motor em simulação;
- operar mídia e mensagens na mesma VPS com isolamento;
- demonstrar idempotência e histórico.

Fica mais difícil:

- há um processo de worker adicional para operar;
- live dispatch depende de healthcheck e observabilidade da VPS;
- contratos claim/complete precisam de autenticação e CAS rigorosos.

## Rollback operacional

Sem apagar dados:

1. desabilitar `AUTOMATION_LIVE_SENDS_ENABLED`;
2. revogar/rotacionar o segredo do worker;
3. desabilitar o job `pg_cron`;
4. pausar automações;
5. preservar jobs, attempts, versões e enrollments para diagnóstico.

As migrations da Entrega A são aditivas. Nenhuma tabela existente é removida.

