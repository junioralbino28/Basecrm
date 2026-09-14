# Opinião — Entrega LIVE do motor de automações

**Revisado:** branch `feat/funil-construtor`, código ancorado em `f45d8dc`; o `HEAD` atualizado
estava em `4adbd04`, cujo único delta sobre a entrega é o próprio
`docs/features/funil-construtor/PEDIDO-REVISAO-LIVE.md:1`.

**Veredito:** não aprovar o LIVE neste estado. Há caminhos para opt-out forjado ou perdido,
quatro POSTs para um único envio lógico, envio por canal inativo, persistência de erro externo sem
redação e efeitos de banco que vencem uma pausa concorrente.

## 1. Bloqueantes

### B1 — conexão Evolution legada permite opt-out forjado sem autenticação (G11/G13)

- **Onde:** `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:661`,
  `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:673`,
  `lib/conversations/webhookAuth.ts:35`, `lib/conversations/webhookAuth.ts:55` e
  `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:924`.
- **Cenário concreto:** numa conexão legada com `webhookSecret` vazio, um terceiro que conheça o
  `connectionId` envia um payload inbound suportado com `PARAR`; `evaluateWebhookAuth` devolve
  `authorized=true` até quando o `instanceName` diverge, e o webhook usa `service_role` para marcar
  o contato e pausar as automações daquele telefone.
- **Correção proposta:** exigir autenticação forte antes de qualquer opt-out, bloquear LIVE em
  conexão sem segredo e migrar o webhook para assinatura com timestamp/nonce em vez do aceite
  legado incondicional.

### B2 — falha ao persistir opt-out é engolida e a repetição não consegue repará-la

- **Onde:** `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:707`,
  `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:717`,
  `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:932`,
  `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:939` e
  `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:949`.
- **Cenário concreto:** chega `PARAR`, a mensagem é inserida, mas
  `record_automation_opt_out` sofre erro transitório; o webhook apenas registra `warn`, resolve a
  espera pela aresta `answered` e responde 200, deixando `automation_opt_out_at` nulo; no retry do
  provedor, o dedupe retorna antes da detecção da palavra e nunca tenta o opt-out de novo, de modo
  que um follow-up posterior pode ser enviado contra o pedido expresso do contato.
- **Correção proposta:** tornar mensagem inbound + intenção de opt-out duráveis/atômicas (ou criar
  outbox de reparo) e fazer o caminho de duplicata reprocessar idempotentemente opt-out pendente
  antes de resolver a espera.

### B3 — “um envio, zero retry” é falso: o adaptador faz até quatro POSTs

- **Onde:** `lib/automations/executor.ts:318`, `lib/channels/evolution.ts:369`,
  `lib/channels/evolution.ts:412`, `lib/channels/evolution.ts:422`,
  `lib/channels/evolution.ts:447` e `test/funilLiveExecutor.local.test.ts:419`.
- **Cenário concreto:** o primeiro formato produz o efeito no provedor, mas a Evolution ou um
  proxy devolve HTTP 400 depois de processá-lo; o adaptador trata o erro como oportunidade de
  fallback e envia outros três corpos ao mesmo endpoint, sem chave de idempotência, podendo gerar
  mensagens duplicadas. O próprio teste exige quatro POSTs em
  `test/funilLiveExecutor.local.test.ts:429`–`431`.
- **Correção proposta:** acrescentar ao adaptador uma opção one-shot usada pelo motor e fixar um
  único formato por conexão; `sendMode` hoje só reordena as quatro tentativas e não as limita.

### B4 — o safe mode não verifica se o canal está ativo

- **Onde:** `lib/automations/executor.ts:271`, `lib/automations/executor.ts:297`,
  `supabase/migrations/20260913040000_funil_live_envio_real.sql:109`,
  `supabase/migrations/20260913040000_funil_live_envio_real.sql:126` e
  `docs/features/funil-construtor/ADR-MOTOR.md:214`–`224`.
- **Cenário concreto:** um healthcheck marca a conexão como `error`/`disconnected`, mas a instância
  e as credenciais continuam válidas; o executor seleciona apenas `id, organization_id, config`,
  o banco confere live/opt-out, e a mensagem sai por um canal que o operador desativou. Isso viola
  explicitamente o quarto gate do ADR, “canal ativo e aprovado para compliance”.
- **Correção proposta:** validar `channel_connections.status = 'connected'` e o estado de
  compliance dentro de `prepare_automation_outbound`, repetindo a checagem imediatamente antes do
  POST e falhando fechado.

### B5 — resposta de erro da Evolution pode persistir credencial sem redação

- **Onde:** `lib/channels/evolution.ts:62`, `lib/channels/evolution.ts:72`,
  `lib/channels/evolution.ts:95`, `lib/automations/executor.ts:329`,
  `lib/automations/executor.ts:332` e
  `supabase/migrations/20260913040000_funil_live_envio_real.sql:268`–`280`.
- **Cenário concreto:** uma Evolution mal configurada/comprometida ecoa `apiKey=<valor>` no corpo
  de um 4xx; o parser transforma o corpo em `Error.message`, o executor o passa cru e a migration
  o grava em `conversation_messages.delivery_error` e `metadata`, ambos dados operacionais do
  tenant. O projeto já possui o redator específico em `lib/channels/redactChannelSecrets.ts:26`,
  mas este caminho não o usa.
- **Correção proposta:** aplicar `redactChannelSecrets` com todas as credenciais resolvidas antes
  de persistir ou logar qualquer erro do provedor e guardar apenas uma mensagem sanitizada.

### B6 — tarefa/movimentação ainda executam depois de pausa concorrente e avançam o cursor

- **Onde:** `lib/automations/executor.ts:343`–`361`, `lib/automations/executor.ts:389`–`404`,
  `supabase/migrations/20260913040000_funil_live_envio_real.sql:480`–`503`,
  `supabase/migrations/20260913040000_funil_live_envio_real.sql:591`–`613` e
  `supabase/migrations/20260718030000_funil_f4_scheduler.sql:441`–`480`.
- **Cenário concreto:** o executor lê a inscrição como `active`; antes da RPC, um humano ou o
  webhook a pausa; `execute_automation_create_task`/`execute_automation_move_deal` bloqueia apenas
  o job, lê a inscrição sem `FOR UPDATE` e sem conferir `status/current_step_key`, cria a tarefa ou
  move o negócio e depois `advance_automation_enrollment` muda o cursor — e, no último passo,
  troca a inscrição pausada para `done`.
- **Correção proposta:** dentro de cada RPC de efeito, bloquear a inscrição e exigir
  `status='active'` e `current_step_key=v_job.step_key` antes de qualquer INSERT/UPDATE externo ao
  estado do motor.

## 2. Importantes

### I1 — erro de uma automação pausa todas as automações da conversa

- **Onde:** `supabase/migrations/20260913040000_funil_live_envio_real.sql:674`,
  `supabase/migrations/20260913040000_funil_live_envio_real.sql:681` e
  `supabase/migrations/20260718040000_funil_f5_waits.sql:512`–`522`.
- **Cenário concreto:** a automação A encontra um `condition` legado e chama
  `fail_automation_job_and_pause`; a função convocada atualiza todas as inscrições `active` ou
  `waiting` da thread, então a automação B, válida e independente, também é pausada.
- **Correção proposta:** falhar apenas `v_job.enrollment_id` para configuração/modo/passo sem
  executor e reservar a pausa thread-wide para inbound, opt-out e ambiguidade de entrega.

### I2 — POST admin pode retornar erro depois de aplicar metade da alteração

- **Onde:** `app/api/settings/automations-live/route.ts:117`–`140` e
  `app/api/settings/automations-live/route.ts:142`–`153`.
- **Cenário concreto:** o admin envia fuso/silêncio e `enabled=true`; o upsert do silêncio confirma,
  mas o gate de saúde recusa o enable com 409, deixando o cliente com configuração parcialmente
  alterada apesar da resposta de falha do pedido único.
- **Correção proposta:** fazer as duas mutações numa única RPC transacional ou validar/aplicar o
  enable antes do upsert e devolver explicitamente qualquer resultado parcial.

### I3 — um único Bearer vazado tem raio global e não há contenção por taxa/escopo

- **Onde:** `app/api/internal/automations/execute/route.ts:7`–`8`,
  `app/api/internal/automations/execute/route.ts:19`–`48`,
  `app/api/internal/automations/jobs/claim/route.ts:24`–`35` e
  `app/api/internal/automations/jobs/[jobId]/complete/route.ts:32`–`45`.
- **Cenário concreto:** com `AUTOMATION_WORKER_SECRET`, o atacante pode (a) executar em lote todos
  os jobs vencidos de todos os tenants, disparando mensagens/tarefas/movimentos e consumo; (b)
  reclamar 50 jobs por vez por 900 s, ler os payloads retornados e causar indisponibilidade; e
  (c) concluir os leases obtidos como `sent/failed/unknown`, avançando ou dead-lettering o motor.
  Não consegue criar job, escolher tenant no corpo, antecipar `available_at`, ignorar silêncio ou
  bypassar os gates live; ainda assim, o impacto do segredo é global.
- **Correção proposta:** separar credenciais e escopos de execute/claim/complete, impor rate limit
  distribuído + limite de concorrência e fixar no servidor os máximos operacionais da rota.

### I4 — o orçamento do executor não limita uma execução em curso e deixa pouca margem ao tick

- **Onde:** `lib/automations/executor.ts:33`, `lib/automations/executor.ts:36`,
  `lib/automations/executor.ts:156`–`165`, `lib/automations/executor.ts:496`–`519`,
  `app/api/internal/automations/tick/route.ts:9`,
  `app/api/internal/automations/tick/route.ts:74`,
  `app/api/internal/automations/tick/route.ts:86` e
  `app/api/internal/automations/tick/route.ts:93`–`100`.
- **Cenário concreto:** um job começa perto de 35 s e ainda pode esperar 15 s, levando o executor a
  aproximadamente 50 s; o despacho Meta roda depois e, se o total passar de 60 s, a Vercel encerra
  a invocação antes de `complete_automation_tick`. A tentativa fica em `endpoint_received`; se não
  houver novo sucesso, a saúde só degrada quando o último sucesso passa de 10 minutos. Se a morte
  ocorrer durante o POST, mensagem `pending` + lease vencido serão reconciliados como `unknown`.
  O `Promise.race` também não cancela o fetch; `test/funilLiveExecutor.local.test.ts:490`–`503`
  precisa liberar manualmente a resposta pendente depois que o executor já retornou.
- **Correção proposta:** usar deadline absoluto compartilhado, não iniciar envio sem margem para
  timeout + fechamento, reservar orçamento para Meta/health e propagar `AbortSignal` até o fetch.

`maxDuration = 60` em si é aceito: o projeto usa Next `16.2.10`
(`package.json:64`), e a documentação oficial atual permite `export const maxDuration` em Next
13.5+; no Hobby o teto é 60 s sem Fluid Compute e 300 s com Fluid Compute. Exceder o teto resulta
em 504 `FUNCTION_INVOCATION_TIMEOUT`. Fontes: [Vercel — configuring function duration](https://vercel.com/docs/functions/configuring-functions/duration)
e [Vercel — function limitations](https://vercel.com/docs/functions/limitations).

### I5 — teste focal não está isolado do banco local e é dependente da ordem/estado

- **Onde:** `test/funilLiveExecutor.local.test.ts:84`–`92`,
  `test/funilLiveExecutor.local.test.ts:265`–`267`,
  `test/funilLiveExecutor.local.test.ts:281`–`283`,
  `test/funilLiveExecutor.local.test.ts:296`–`301` e
  `test/funilLiveExecutor.local.test.ts:382`.
- **Cenário concreto:** a primeira execução focal nesta revisão terminou 8/12: o worker global
  reclamou três jobs residuais de outras organizações, quebrando quatro asserts de contagem/estado;
  a repetição imediata, sem alteração de código ou limpeza manual, terminou 12/12 porque a primeira
  já havia consumido o resíduo.
- **Correção proposta:** executar a prova num banco dedicado/limpo ou fazer o teste reclamar jobs
  identificados pela própria fixture, sem assertions sobre a fila global compartilhada.

### I6 — `CANCELAR`/`CANCELA` geram falso positivo de opt-out permanente

- **Onde:** `lib/automations/optOut.ts:16`–`17` e `lib/automations/optOut.test.ts:15`–`20`.
- **Cenário concreto:** numa conversa operacional, o contato responde apenas `CANCELAR` para
  cancelar pedido/reunião/assinatura; a palavra exata marca opt-out permanente de automações,
  embora o teste cubra somente a frase maior `cancelar a consulta de amanhã`. Em sentido oposto,
  frases comuns como `PARE DE ME MANDAR MENSAGENS` não estão na lista e são falso negativo.
- **Correção proposta:** retirar verbos ambíguos isolados e cobrir frases explícitas de
  descadastro, com confirmação/contexto quando a intenção puder significar cancelar outra coisa.

## 3. Sugestões

1. **Amarrar os IDs da RPC de opt-out.**
   `supabase/migrations/20260913040000_funil_live_envio_real.sql:825`–`850` valida o contato contra
   `p_organization_id`, mas aceita `p_thread_id` independente; confirme dentro da função que a
   thread pertence ao mesmo tenant/contato antes da pausa. O chamador atual passa IDs coerentes,
   então não encontrei exploração cross-tenant direta por esse caminho.
2. **Trocar testes estáticos de rota por provas de comportamento.**
   `test/funilLiveMigration.test.ts:149`–`183` procura strings e não detectou os quatro POSTs, o
   partial commit do admin, o canal inativo nem o fail-open do webhook; acrescentar testes de rota
   com erro de RPC, duplicata e usuário A→tenant B.
3. **Manter o marcador da tarefa por enquanto.**
   `supabase/migrations/20260913040000_funil_live_envio_real.sql:531`–`538` é suficientemente
   idempotente no desenho atual porque a RPC serializa pelo lock do job e o UUID não contém curingas;
   sem mudar `tasks`, não achei alternativa materialmente melhor. Quando houver schema, prefira
   `automation_job_id uuid` com índice UNIQUE parcial.
4. **Não fazer retry automático de `unknown`; criar reconciliação humana.**
   `lib/automations/executor.ts:253`–`268` está correto ao não reenviar depois que um POST pode ter
   saído. A API Fetch não informa com confiabilidade se zero bytes deixaram o processo; `AbortSignal`
   reduz handle pendente, mas não prova não-entrega. Retry seguro cabe apenas antes de iniciar o
   POST, para falhas determinísticas locais; para o resto, tela de reconciliação/retomada explícita.

## 4. Conferências feitas

### Provas executadas

- `rtk git fetch` + `rtk git pull --ff-only`: branch atualizada; `f45d8dc..4adbd04` adiciona somente
  `docs/features/funil-construtor/PEDIDO-REVISAO-LIVE.md:1`.
- `rtk npx supabase migration up --local`: concluiu sem migration pendente. Consulta no container
  local `supabase_db_crmia` terminou o ledger em `20260913050000` e mostrou também
  `20260913040000`; nenhum ref remoto foi usado.
- `rtk node scripts/test-local.mjs test/funilLiveExecutor.local.test.ts`: primeira execução **8/12**
  (quatro falhas reproduzíveis por estado global); repetição imediata **12/12**.
- `rtk npm run test:local`: **252 arquivos, 1.236 testes, zero falhas**, em 201,81 s.
- Consulta adversarial da janela de silêncio no Postgres local: amostrei todo 2026 a cada 15 min em
  `America/Sao_Paulo`, `America/New_York`, `Europe/Berlin` e `Pacific/Auckland`, tanto 20:00→08:00
  quanto 01:30→03:30; resultado: **0 adiamentos para o passado**, **0 acima de 26 h**, máximo 13 h.
- Baseline automatizado read-only via
  `C:/Users/PC Gamer/brains/cenoura-brain/scripts/audit-seg.sh`: `execution_ok=true`; Semgrep 1.170.1
  com 0 findings; `npm audit` com 18 vulnerabilidades do repositório (1 critical, 5 high, 5 moderate,
  7 low); Gitleaks com 85 ocorrências redigidas somente em artefatos locais/ignorados
  (`.env.local`, `.next`, `supabase/.temp`) e **0 no histórico Git**. É baseline parcial, não prova
  todos os gates; as dependências são dívida global fora do diff `f45d8dc`, não finding atribuído à
  Entrega LIVE.

### As sete afirmações

1. **✅ `prepare_automation_outbound` preservou cabeçalho e corpo fora do modo.** Comparei
   `git show 9c146ef:supabase/migrations/20260718030000_funil_f4_scheduler.sql` (função em
   `supabase/migrations/20260718030000_funil_f4_scheduler.sql:594`) com
   `supabase/migrations/20260913040000_funil_live_envio_real.sql:46`–`194`: assinatura, retorno,
   DEFINER e `search_path=''` são iguais; o delta funcional é `v_mode` + bloco live/simulation.
2. **✅ `claim_automation_jobs` só mudou `duration_ms`.** Comparei a F4 em
   `supabase/migrations/20260718030000_funil_f4_scheduler.sql:327`–`419` com
   `supabase/migrations/20260913050000_funil_claim_sem_overflow.sql:13`–`108`; a única mudança de
   corpo é o `least(...2147483647...)` em
   `supabase/migrations/20260913050000_funil_claim_sem_overflow.sql:55`–`58`.
3. **✅ ACL e `search_path` das nove funções.** Rodei no Postgres local consulta a `pg_proc` com
   `pg_get_function_identity_arguments`, `prosecdef`, `proconfig` e
   `has_function_privilege(...)`: 9/9 deram `prosecdef=t`, `search_path=""`,
   `anon_exec=f`, `auth_exec=f`, `service_exec=t`. As revogações também aparecem em
   `supabase/migrations/20260913040000_funil_live_envio_real.sql:196` e
   `supabase/migrations/20260913050000_funil_claim_sem_overflow.sql:107`–`108`.
4. **✅ os três cadeados declarados existem; ❌ o safe mode completo não.** O ambiente bloqueia o
   executor em `lib/automations/executor.ts:448`–`473`; organização e modo live são conferidos no
   banco em `supabase/migrations/20260913040000_funil_live_envio_real.sql:126`–`150`. Não achei
   bypass desses três, mas falta o gate de canal ativo do ADR (B4).
5. **❌ “nunca retenta um envio”.** O job 5xx realmente fica `unknown` e a segunda execução não o
   reclama (`test/funilLiveExecutor.local.test.ts:469`–`488`), mas um 4xx gera quatro POSTs no
   adaptador (`test/funilLiveExecutor.local.test.ts:429`–`431` e B3). O teste estático em
   `test/funilLiveMigration.test.ts:149`–`158` só procura a ausência da string
   `retryable_failure` no executor e não inspeciona o adaptador chamado.
6. **✅ tarefa/movimentação simulam sem efeito quando o executor roda.** Os branches em
   `lib/automations/executor.ts:389`–`404` concluem `simulated` antes das RPCs para qualquer modo
   diferente de `live`. Ressalva operacional: com a variável de ambiente desligada, nenhum tipo de
   job é executado (`lib/automations/executor.ts:471`–`474`), conforme documentado em
   `docs/features/funil-construtor/OPERACAO-TICK.md:78`–`84`.
7. **❌ opt-out não é confiável em todos os caminhos.** No caminho de mensagem nova, a chamada vem
   antes de `resolve_automation_wait_from_inbox`
   (`app/api/public/channels/evolution/[connectionId]/webhook/route.ts:924`–`960`) e o erro não
   derruba a resposta; porém isso é fail-open, e o caminho de duplicata em
   `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:707`–`736` resolve/retorna sem
   sequer executar o opt-out (B2).

### Gates G1–G25 no recorte

A fonte canônica atual numera **excessive agency como G17** e **business logic como G20**; usei a
numeração atual de
`C:/Users/PC Gamer/brains/cenoura-brain/06-References/SEGURANCA-GATES-VIBE-CODING.md:109`–`175`.

- **Falharam no recorte:** G3 (webhook legado aceita chamada não autenticada, B1), G7/G18 (sem
  rate/concurrency limit, I3), G10/G22 (erro externo sem
  redação, B5), G11 (webhook legado sem autenticação forte/anti-replay e reparo de opt-out falho,
  B1/B2), G13 (um webhook público alcança RPC service-role no modo legado, B1), G17/G20 (efeitos
  autônomos não revalidam pausa/cursor dentro da transação, B6) e G24 (falha do opt-out produz só
  `console.warn`, sem estado durável para detecção/reparo, B2).
- **Falhou no repositório, fora do diff:** G12, pois `npm audit` encontrou 18 dependências com CVE,
  incluindo 1 critical; não atribuí isso aos arquivos da entrega.
- **Não ficaram provados:** G2/G4 exigem teste A↔B; não há teste runtime da rota admin ou do bloco
  de webhook novo. A leitura estática não encontrou escalada em
  `app/api/settings/automations-live/route.ts:84`–`153`.
- **Sem finding neste recorte:** G1, G5, G6, G8, G9, G14, G19, G23 e G25. Em particular,
  as duas migrations são aditivas/`create or replace`, sem operação destrutiva
  (`supabase/migrations/20260913040000_funil_live_envio_real.sql:35`–`40`), e o default nasce
  desligado (`.env.example:49`).
- **N/A no recorte:** G15, G16 e G21; não há prompt/saída de LLM nem MCP nos arquivos revisados.

## 5. Onde bati e não achei nada — ponto por ponto

| Ponto pedido | Resultado |
|---|---|
| Reenvio zero | **Achei B3.** Depois que um POST começa, não há retry automático comprovadamente seguro; `AbortSignal` não prova não-entrega. A alternativa mínima é one-shot no adaptador, não reenvio. `lib/channels/evolution.ts:422`–`447`. |
| `complete_automation_live` failed + aresta failed | **Não achei tropeço.** O job anterior permanece `dead_letter`, mas `materialize_automation_jobs` materializa pelo `current_step_key` e o claim só considera pending/lease vencido; o avanço usa a aresta failed em `supabase/migrations/20260913040000_funil_live_envio_real.sql:321`–`335`. |
| Wait fecha job como sent sem avançar | **Não achei consumidor que use `sent ⇒ avançou`.** `open_automation_wait_for_job` abre a espera, fecha a tentativa/job e a inscrição passa a `waiting`; resposta/timeout são os únicos avanços. `supabase/migrations/20260913040000_funil_live_envio_real.sql:404`–`449`. |
| Silêncio noturno e concorrência | **Não achei erro.** A matriz anual/fusos ficou sem passado/+24 h indevido; `greatest(v_next_end, now+1m)` protege o limite, e `FOR UPDATE OF job SKIP LOCKED` serializa o update da linha. `supabase/migrations/20260913040000_funil_live_envio_real.sql:727`–`798`. |
| Worker global + cliente com live desligado | **Não achei caminho até a Evolution.** O adiamento ocorre antes do claim e `prepare_automation_outbound` volta a negar no banco; a corrida de desligamento pode dead-letter/pausar, mas não envia. `lib/automations/executor.ts:487`–`504` e `supabase/migrations/20260913040000_funil_live_envio_real.sql:131`–`138`. |
| `Promise.race`/handle | **Achei I4.** O fetch continua e a margem de 60 s pode acabar antes do health close. `lib/automations/executor.ts:156`–`165`. |
| Pausa thread-wide | **Achei I1.** Um passo inválido de A pausa B. `supabase/migrations/20260913040000_funil_live_envio_real.sql:674`–`688`. |
| Palavras de parada | **Achei I6.** `CANCELAR`/`CANCELA` são falsos positivos plausíveis; faltam frases explícitas comuns. `lib/automations/optOut.ts:16`–`25`. |
| Idempotência da tarefa | **Não achei bug no desenho atual.** O lock do job evita corrida e o marcador UUID é adequado até existir coluna própria. `supabase/migrations/20260913040000_funil_live_envio_real.sql:480`–`538`. |
| Rota admin/escalada/saúde global | **Não achei escalada de tenant:** o alvo vem de `requireAdminTenantContext` e o silêncio usa o cliente RLS; a saúde global expõe estado técnico, não dado de outro tenant. Achei o partial commit I2. `app/api/settings/automations-live/route.ts:51`–`80` e `app/api/settings/automations-live/route.ts:84`–`153`. |
| Rota execute sem rate limit | **Achei I3.** O raio exato inclui execução global, exfiltração da fila via claim e corrupção por complete com o mesmo Bearer. `app/api/internal/automations/execute/route.ts:7`–`48`. |
| `maxDuration = 60` | **Aceito pelo runtime atual; achei risco de margem I4.** Se estourar, a Vercel devolve 504 e `complete_automation_tick` não roda. `app/api/internal/automations/tick/route.ts:9` e `app/api/internal/automations/tick/route.ts:93`–`100`. |
| G1–G25 | **Bati manualmente + baseline parcial.** Findings em B1/B2/B5/B6/I3; G12 falha global; G2/G4 não têm prova A↔B; G23 e G25 conferidos sem finding. `supabase/migrations/20260913040000_funil_live_envio_real.sql:35`–`40` e `.env.example:49`. |
