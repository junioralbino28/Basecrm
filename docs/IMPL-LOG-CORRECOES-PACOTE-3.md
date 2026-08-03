# IMPL-LOG — Correções do Pacote 3

**Data de fechamento do código:** 2026-08-03  
**Branch:** `feat/funil-construtor`  
**Checkpoint de código:** `553303a`  
**Base do parecer original:** `041d963`  
**Estado:** **CORREÇÕES IMPLEMENTADAS E TESTADAS LOCALMENTE · AGUARDANDO REVERIFICAÇÃO INDEPENDENTE DO CLAUDE**

> Este documento é o handoff do ciclo pedido pelo Junior: o Codex implementou,
> testou, encontrou regressões adicionais, corrigiu e repetiu os gates. Ele não
> substitui uma revisão independente e não autoriza deploy. Produção não foi
> acessada, nenhuma migration foi enviada para ambiente remoto e não houve push,
> merge ou `db reset`.

## 1. Resultado executivo

O bloqueio técnico original do Pacote 3 foi tratado em uma sequência de nove
checkpoints. O motor agora possui uma fonte canônica para comissão, histórico de
remuneração, cálculo de fixo/híbrido, snapshot financeiro por atendimento,
pagamento idempotente e serializado, vínculos same-org, escritas compostas
transacionais, tenant ativo explícito e arquivamento obrigatório de
especialidades.

Durante a validação final, quatro lacunas reais ainda foram encontradas e
corrigidas antes deste handoff:

1. a proteção de regras históricas havia regredido para `CURRENT_DATE`, sujeito
   ao fuso do banco;
2. um colaborador `pay_type='fixed'` ainda recebia comissão se existisse regra;
3. os serviços de profissionais e regras de comissão ainda aceitavam tenant
   opcional ou inferido e mutavam só por `id`;
4. um administrador autenticado ainda conseguia apagar uma especialidade
   diretamente e disparar cascatas, embora a tela já arquivasse.

Os quatro defeitos tiveram teste vermelho antes da correção e teste verde
depois. A checagem factual do próprio handoff encontrou ainda uma quinta falha:
uma correção retroativa de snapshots se apoiava em histórico presumido. Ela foi
removida em `553303a` antes desta entrega. A suíte final executou **231 arquivos
e 1.103 testes**, todos aprovados, contra o Supabase local real.

## 2. Documentos que formam o contexto

Ler nesta ordem:

1. [`REVIEW-PACOTE-3.md`](./REVIEW-PACOTE-3.md) — parecer adversarial original,
   com P3-01 a P3-24;
2. [`ADJUDICACAO-PACOTE-3.md`](./ADJUDICACAO-PACOTE-3.md) — aceite do bloqueio e
   ordem de correção;
3. [`DECISOES-JUNIOR-FINANCEIRO-29-07.md`](./DECISOES-JUNIOR-FINANCEIRO-29-07.md)
   — decisões que destravaram P3-03 e P3-16;
4. este documento — implementação, falhas encontradas, provas e pendências;
5. futuro `docs/REVIEW-CORRECOES-PACOTE-3.md` — reservado para a reverificação
   independente do Claude; ainda não existe.

## 3. Decisões de produto aplicadas

- A regra de comissão é escolhida pela data do atendimento, `performed_at`.
- Comissão é devida integralmente na competência do atendimento, mesmo quando o
  cliente ainda não pagou. `paid_at` continua sendo data de caixa.
- `fixed` é somente remuneração fixa; `commission` é somente comissão; `both`
  soma as duas parcelas.
- Salário fixo é versionado por data e rateado por dias quando muda no meio do
  mês. Comissão é evento: cada atendimento congela a regra vigente naquele dia.
- Regra histórica não é editada por cima; mudança normal cria nova vigência.
- Especialidade é arquivada (`active=false`), não apagada pelo cliente.
- O schema mantém `professionals`/`professional_id`. “Colaborador” é o rótulo
  neutro decidido para a UI, mas a varredura completa ainda não foi feita:
  existem ocorrências visíveis de “Profissionais”/“profissional”.

## 4. Checkpoints da correção

| Commit | Entrega |
|---|---|
| `c00f505` | Testes administrativos passam a recusar destino de produção no próprio helper, mesmo quando executados fora do runner local. |
| `2222b7f` | Data escolhida no pagamento entra nas dependências da callback; teste exige o `paidAt` exato. |
| `e1af02c` | FKs compostas same-org, tenant explícito em serviços já cobertos e ACLs menores. |
| `563f5e3` | Histórico financeiro, resolvedor canônico, snapshot de comissão e RPC idempotente de pagamento. |
| `fc3a046` | Sincronização de especialidades, vínculos e exceções passa para RPCs transacionais. |
| `05e5b59` | Contratos de mocks e compatibilidade dos testes são alinhados ao tenant/RPC. |
| `01e0fd9` | Correção adjacente de TLS e dependências vulneráveis (`postcss`/`sharp`). |
| `cba6f7f` | Hardening financeiro e operacional: permissões, snapshots, locks, paginação, invalidação, manutenção e desambiguação PostgREST. |
| `86e6d60` | Fechamento residual: fuso histórico, fixed-only, concorrência/overpay provados, tenant fail-closed e bloqueio de hard delete de especialidade. |
| `553303a` | Remove a reescrita automática de snapshots legados baseada em histórico presumido; saneamento retroativo passa a exigir preflight. |

## 5. Migrations novas do ciclo de correção

| Versão | Papel |
|---|---|
| `20260803000000_p3_multitenant_hardening.sql` | FKs same-org, índices compostos e menor privilégio das tabelas/vínculos. |
| `20260803010000_p3_financial_history.sql` | Versões de remuneração, coerência de regra e proteção histórica. |
| `20260803020000_p3_canonical_finance_resolver.sql` | IDs canônicos, resolvedor compartilhado, snapshot e relatórios convergentes. |
| `20260803030000_p3_commission_payment_rpc.sql` | Idempotência, lock, saldo, update/delete protegidos e fechamento do REST direto. |
| `20260803040000_p3_atomic_team_writes.sql` | Escritas compostas em uma transação. |
| `20260803050000_p3_postgrest_relationship_disambiguation.sql` | Remove FKs simples redundantes que confundiam o PostgREST. |
| `20260803060000_p3_operational_maintenance.sql` | Manutenção interna e cascatas necessárias. |
| `20260803070000_p3_internal_finance_maintenance.sql` | Bypass financeiro restrito a papéis internos. |
| `20260803080000_p3_historical_rule_timezone.sql` | Restaura o dia civil de São Paulo na imutabilidade histórica. |
| `20260803090000_p3_fixed_only_commission_guard.sql` | Impede comissão em novos fatos de contrato somente fixo, sem reescrever snapshots legados automaticamente. |
| `20260803100000_p3_specialty_archive_guard.sql` | Revoga `DELETE/TRUNCATE` de `authenticated` em especialidades e elimina a policy de exclusão. |

As versões `0800`, `0900` e `1000` foram aplicadas incrementalmente no Supabase
local durante este fechamento. O banco local recebeu uma revisão anterior da
`0900`, que ainda continha o UPDATE retroativo depois removido em `553303a`;
como o arquivo final só retira DML e preserva as mesmas funções, os testes focais
e a suíte completa foram repetidos, mas a cadeia final ainda deve ser aplicada
do zero em uma instância local descartável na reverificação. Não houve reset do
banco atual.

## 6. O que mudou por área

### 6.1 Uma verdade financeira

- `resolve_commission_amount` concentra a escolha da regra e é consumido pelo
  snapshot do atendimento.
- `get_commission_report` e `get_net_result` usam o mesmo
  `atendimentos.commission_amount`; o mesmo fato não produz mais duas comissões.
- A comissão é congelada na criação/alteração relevante do atendimento. Mudança
  posterior de nome ou vínculo não reabre o fato passado.
- O resolvedor usa `performed_at`, não `paid_at`, para escolher vigência.
- Contrato `fixed` retorna comissão zero. `both` continua somando fixo e
  comissão.
- O fixo consulta `professional_compensation_versions` e rateia mudanças dentro
  do mês.

### 6.2 Pagamento de comissão

- Criação passa por `record_commission_payment`.
- Cada intenção usa UUID idempotente; retry idêntico devolve a mesma linha.
- A mesma chave com payload divergente é recusada.
- Locks distintos protegem a chave e o saldo do colaborador/período.
- Overpay é validado dentro da transação, não apenas pela tela.
- INSERT/UPDATE/DELETE REST autenticados deixam de ser o caminho de mutação.
- Corrigir data e desfazer usam RPCs protegidas.
- “Último pagamento” é ordenado por `created_at DESC, id DESC`, não pela data
  editável `paid_at`.

### 6.3 Histórico e vigência

- Regras financeiras históricas não aceitam reescrita de campos de domínio nem
  exclusão pelo cliente.
- O corte usa `(now() AT TIME ZONE 'America/Sao_Paulo')::date`.
- O bypass existe somente para `postgres`/`service_role`, para migrations e
  manutenção controlada.
- Remuneração fixa, forma de pagamento e estado do colaborador possuem versões
  por data.
- Profissional hoje inativo continua aparecendo quando há fatos, pagamento ou
  remuneração histórica no período.

### 6.4 Isolamento multitenant

- Vínculos de profissional, especialidade e produto possuem FKs compostas
  `(organization_id, id)`.
- Serviços de profissionais e regras de comissão agora exigem
  `organizationId: string`; não consultam mais o perfil para inferir tenant.
- Leituras, updates e deletes filtram `organization_id` além do `id`.
- Hooks recusam mutation sem tenant ativo antes de chamar o serviço.
- Helpers e RPCs internos tiveram `PUBLIC`, `anon` e, quando aplicável,
  `authenticated` revogados.

### 6.5 Escritas compostas e catálogos

- Sincronizar especialidades e ações em massa ocorre dentro de RPCs
  transacionais, com validação same-org e advisory lock.
- Paginação determinística evita o teto silencioso de 1.000 vínculos.
- Especialidade removida na UI é arquivada. O banco agora também impede o
  cliente autenticado de contornar esse fluxo com DELETE/TRUNCATE.
- Arquivar preserva `professional_specialties`, `specialty_products`, snapshots
  e auditabilidade.

### 6.6 Permissões e cache

- Leitura de relatório e mutação financeira são capacidades separadas.
- A UI esconde remuneração, comissões e controles de pagamento quando
  `settings.finance` está negada; RPCs/policies aplicam a mesma decisão.
- Mudanças em atendimento, regras, remuneração, custos, taxas e vínculos
  invalidam os roots financeiros derivados.

## 7. Falhas encontradas durante a implementação

### F1 — data histórica dependia do timezone do banco

**Como apareceu:** a migration de manutenção `0600` recompilou o trigger usando
`CURRENT_DATE`, desfazendo a normalização explícita para São Paulo.

**Correção:** migration `0800` recompila `protect_historical_commission_rule`
com o dia civil de `America/Sao_Paulo` e mantém o bypass interno restrito.

**Prova:** `p3HistoricalRuleTimezoneMigration.test.ts`.

### F2 — contrato somente fixo ainda recebia comissão

**Teste vermelho:** um colaborador `fixed` com regra de 20% recebeu snapshot de
R$ 200; o esperado era R$ 0.

**Causa:** o resolvedor escolhia regras sem consultar o `pay_type` histórico.

**Correção:** `professional_pay_type_at(...)`; `fixed` retorna zero antes da
busca de regra para fatos novos.

**Prova verde:** o mesmo cenário retorna comissão zero e o salário de junho,
com mudança de R$ 1.000 para R$ 2.000 em 16/06, fecha em R$ 1.500.

**Correção da própria correção:** a primeira versão da `0900` também zerava
snapshots existentes quando `professional_pay_type_at` retornava `fixed`. Isso
era inseguro: o baseline `1900-01-01` representa o cadastro conhecido hoje e
não prova o contrato real no passado. O teste foi invertido para proibir UPDATE
em massa e `553303a` removeu o bloco. Snapshot legado exige auditoria e
mapeamento por período.

### F3 — tenant ainda era opcional em dois serviços

**Teste vermelho:** o contrato encontrou `getCurrentOrganizationId`, parâmetros
opcionais e updates/deletes filtrados somente por `id`.

**Correção:** tenant obrigatório e sanitizado em serviço/hook; todas as queries
relevantes usam `organization_id`; ausência do tenant falha antes da escrita.

**Prova:** 17 testes focais de serviços/contratos, TypeScript e suíte completa.

### F4 — hard delete de especialidade ainda estava aberto

**Teste vermelho real:** `clinic_admin` apagou a especialidade; o teste esperava
erro `42501` e recebeu sucesso. As cascatas removiam os dois tipos de vínculo e
podiam deixar o espelho legado do profissional incoerente.

**Correção:** migration `1000` revoga `DELETE, TRUNCATE` de `authenticated` e
remove `specialties_delete_by_admin`. `service_role` permanece disponível para
manutenção interna.

**Prova verde real:** o DELETE recebe `42501`; `UPDATE active=false` funciona;
os vínculos com profissional e produto continuam com contagem 1.

### F5 — lacunas de prova, não defeitos novos

- Foi adicionado um teste com dois pagamentos simultâneos do saldo total:
  exatamente um confirma e o outro recebe a constraint de saldo.
- Foi adicionado overpay real e não apenas inspeção de SQL.
- O teste de vigência agora cruza as datas: atendimento em 10/04, recebimento em
  20/04 e regra nova em 15/04; vence a regra antiga.

## 8. Estado P3-01 a P3-24

| Item | Estado no checkpoint `553303a` | Evidência/ressalva |
|---|---|---|
| P3-01 | **Implementado e testado** | Os dois relatórios consomem o mesmo snapshot; integração exige paridade. |
| P3-02 | **Implementado e testado** | Idempotência, payload divergente, overpay e corrida simultânea foram exercitados no banco real. |
| P3-03 | **Implementado e testado para fatos novos** | Fixo, híbrido, fixed-only e mudança no meio do mês cobertos. Snapshots legados não são alterados sem preflight. |
| P3-04 | **Implementado** | Seis FKs same-org; rejeição cross-org exercitada em vínculos e fluxo financeiro, demais relações também cobertas pelo DDL. |
| P3-05 | **Implementado; prova dedicada desejável** | SQL inclui inativo com fato/pagamento/fixo histórico; não há teste isolado somente para desativação após fechamento. |
| P3-06 | **Caso original corrigido; borda adjudicável** | IDs e `specialty_products` ligam regra ao procedimento. Produto em várias especialidades ainda precisa de semântica explícita. |
| P3-07 | **Implementado; prova comportamental pendente** | Trigger histórico e fuso corrigidos; o teste atual inspeciona o contrato, mas não tenta update/delete autenticado real. |
| P3-08 | **Invariante resolvida no banco** | Constraint/trigger impedem `amount` e `percent` divergentes. Hook legado de update continua sem uso pela UI nova e merece remoção futura. |
| P3-09 | **Implementado e testado** | Tenant explícito, fail-closed e filtros em leitura/mutação. |
| P3-10 | **Resolvido para linhas canônicas/snapshots** | Regras mapeadas usam IDs; regra legada cujo nome não pôde ser mapeado exige preflight antes do deploy. |
| P3-11 | **Atomicidade resolvida; concorrência de UX permanece** | RPC+lock evitam estado parcial. Duas abas ainda seguem “última gravação vence”, sem CAS/versão esperada. |
| P3-12 | **Implementado** | Ações em massa são batch/transacionais e a UI reconcilia erro. |
| P3-13 | **Implementado e testado** | Capacidade de mutação financeira aplicada na UI e servidor. |
| P3-14 | **Implementado e testado** | Teste confere o ISO exato da data selecionada. |
| P3-15 | **Implementado e testado** | Helper recusa URL/ref de produção fora do runner também. |
| P3-16 | **Implementado e testado** | `performed_at` vence mesmo quando `paid_at` cruza a vigência. |
| P3-17 | **Determinístico, sem unicidade lógica** | `id DESC` fecha o empate técnico. Impedir duas regras do mesmo escopo/data requer regra de produto e saneamento prévio. |
| P3-18 | **Não remediável automaticamente** | Migration histórica divide nomes com vírgula. Dados já transformados não permitem reconstruir o original; exige preflight/mapeamento do alvo. |
| P3-19 | **Implementado e testado em serviço** | Paginação de 1.001 vínculos exercitada; falta prova real específica contra PostgREST com esse volume. |
| P3-20 | **Implementado e testado** | Undo usa criação+ID, não `paid_at`. |
| P3-21 | **Implementado e testado no banco real** | Cliente autenticado não apaga; arquivamento preserva vínculos. |
| P3-22 | **Implementado** | Invalidações cobrem os insumos financeiros; prova estática. |
| P3-23 | **Implementado** | Helpers internos não ficam executáveis por `PUBLIC/anon/authenticated` indevido. |
| P3-24 | **Implementado** | Revogações amplas e grants mínimos; `DELETE/TRUNCATE` de especialidade também fechados em `1000`. |

## 9. Validação executada

### Banco e comportamento

- Migrations `0800`, `0900` e `1000` aplicadas incrementalmente no Supabase
  local: **PASS**.
- Testes financeiros focais — fixed-only, regra histórica, vigência,
  concorrência e overpay: **4 arquivos / 20 testes, PASS**.
- Serviços de tenant e compatibilidade: **4 arquivos / 17 testes, PASS**.
- Arquivamento de especialidade: **2 testes estáticos + 5 testes locais, PASS**.
- `supabase db lint --local`: **nenhum erro de schema**.

### Gate completo

- `npm run test:local`: **231/231 arquivos, 1.103/1.103 testes, PASS**.
- Duas execuções completas após o fechamento: **1103/1103** em ambas; a última
  durou **230,36 s**.
- `tsc --noEmit`: **PASS**.
- ESLint `--max-warnings 0`: **PASS**.
- `next build`: **PASS**, 106 páginas estáticas geradas.
- `git diff --check` antes do checkpoint: **PASS**.

Ruídos conhecidos observados, sem falha do gate:

- um `DELETE deal_notes` retorna 400 no teardown;
- três tentativas de conexão a `localhost:3000` retornam `ECONNREFUSED` quando o
  dev server não está rodando;
- requisições esperadas de testes sem autenticação retornam 401.

### Segurança — resultado honesto

- `npm audit`: **0 vulnerabilidades** em 835 dependências contabilizadas.
- Semgrep 1.170.1: **0 achados** em 929 caminhos, mas com **2 avisos de parsing
  parcial** (`CreateBoardModal.tsx` e `CommissionsManager.test.tsx`). Portanto,
  não é cobertura completa desses arquivos.
- Gitleaks 8.30.1, modo Git: **716 commits, ~11,06 MB, 0 vazamentos**.
- O runner canônico `audit-seg.sh` **não produziu `status.json` completo**:
  atingiu dez minutos durante `gitleaks dir`. Pelo critério fail-closed, o
  baseline geral é **INVÁLIDO/INCONCLUSIVO**, apesar dos resultados individuais
  acima.
- Trivy, Snyk e os gates manuais fora deste escopo não foram executados.

Isto não é uma “auditoria completa dos gates G1–G32” e não autoriza afirmar que
o sistema está seguro. As provas específicas cobrem, entre outros, isolamento
multitenant, IDOR same-org, autorização financeira, invariantes/concorrência de
pagamento e superfície das RPCs alteradas.

## 10. O que não foi feito

- Nenhum acesso ao Supabase remoto ou produção.
- Nenhum deploy, push, merge ou alteração de branch remota.
- Nenhum `db reset` local.
- Nenhuma tentativa de reconstruir nomes antigos separados por vírgula.
- Nenhuma decisão unilateral sobre duplicidade lógica de regras ou produto em
  várias especialidades.
- Nenhuma ampliação para o futuro catálogo de formas de pagamento/financiamento;
  isso continua sendo outra spec.

## 11. Pendências reais antes de deploy

Estas pendências não impedem o uso local para teste, mas impedem chamar o pacote
de “aprovado para produção”:

1. **Reverificação independente do Claude** em novo parecer.
2. **P3-18:** consultar o alvo e preparar mapeamento/preflight dos nomes com
   vírgula. Uma heurística não pode apagar dado de produção.
3. **P3-10:** listar regras legadas sem `specialty_id`/`product_id` e decidir o
   mapeamento antes da migration.
4. Auditar snapshots fixed-only legados por período. O código final recusa
   correção em massa baseada no estado atual do cadastro.
5. Verificar se algum ambiente já registrou as migrations `0100`–`0400` antes
   das correções que passaram a existir nelas. Supabase registra versão, não
   reaplica o mesmo número; nesse caso, criar migrations compensatórias.
6. Adjudicar P3-06/P3-17: produto em múltiplas especialidades e duplicidade do
   mesmo escopo/data.
7. Decidir se a edição simultânea por duas abas precisa de CAS ou se
   “última gravação vence” é aceitável.
8. Registrar que remuneração tem granularidade diária: duas alterações no mesmo
   dia substituem a versão daquele dia (`ON CONFLICT ... DO UPDATE`).
9. Concluir a varredura de nomenclatura da UI para “colaborador”; o schema não
   muda, mas rótulos antigos ainda aparecem.
10. Resolver ou aceitar conscientemente o aviso de rastreamento amplo do build:
   `next.config.ts` → `lib/installer/edgeFunctions.ts` → rota do instalador.
11. Custos fixos e taxas ainda são editados in-place e podem recalcular um
   período antigo; isso era achado adjacente do parecer, não foi escondido nem
   incluído silenciosamente neste pacote.
12. O baseline canônico de segurança precisa concluir integralmente ou ter seu
   escopo de árvore corrigido sem deixar de varrer o conteúdo versionado.

## 12. Roteiro de reverificação do Claude

1. Confirmar branch `feat/funil-construtor` e checkpoint `553303a`.
2. Ler os quatro documentos da seção 2 e não reutilizar o veredito antigo como
   aprovação automática.
3. Usar Supabase descartável/local comprovado; nunca carregar `.env.local`
   remoto para testes de escrita.
4. Conferir as migrations `0000`–`1000`, com foco nos cabeçalhos
   `SECURITY DEFINER`, `search_path=''`, gates e ACLs.
5. Reexecutar `npm run test:local` e ler a contagem final; `vitest run` sozinho
   pula integrações.
6. Reproduzir manualmente: duas contas financeiras iguais, retry/payload
   divergente, corrida/overpay, fixed-only, mudança de fixo no meio do mês,
   `performed_at` cruzando vigência, cross-org e hard delete de especialidade.
7. Revisar especialmente as ressalvas P3-05, P3-06, P3-07, P3-10, P3-11,
   P3-17 e P3-18.
8. Registrar o resultado em `docs/REVIEW-CORRECOES-PACOTE-3.md`, separando
   `PASS`, `FAIL`, `NÃO TESTADO` e decisão de produto.
9. Só alterar a fila para **REVERIFICADO/APROVADO** depois desse parecer. Até
   lá, o estado correto é **correções implementadas, aguardando reverificação**.

## 13. Handoff ao Junior

O Junior não precisa executar os passos técnicos acima. O código foi fechado e
testado localmente pelo Codex conforme solicitado. Quando o Claude retornar, o
trabalho dele é revisão independente e eventual reprodução; o Junior entra
apenas se uma das quatro decisões de produto/resolução de dados da seção 11
exigir escolha de negócio.
