# Construtor de Funil — Opinião do Codex

> Parecer arquitetural registrado em 2026-07-18. Esta rodada não autoriza código,
> migration, teste contra banco, push ou deploy.
>
> Base lida: `SPEC.md`, `VISAO-PRODUTO.md`, `PLAN.md`,
> `PESQUISA-KOMMO.md`, `PESQUISA-GHL.md`, `AGENTS.md`,
> `docs/basecrm-engineering-playbook.md`, skills `senku-fullstack`,
> `evolution-api`, `engineering:architecture`, `engineering:system-design` e
> `cron-jobs`, além dos pontos existentes de envio, webhook, conversa e Storage.

## Veredito executivo

Concordo com o produto, com a lista vertical, com entrada por etiqueta, com a
separação entre editar e operar, com publicação humana e com o princípio de que
uma inscrição não muda de rota depois de iniciada.

Eu **não começaria F1 com o schema do PLAN exatamente como está**. Antes da
primeira migration, faria quatro correções estruturais:

1. publicar definições imutáveis em `automation_versions` e fazer a inscrição
   apontar para uma versão, em vez de copiar o mesmo JSON para cada inscrição;
2. separar passos de arestas: `automation_steps` guarda nós e
   `automation_step_edges` guarda os caminhos; `order` serve apenas à UI;
3. criar uma fila/outbox durável antes de ligar o agendador, porque lock no
   enrollment não elimina duplicidade entre banco e Evolution;
4. modelar mídia em bucket próprio, com original, variantes imutáveis e jobs de
   processamento; o bucket `deal-files` atual é preso a `deal_id` e não representa
   uma biblioteca global.

Essas mudanças preservam as decisões travadas do SPEC. Elas corrigem a forma de
implementá-las.

## 1. Agendador: Vercel Cron ou pg_cron + pg_net?

### Recomendação

Usar **Vercel Cron como gatilho**, condicionado à confirmação de que o projeto
está em plano Pro ou Enterprise, com tick a cada **5 minutos**.

O plano da conta não é verificável pelo repositório atual: não há `vercel.json`
nem `.vercel/project.json` nesta working tree. Isso precisa virar gate explícito
antes de F3. No Hobby, cron mais frequente que uma vez por dia falha no deploy;
nesse caso, usar Supabase Cron/`pg_cron` chamando o mesmo endpoint de tick a cada
5 minutos, sem alterar o motor.

Cinco minutos são aceitáveis para uma sequência D+0 a D+25. Quinze minutos
também funcionariam para os dias longos, mas pioram a percepção em delays curtos,
testes e retomadas; eu não adotaria 15 minutos como padrão. Resposta do lead não
espera o tick: entra pelo webhook imediatamente.

### O cron não pode ser a garantia de entrega

Vercel documenta que o cron:

- é best effort e pode perder ou duplicar uma invocação;
- pode sobrepor execuções se uma durar mais que o intervalo;
- não faz retry automático quando a função falha.

Portanto, a rota não deve “buscar enrollment e enviar”. O desenho seguro é:

1. o tick chama uma RPC curta de claim;
2. a RPC seleciona jobs vencidos com `FOR UPDATE SKIP LOCKED`, atribui
   `lease_owner`/`lease_until` e devolve um lote limitado;
3. o efeito externo roda fora da transação;
4. a finalização usa compare-and-set: somente o dono do lease e a tentativa
   esperada podem concluir;
5. lease expirado volta a ser elegível, com backoff e limite de tentativas;
6. um tick perdido é reconciliado pelo próximo, que busca todo job
   `available_at <= now()`, não apenas os criados desde o último tick.

Eu criaria `automation_jobs` como fila/outbox, separada de
`automation_step_attempts` (ou `automation_runs`) como auditoria. Campos mínimos
da fila: `organization_id`, `enrollment_id`, `version_id`, `step_key`,
`job_type`, `idempotency_key`, `status`, `available_at`, `lease_owner`,
`lease_until`, `attempt_count`, `last_error` e timestamps. A chave de
idempotência deve ter índice `UNIQUE`.

Uma trava global do tick é útil para reduzir concorrência, mas não substitui
claim por job nem idempotência por efeito.

## 2. Snapshot JSONB por inscrição ou tabela de versões?

### Recomendação

Usar um **híbrido com `automation_versions`**:

- o draft continua editável em `automations` + passos + arestas;
- publicar compila o draft para uma definição canônica em JSONB;
- cada publicação cria uma linha imutável em `automation_versions`;
- `automations.published_version_id` aponta para a versão atual;
- `automation_enrollments.automation_version_id` aponta para a versão em que o
  lead entrou;
- a inscrição guarda `current_step_key`, não FK para um passo vivo do draft.

Campos úteis da versão: `id`, `organization_id`, `automation_id`, `version`,
`definition`, `definition_hash`, `created_by`, `created_at` e `published_at`.
Uma versão publicada não aceita `UPDATE` nem `DELETE` operacional.

Isso mantém o invariante “a inscrição carrega snapshot imutável” sem repetir o
fluxo inteiro em milhares de enrollments. Também resolve desde o começo os três
conceitos observados na pesquisa: **Save ≠ Publish ≠ Version**.

O JSON publicado precisa conter o conteúdo efetivo dos templates, configurações
validadas, arestas e chaves dos passos. Se guardar apenas `template_id`, uma
edição futura no template alteraria retroativamente uma versão publicada.

`automation_runs.step_id` também não deve apontar para um passo mutável. Deve
registrar `version_id + step_key`. O mesmo vale para a posição atual da inscrição.

## 3. Lista encadeada ou `order` inteiro?

### Recomendação

Nenhuma das duas deve ser a fonte de verdade da execução. Usar:

- `automation_steps`: os nós;
- `automation_step_edges`: as transições;
- `order` ou `sort_key`: somente apresentação na lista vertical.

Uma aresta teria, no mínimo:

`organization_id · automation_id · from_step_id · outcome · to_step_id · order`

Exemplos de `outcome`: `success`, `answered`, `timeout`, `failed`, `true`,
`false`, `otherwise`.

O caminho linear é apenas uma aresta `success`. Condição, espera e falha usam
outcomes adicionais. Um índice único em `(from_step_id, outcome)` impede dois
destinos concorrentes para a mesma saída quando o tipo não permite isso.

`next_step_id` dentro do nó mistura nó e aresta. `branch_config` JSONB esconde
FKs, dificulta RLS/validação e permite destino órfão. `order` como executor quebra
quando há branches e reconvergência. A tabela de arestas sofre menos com inserção
no meio e permite validar “todo caminho termina” antes de publicar.

Ao publicar, nós e arestas são compilados para o JSON imutável da versão. Não há
necessidade de coordenadas XY.

## 4. `wait_for_event`: atribuição por message-id

### Correção necessária

Concordo com a intenção da decisão 11, mas **message-id sozinho não garante a
atribuição de uma resposta comum do WhatsApp**.

O webhook atual recebe `data.key.id`, que é o ID da mensagem inbound. Esse ID
serve para deduplicar o evento, não para descobrir qual outbound originou a
resposta. Só existe correlação direta quando o usuário usa “Responder” sobre uma
mensagem e o payload traz o ID citado, normalmente em
`contextInfo.stanzaId`/quoted message. O parser atual não extrai esse campo.

O mecanismo seguro precisa de três camadas:

1. **Correlação forte quando houver quote:** guardar o
   `provider_message_id` do outbound que abriu a espera e comparar com o ID
   citado no inbound.
2. **Fallback determinístico quando não houver quote:** procurar uma única espera
   pendente para o mesmo `organization_id + channel_connection_id + thread_id`,
   dentro da janela temporal.
3. **Eliminar ambiguidade:** permitir no máximo uma espera de resposta pendente
   por conversa/canal. Se o produto quiser automações concorrentes no futuro,
   terá de definir prioridade ou pausar as demais; sem quote, o protocolo não
   fornece informação suficiente para uma atribuição perfeita.

Eu criaria `automation_waits` em vez de concentrar tudo no enrollment:

`enrollment_id · version_id · step_key · thread_id · channel_connection_id ·
outbound_provider_message_id · status · opened_at · expires_at ·
resolved_by_message_id · resolved_at`

Resposta e timeout disputam a mesma linha. Ambos executam um `UPDATE ... WHERE
status = 'pending' RETURNING ...`; somente quem atualiza primeiro avança o fluxo.
O evento perdedor vira no-op auditado.

Também é necessário um índice único real para deduplicação de webhook. Hoje o
handler faz “SELECT e depois INSERT” em `conversation_messages.metadata`, o que
tem corrida. O ideal é coluna própria e `UNIQUE(channel_connection_id,
provider_message_id)`, ou uma tabela de inbox de eventos com essa chave.

Quando um humano envia mensagem manual, o takeover já deve pausar a inscrição.
Assim a resposta seguinte não tenta avançar silenciosamente um wait antigo — o
bug do GHL é evitado por correlação **e** por estado explícito de takeover.

## 5. Modo seguro

### Recomendação

Não escolher uma única flag. Usar gates em série, todos fail-closed:

1. **ambiente:** `AUTOMATION_LIVE_SENDS_ENABLED` ausente ou diferente de `true`
   bloqueia qualquer envio real;
2. **organização:** capability `automation_live_enabled`, default `false`;
3. **automação:** `delivery_mode = simulation | test | live`, default
   `simulation`;
4. **canal:** conexão ativa, compliance aprovado e credenciais resolvidas;
5. **publicação:** somente versão publicada pode operar em `live`.

Envio real acontece apenas se todos permitirem. Banco ou UI não podem ultrapassar
o kill switch de ambiente.

`enabled` é ambíguo demais para representar draft, publicação, pausa e segurança.
Eu separaria:

- `lifecycle_status = draft | published | paused | archived`;
- `delivery_mode = simulation | test | live`.

No modo `test`, usar allowlist explícita de números. Simulação deve registrar
payload renderizado e decisão tomada, mas nunca fabricar um provider message ID.
Toda troca de modo precisa de permissão `automation.operate` e log de auditoria.

## 6. Copy-on-add e sync bidirecional

### Recomendação

**Última escrita vence não é suficiente.** Ela perde conteúdo sem aviso, e o
problema mais perigoso é justamente uma edição local propagar para vários fluxos.

Manter a decisão de produto “cópia local + sync opcional”, mas modelar o sync com
verdade única:

- `copied`: corpo local independente, default;
- `linked`: o template é a fonte de verdade do draft.

No modo `linked`, editar pelo passo significa editar uma nova revisão do template,
com aviso de quantos drafts serão afetados. Usar `template_revision` e optimistic
concurrency: se a revisão mudou desde que o editor abriu, mostrar conflito em vez
de sobrescrever.

Se o usuário quiser alterar apenas aquele passo, a ação é “desvincular e criar
cópia”. Não recomendo duas fontes editáveis sincronizadas implicitamente.

Publicações continuam imutáveis: ao publicar, o conteúdo efetivo entra no snapshot
da versão. Atualizar um template pode atualizar drafts vinculados, nunca
enrollments em andamento nem versões já publicadas.

## 7. Reuso do executor de conversa

### Correção da premissa

`dispatchConversationMedia` **não cria a mensagem na conversa**. Ele chama
`sendEvolutionMediaMessage`/`sendEvolutionAudioMessage` e devolve metadata. Quem
insere `conversation_messages` hoje é a Route Handler de mensagens.

O executor da automação não deve falar diretamente com Evolution, mas também não
deve chamar a Route Handler como HTTP interno. Recomendo extrair um serviço de
domínio compartilhado, algo no papel de `dispatchConversationOutbound`, usado
pelo envio manual e pela automação.

Esse serviço deve:

1. receber uma `idempotency_key`;
2. persistir mensagem `pending` + job/outbox antes do efeito externo;
3. resolver tenant, conexão, credenciais e URL assinada no servidor;
4. aplicar janela de 24h e regras do canal;
5. chamar os adapters de baixo nível já existentes;
6. atualizar mensagem, attempt e run com provider ID/status;
7. atualizar o resumo da thread sem transformar mensagem automática em takeover
   humano.

Há uma janela de duplicidade no fluxo atual: o envio externo ocorre antes do
`INSERT` da mensagem. Se a Evolution aceitar e o banco falhar depois, um retry
pode enviar de novo. Além disso, `sendEvolutionTextMessage` tenta formatos de
payload alternativos; após timeout ambíguo, uma nova tentativa pode duplicar um
envio que o provedor já aceitou.

Para automação, timeout depois do POST deve virar `delivery_status = unknown`, não
retry cego. Sem idempotency key suportada pelo provedor, “exactly once” absoluto
não existe entre Postgres e Evolution; o objetivo realista é **effectively once**,
com outbox, IDs persistidos, reconciliação e fila de revisão para resultado
ambíguo.

## 8. Fallback de variável

### Recomendação

Aplicar em **um renderer determinístico e server-side**, antes de criar o job de
envio. Preview no cliente pode reutilizar a função pura, mas o resultado
autoritativo é o do servidor.

A sintaxe `{{contato.nome | "tudo bem"}}` é aceitável visualmente, desde que exista
uma gramática pequena e própria — sem `eval` e sem expressão JavaScript. Eu
preferiria tornar a intenção explícita, por exemplo:

`{{ contato.nome | default: "tudo bem" }}`

Regras:

- catálogo fechado de variáveis inseridas por picker;
- chave canônica estável; label em PT-BR é só apresentação;
- fallback obrigatório para campo anulável quando o passo exige texto válido;
- token desconhecido ou sem fallback bloqueia publicação, não some silenciosamente;
- renderizar primeiro e validar tamanho/formato do canal depois;
- salvar no attempt o conteúdo efetivamente renderizado para auditoria;
- o mesmo renderer atende texto, caption, link e campos futuros.

O snapshot publicado precisa guardar corpo e especificação das variáveis. A IA
emite o mesmo contrato; ela não inventa tokens livres.

## 9. Fatiamento F1–F9

A ordem conceitual está próxima, mas F1, F2, F4 e F6 estão grandes demais. Eu
mudaria para:

| Fase | Entrega fechada |
|---|---|
| F0 | ADR do motor: estados, versionamento, arestas, idempotência, safe mode e invariantes |
| F1 | Schema de autoria: automations, draft steps/edges, templates, RLS e isolamento |
| F2 | Publicação: compiler/validator puro, `automation_versions` imutável e enrollments |
| F3 | Outbox/jobs + attempts + serviço compartilhado de conversa, ainda só em simulação |
| F4 | Scheduler/claim/lease/retry/reconciliação e testes de corrida |
| F5 | `wait_for_event`, inbox idempotente, resposta × timeout e takeover humano |
| F6 | Builder manual + biblioteca de mensagens + publish/test flow |
| F7 | Roteamento por tag, tarefas, mover etapa/funil, reentrada e cooldown |
| F8 | Mídia: upload TUS, bucket/RLS, variantes e worker de compressão |
| F9 | Observabilidade navegável, dead-letter e operação por lead |
| F10 | IA: perguntas, structured output, validação, pendências clicáveis e draft |

F8 pode começar em paralelo depois de F1 porque tem infraestrutura própria, mas
não deve ser escondida dentro de “CRUD de mídia”. O critério com vídeo só fecha
quando upload, processamento e seleção da variante estiverem completos.

Cada fase deve ter teste antes do código e commit pequeno. O scheduler só entra
depois de outbox e simulação; a IA só entra depois de o contrato manual estar
estável.

## 10. Pontos errados, arriscados ou faltando

Não reabriria as decisões de produto do SPEC. Ajustaria estes pontos técnicos:

### 10.1 Alvo da inscrição está ambíguo

`lead_id/contact_id` não pode permanecer como escolha futura no schema. O BaseCRM
tem `deals` como oportunidade e `contacts` como pessoa; o mesmo contato pode ter
mais de um serviço.

Minha recomendação é:

- `deal_id` identifica a oportunidade inscrita;
- `contact_id` identifica o destinatário;
- `thread_id` e `channel_connection_id` identificam a conversa/canal;
- todos pertencem ao mesmo `organization_id`, validado no banco.

Isso evita que um fluxo de um serviço encerre indevidamente outro serviço da
mesma pessoa.

### 10.2 `service_tag` duplica `trigger_config`

Guardar a etiqueta em dois lugares cria divergência. Usar um único trigger
canônico. Hoje `deals.tags` é `TEXT[]`, apesar de também existir a tabela `tags`;
o PLAN precisa decidir como normalizar rename/case antes de depender disso como
evento. Não criaria mais uma coluna textual paralela.

### 10.3 `cooldown_days = 5` mistura conceitos

“Esfriou em 5 dias”, timeout de resposta e intervalo mínimo de reentrada não são
necessariamente a mesma regra. Modelar separadamente:

- timeout do passo;
- regra de saída/esfriamento;
- política de reentrada/cooldown.

### 10.4 Estados e tentativas estão incompletos

Enrollment precisa distinguir ao menos `active`, `waiting`, `paused`, `done`,
`exited`, `failed` e `cancelled`. Job/attempt precisa distinguir `pending`,
`leased`, `sent`, `failed`, `unknown`, `dead_letter` e `simulated`.

`automation_runs` com apenas `status · payload · error · executed_at` não basta
para retry, lease, duração, scheduled time, provider ID e erro ambíguo.

### 10.5 Tempo e janela operacional

Definir desde o schema:

- timezone da organização;
- se “D+1” significa 24 horas ou próximo dia local;
- horário permitido/quiet hours;
- comportamento em fim de semana;
- `scheduled_for` original versus `executed_at` real.

Isso não precisa ganhar UI completa na primeira tela, mas o motor não deve
assumir UTC como regra de produto.

### 10.6 RLS e workers

Todas as tabelas operacionais, inclusive versões, edges, waits, jobs, attempts e
variantes, precisam de `organization_id`. O worker não deve aceitar
`organization_id` vindo do browser como autoridade. Claims e updates devem ser
server-side, tenant-scoped e auditáveis.

### 10.7 Publicação deve ser uma transação

Publicar precisa:

1. validar grafo, variáveis, destinos, mídia pronta e regras por tipo;
2. gerar definição canônica e hash;
3. inserir versão imutável;
4. atualizar `published_version_id`;
5. registrar autor/data.

Se qualquer passo falhar, nada é publicado. Autosave de draft nunca cria versão
nem altera a versão ativa.

## 11. Compressão de vídeo

### Recomendação para v1

Escolher **(b) worker próprio com ffmpeg na VPS**.

A opção (d) não cumpre o requisito real: os arquivos do piloto têm 56–322 MB,
incluindo 4K/60 fps. `ffmpeg.wasm` pode ser melhoria futura para arquivos pequenos,
mas não é base confiável para esse volume em celulares e notebooks comuns. Serviço
pago adiciona custo, terceiro e decisão de tratamento de dados sem necessidade
agora.

O fluxo recomendado:

1. servidor cria `media_asset` e caminho imutável, tenant-scoped;
2. navegador envia o original direto para Storage com **TUS/resumable upload** e
   token assinado; para arquivos acima de 6 MB, esse é o caminho recomendado pelo
   Supabase;
3. endpoint de finalização verifica no Storage tamanho, MIME e existência do
   objeto — não confia apenas no browser;
4. cria `media_processing_job`;
5. worker da VPS faz claim com lease, recebe URLs assinadas de download/upload e
   não recebe service role amplo;
6. ffmpeg gera MP4 H.264 + AAC, `faststart`, com limite abaixo de 16 MB para haver
   margem;
7. servidor verifica a derivada e cria uma variante `ready`;
8. somente variante pronta pode ser selecionada para publicação.

Se a duração tornar 16 MB inviável com qualidade mínima, o job falha com motivo
explicável; não deve produzir um arquivo tecnicamente válido e inutilizável.

### Modelagem

Não colocaria original e derivadas na mesma linha.

**`media_assets` — identidade e original**

`id · organization_id · kind · original_storage_path · original_filename ·
original_mime · original_size_bytes · original_checksum · status · created_by ·
timestamps`

**`media_asset_variants` — saídas imutáveis**

`id · organization_id · asset_id · profile · channel · storage_path · mime ·
size_bytes · duration_ms · width · height · video_codec · audio_codec · checksum ·
processor_version · status · error · timestamps`

**`media_processing_jobs` — processamento**

`id · organization_id · asset_id · target_profile · status · available_at ·
lease_owner · lease_until · attempt_count · last_error · timestamps`

O passo publicado referencia `media_asset_variant_id`, não o path do original.
Regenerar uma variante cria outra linha/path; não sobrescreve o arquivo usado por
uma versão publicada.

### Bucket e segurança

Eu **não reutilizaria o bucket `deal-files`**. As policies atuais exigem que a
primeira pasta seja `deal_id` e que exista metadata em `deal_files`. Forçar uma
biblioteca global ali criaria deal fictício ou policy híbrida difícil de auditar.

Criaria bucket privado próprio, por exemplo `automation-media`, com paths:

`{organization_id}/{asset_id}/original/{uuid}`  
`{organization_id}/{asset_id}/variants/{variant_id}.mp4`

Reutilizar o padrão de URL assinada e isolamento por tenant, não o vínculo com
deal. Original e variantes permanecem privados; a Evolution recebe URL assinada
de curta duração somente na hora do envio.

## Decisões que eu levaria para aprovação do Junior

1. Aprovar o híbrido `automation_versions.definition JSONB` +
   `enrollment.version_id`.
2. Aprovar `automation_step_edges`; remover `next_step_id` e `branch_config` como
   fonte de verdade.
3. Tornar outbox/jobs requisito anterior ao cron.
4. Aceitar que message-id é correlação forte apenas quando há quote e aprovar a
   regra de uma espera pendente por conversa.
5. Aprovar safe mode em camadas, com kill switch de ambiente.
6. Trocar sync bidirecional implícito por template como fonte de verdade +
   revisions/conflito.
7. Aprovar worker ffmpeg na VPS, upload TUS e bucket próprio de mídia.
8. Confirmar o plano Vercel; Pro/Enterprise mantém Vercel Cron, Hobby ativa
   Supabase Cron como trigger substituto.

Depois desses oito pontos, o restante do PLAN pode avançar sem reabrir o produto.

## Evidências e confiança

| Afirmação | Tipo | Confiança |
|---|---|---|
| `dispatchConversationMedia` não persiste conversa; a Route Handler persiste depois do envio | `[Behavior observed]` no código local | Baixa pelo critério formal de uma fonte, embora seja evidência primária direta |
| O dedupe atual do webhook é `SELECT` seguido de `INSERT`, sem constraint visível de provider ID | `[Behavior observed]` no código/migration local | Baixa pelo critério formal de uma fonte |
| Vercel Cron pode duplicar/sobrepor, não faz retry e Hobby só aceita execução diária | `[Behavior observed]` em documentação oficial atual | Baixa pelo critério formal de uma organização-fonte |
| Supabase recomenda TUS para arquivos acima de 6 MB e aceita token assinado | `[Behavior observed]` em documentação oficial atual | Baixa pelo critério formal de uma organização-fonte |
| Message-id inbound não identifica um outbound sem quote/contexto | `[Behavior observed]` no payload Evolution + `[Inferred]` sobre a impossibilidade de correlação | Média: payload e código local são fontes independentes; a regra de fallback é decisão arquitetural |
| Worker na VPS é a melhor opção para os vídeos do piloto | `[Inferred]` a partir de tamanho/formato verificados e limites das plataformas | Média: dados locais + documentação Vercel + documentação Supabase |

Pelo critério de confiança adotado nas pesquisas, não classifico como “alta” uma
afirmação sustentada por uma única organização, mesmo quando é a documentação
oficial autoritativa.

## Fontes externas atuais consultadas

- [Vercel — Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Vercel — Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel — Functions Limits](https://vercel.com/docs/functions/limitations)
- [Supabase — Cron](https://supabase.com/docs/guides/cron)
- [Supabase — Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
