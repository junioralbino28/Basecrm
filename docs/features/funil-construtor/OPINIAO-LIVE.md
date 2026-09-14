# Opinião — Entrega LIVE do motor de automações

**Revisado:** branch `feat/funil-construtor`, código ancorado em `f45d8dc`; o `HEAD` atualizado
estava em `4adbd04`, cujo único delta sobre a entrega é o próprio
`docs/features/funil-construtor/PEDIDO-REVISAO-LIVE.md:1`.

**Veredito:** não aprovar o LIVE neste estado. Há caminhos para opt-out forjado ou perdido,
quatro POSTs para um único envio lógico, envio por canal inativo, persistência de erro externo sem
redação, efeitos de banco que vencem uma pausa concorrente e um caminho de SSRF/exfiltração da
credencial Evolution da agência por configuração de destino do tenant.

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

### B7 — `apiUrl` do tenant pode exfiltrar a chave Evolution global da agência (G13/G22/G26)

- **Severidade:** alta, bloqueante para LIVE.
- **Onde:** `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts:24`,
  `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts:44`–`45`,
  `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts:92`,
  `lib/channels/evolutionCredentials.ts:93`–`98`,
  `lib/channels/evolutionCredentials.ts:125`–`131`, `lib/automations/executor.ts:273`–`320` e
  `lib/channels/evolution.ts:368`–`424`.
- **Cenário concreto:** um usuário com `whatsapp.manage_connection` grava somente
  `config.apiUrl=https://host-do-atacante.example`, deixando `config.apiKey` vazio. O resolvedor
  combina esse URL do tenant com `defaults.apiKey` da agência; quando o motor executa uma mensagem,
  o adaptador envia um POST ao host escolhido com a chave global no header `apikey`. Isso permite
  roubar a credencial compartilhada e, conforme o alcance dela, alcançar instâncias de outros
  tenants. O mesmo controle de URL também cria SSRF contra destinos internos acessíveis ao runtime.
- **Correção proposta:** nunca misturar URL de uma fonte com chave de outra: conexão só substitui o
  par quando fornece `apiUrl` **e** `apiKey`; caso contrário, usar integralmente o par da agência.
  Além disso, validar protocolo, host e porta por allowlist, bloquear IP privado/link-local/metadata
  após resolução DNS, limitar redirects e manter timeout com aborto real.
- **Mitigação/nota de falso positivo:** restringir temporariamente `apiUrl` a administradores da
  agência reduz a explorabilidade, mas não elimina o SSRF. Se não houver binding com defaults de
  agência, o roubo da chave global não ocorre; o destino arbitrário continua existindo.

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

### I7 — o segredo do webhook é colocado na URL e pode vazar antes de autenticar (G10/G11/G22)

- **Severidade:** alta se qualquer log/configuração do provedor for acessível; importante enquanto
  não há evidência de vazamento real.
- **Onde:** `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:28`–`31`,
  `app/api/platform/tenants/[tenantId]/channels/[connectionId]/connect/route.ts:122` e
  `app/api/platform/tenants/[tenantId]/channels/[connectionId]/healthcheck/route.ts:83`.
- **Cenário concreto:** connect e healthcheck cadastram na Evolution um URL com
  `?secret=<bearer-estático>`; esse valor pode aparecer na configuração do provedor, access logs,
  tracing, proxies e relatórios de erro. Quem obtém o URL pode repetir eventos indefinidamente,
  porque não há timestamp/freshness nem assinatura do corpo. O efeito inclui o opt-out forjado de
  B1 e as demais escritas realizadas pelo webhook.
- **Correção proposta:** remover segredo de query string, autenticar por header quando o provedor
  permitir e preferir HMAC do raw body com timestamp e ID de entrega. Rotacionar os segredos já
  cadastrados e redigir query strings em observabilidade.
- **Nota de falso positivo:** não observei vazamento real. Se todos os saltos redigem query e a
  configuração da Evolution é estritamente protegida, a exposição pode não ter acontecido; o
  desenho continua vulnerável a um vazamento futuro e a replay.

### I8 — G12 falha globalmente: Next instalado possui advisories críticos abertos

- **Severidade:** crítica no SCA; importante neste parecer por ser dívida global, fora do diff LIVE,
  e por as precondições de exploração em produção não terem sido confirmadas.
- **Onde:** `package.json:64` e `package-lock.json:9775`–`9782`.
- **Evidência:** o baseline de 13/09/2026 encontrou o Next `16.2.12` dentro do intervalo vulnerável
  `>=16.0.0 <16.3.3` dos advisories `GHSA-p293-qw3h-jr36` (RCE em servidor Windows) e
  `GHSA-2xp9-vwfh-vxw4` (RCE no Image Optimization com AVIF). O `npm audit` totalizou 18 entradas:
  1 critical, 5 high, 5 moderate e 7 low. Também há high em `@faker-js/faker`, `browserslist`,
  `js-yaml`, `nanoid` e `sharp`. Fontes retornadas pelo próprio SCA:
  [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) e
  [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4).
- **Impacto e escopo:** é dívida do repositório, não regressão introduzida por `f45d8dc`, mas impede
  marcar G12 como PASS antes de publicar o conjunto. A primeira RCE exige hosting Windows; o alvo
  documentado é Vercel e não encontrei AVIF configurado em `next.config.*`, então a explorabilidade
  concreta dessas duas variantes não ficou provada. O componente continua em versão afetada.
- **Correção proposta:** atualizar lockfile para Next `>=16.3.3` e versões corrigidas das demais
  dependências, rodar a suíte completa/build e repetir `npm audit`; não usar apenas a ausência das
  precondições observadas como compensação permanente.

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
5. **Generalizar erros devolvidos pela rota administrativa.**
   `app/api/settings/automations-live/route.ts:90`,
   `app/api/settings/automations-live/route.ts:137` e
   `app/api/settings/automations-live/route.ts:151`–`160` devolvem mensagens internas de banco/RPC
   ao administrador autenticado. É exposição de baixa severidade, mas facilita reconhecimento de
   schema e regras. Devolver código/mensagem estável ao cliente e manter detalhe somente em log
   estruturado com redação.

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

## 6. Complemento da skill customizada `/cibersecurity`

### Âncora e cobertura

- A execução que corresponde ao alvo ocorreu às 20:20, quando o `HEAD` era `4adbd04` e o código da
  entrega ainda era `f45d8dc`. Resultado fora do projeto:
  `C:/Users/PC Gamer/.cache/cenoura-sec/20260913-202006-Basecrm/status.json`.
- Enquanto a skill rodava novamente, a branch avançou externamente para `773b791`, commit de
  resposta a este parecer. A repetição em
  `C:/Users/PC Gamer/.cache/cenoura-sec/20260913-210442-Basecrm/status.json` também terminou
  `execution_ok=true`, mas não usei esse scan para reclassificar o alvo original. O commit corretivo
  não faz parte desta revisão.
- O passo do Supabase MCP foi **deliberadamente não executado**, porque o pedido proíbe banco remoto.
  Para G2/G28 usei apenas o catálogo do Postgres local já documentado na seção 4; isso prova ACL e
  `search_path` das nove RPCs, não isolamento A↔B/RLS completo.

### Resultado do baseline automatizado

| Ferramenta | Estado | Evidência e limite |
|---|---|---|
| npm audit 11.6.0 | **OK de execução; 18 findings** | 1 critical, 5 high, 5 moderate, 7 low. G12 **FAIL**; detalhes em I8. |
| Semgrep 1.170.1 | **OK de execução; 0 findings** | Zero não significa PASS. Houve 2 warnings de parsing, ambos fora do recorte: `features/boards/components/Modals/CreateBoardModal.tsx:477` e `features/settings/components/CommissionsManager.test.tsx:7`. Nenhum arquivo LIVE ficou sem parse reportado. |
| gitleaks 8.30.1 árvore | **OK; 85 detecções redigidas** | 57 em `supabase/.temp`, 27 em `.next` e 1 em `.env.local`; todos são locais/ignorados. Os matches de chunks estáticos inspecionados eram identificadores gerados como `AuthProvider`/`ApiKeysSection`; chaves com padrão GCP apareceram só no cache interno do Turbopack. Não confirmei segredo servido ao cliente. |
| gitleaks 8.30.1 histórico | **OK; 0 detecções** | Nenhum segredo confirmado no histórico Git. Isso não anula B5/I7, que são caminhos de vazamento em runtime. |
| Trivy | **SKIPPED** | Opt-in `AUDIT_TRIVY=1`; não foi pedido e não integra o baseline padrão. |
| Snyk | **SKIPPED** | Opt-in `AUDIT_SNYK=1`; o `npm audit` foi o SCA efetivamente executado. |
| snyk-agent-scan/MCP | **SKIPPED** | Opt-in inicia MCPs e não é read-only; incompatível com o pedido delimitado. |

Os scanners, portanto, são apenas baseline parcial. Semgrep não encontrou padrão conhecido nos
arquivos que conseguiu analisar; isso não prova ausência de falha lógica. B1–B7 e I1–I7 vieram de
revisão manual/execução adversarial, exatamente nas classes em que a skill declara lacuna.

### Estado por gate da fonte canônica atual (G1–G32)

| Gate | Estado no recorte | Evidência |
|---|---|---|
| G1 segredo no navegador | **NÃO-TESTADO, sem finding confirmado no recorte** | gitleaks não confirmou segredo versionado; detecções em `.next` eram locais e as de chunks inspecionadas eram falsos positivos aparentes. Não executei inspeção de bundle de produção. |
| G2 RLS A↔B | **NÃO-TESTADO** | Catálogo local confirmou ACL das RPCs, mas não houve CRUD anon/A/B em tabelas, views, Storage e Realtime. |
| G3 authz server-side | **FAIL** | Webhook legado aceita request sem segredo e chega a `service_role`: B1, `lib/conversations/webhookAuth.ts:35`–`55`. |
| G4 IDOR/BOLA | **NÃO-TESTADO** | Filtros por organização foram lidos, mas não houve prova runtime usuário A→objeto B nas rotas novas. |
| G5 input runtime | **NÃO-TESTADO, sem finding adicional** | Execute e settings usam Zod estrito em `app/api/internal/automations/execute/route.ts:19`–`31` e `app/api/settings/automations-live/route.ts:21`–`36`; webhook lê JSON sem body limit em `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:643`. |
| G6 injeção | **NÃO-TESTADO, sem finding** | Semgrep retornou 0 e não há SQL/shell dinâmico no recorte; scanner/revisão estática não equivalem a teste adversarial do sink. |
| G7 rate/resource limit | **FAIL** | I3/I4 e webhook sem rate/body limit; `app/api/internal/automations/execute/route.ts:19`–`48`. |
| G8 XSS | **N/A no recorte** | Não há renderização/HTML nos arquivos LIVE revisados. |
| G9 CORS | **NÃO-TESTADO em runtime; sem finding estático** | As rotas não habilitam CORS refletido; CORS não compensa autenticação/replay do webhook. |
| G10 log/erro | **FAIL** | Erro da Evolution pode carregar segredo até log/banco (B5); rota admin expõe erro interno (sugestão 5). |
| G11 webhook | **FAIL** | Sem HMAC do raw body, timestamp/freshness e body limit; legado fail-open (B1) e bearer em URL/replay (I7). |
| G12 dependências | **FAIL global** | `npm audit`: 18; Next `16.2.12` sob dois advisories críticos. I8. |
| G13 service role | **FAIL** | Webhook público legado usa cliente admin (B1) e tenant pode exfiltrar default global Evolution (B7). |
| G14 slopsquatting | **N/A ao diff; NÃO-TESTADO globalmente** | `f45d8dc` não adiciona dependência; `npm audit` não verifica slopsquatting. |
| G15 prompt injection | **N/A no recorte** | O pedido limita a revisão ao bloco de opt-out, sem prompt/tool de LLM novo. |
| G16 saída LLM hostil | **N/A no recorte** | Nenhuma saída de LLM é consumida pelos arquivos/trechos novos delimitados. |
| G17 excessive agency | **FAIL** | RPCs de efeito não revalidam pausa/cursor dentro da transação: B6. |
| G18 denial of wallet | **FAIL** | Bearer global sem quota, até quatro POSTs e deadline sem cancelamento: B3/I3/I4. |
| G19 BFLA/mass assignment | **NÃO-TESTADO, sem finding estático** | Settings usa contexto admin e schema allowlist; faltou teste negativo de papel/tenant. `app/api/settings/automations-live/route.ts:21`–`36`, `:95`–`102`. |
| G20 lógica de negócio | **FAIL** | Opt-out pode se perder, pausa concorrente perde e erro de A pausa B: B2/B6/I1. |
| G21 MCP poisoning | **N/A no recorte** | Nenhum MCP participa do motor em runtime. |
| G22 ciclo de segredo | **FAIL** | Histórico Git ficou limpo, mas erro externo cru (B5), segredo de webhook na URL (I7) e mistura URL tenant/chave agência (B7) criam vazamento em runtime. |
| G23 migration destrutiva | **NÃO-TESTADO operacionalmente; sem finding no SQL** | Migrations são aditivas/`create or replace`, sem DROP destrutivo em `supabase/migrations/20260913040000_funil_live_envio_real.sql:35`–`40`; backup/PITR de produção não foi tocado. |
| G24 detecção/resposta | **FAIL** | Falha de opt-out vira somente `console.warn`, sem alerta/owner/reparo durável: B2. |
| G25 defaults por plataforma | **NÃO-TESTADO globalmente; default LIVE seguro** | A chave nasce desligada em `.env.example:49`; headers/source maps/configuração de produção ficam fora do recorte. |
| G26 SSRF/egress | **FAIL** | `config.apiUrl` chega a fetch e pode herdar a chave da agência: B7. |
| G27 CSRF/sessão | **NÃO-TESTADO globalmente; sem finding na mutação nova** | Settings valida origem em `app/api/settings/automations-live/route.ts:95`; rotas internas usam Bearer. Rotação/revogação/MFA da sessão ficam fora do recorte. |
| G28 superfície Supabase | **NÃO-TESTADO integralmente** | Catálogo local: 9/9 RPCs `SECURITY DEFINER`, `search_path=''`, anon/auth sem EXECUTE e service_role com EXECUTE; não houve A↔B em views/Storage/Realtime/Edge Functions. |
| G29 cache/upload | **N/A no recorte** | Nenhuma rota cacheada por usuário ou upload foi adicionada. |
| G30 n8n | **N/A no recorte** | O executor LIVE e as rotas novas não executam workflow/nó n8n. |
| G31 CI/CD supply chain | **N/A ao pedido** | Workflows/actions não fazem parte do escopo delimitado. |
| G32 backup/incidente | **NÃO-TESTADO** | Não houve acesso remoto nem prova de PITR/runbook; por instrução, nenhuma escrita de banco remoto foi feita. |

### Saldo específico da `/cibersecurity`

- **Novo bloqueante:** B7 (G26/G13/G22), ainda observável no `HEAD` `773b791` porque os arquivos que
  controlam/resolvem `apiUrl` não mudaram nesse commit.
- **Novos importantes:** I7 (segredo de webhook em URL/replay) e I8 (G12 global).
- **Nova sugestão:** item 5, generalização dos erros administrativos.
- **Onde a skill bateu e não achou algo novo:** SQL/shell injection, XSS, CORS refletido,
  mass assignment, migration destrutiva, segredo confirmado no histórico Git e MCP em runtime.
  “Não achou” não foi convertido em PASS quando faltou teste dinâmico.

## 7. Complemento do Codex Security (`security-diff-scan`)

### Resultado executivo

O Codex Security **complementou** a `/cibersecurity`: em vez de repetir SCA/SAST/secret scan, fez
modelo de ameaça, inventário imutável do diff, descoberta semântica, validação por
source/control/sink e calibração de caminho de ataque. O scan `6bc5ae54-23a1-4878-85d4-6337248fc5dc`
foi selado com cobertura `complete`, **2 findings `medium`, ambos com confiança alta**, no intervalo
`9c146ef0ab9df659c0790cca326ffd0880ccb410..f45d8dc7c7cb6b653b4c3bb6362af623e6f5fc0a`.

O relatório canônico ficou fora do projeto em
`C:/Users/PC Gamer/AppData/Local/Temp/codex-security-scans-uWI9Ar/Basecrm/f45d8dc7c7cb6b653b4c3bb6362af623e6f5fc0a_20260914T040038Z_6vaiwvmm/report.md`;
o SARIF está no subdiretório `exports/results.sarif`. O acesso Daybreak retornou
`status=not_granted`, aviso apenas de exibição protegida; não bloqueou a execução nem a selagem.

### Findings que sobreviveram

1. **`medium`/confiança alta — webhook Evolution legado permite opt-out privilegiado sem
   autenticação.** O controle raiz aceita qualquer chamada quando `webhookSecret` está vazio;
   o bloco novo confia nessa decisão e chama `record_automation_opt_out` com `service_role`.
   Cadeia: `lib/conversations/webhookAuth.ts:54`–`55` →
   `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:661`–`674` →
   `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:932`–`938` →
   `supabase/migrations/20260913040000_funil_live_envio_real.sql:825`–`857`. Confirma B1;
   severidade não foi elevada a high porque exige UUID válido e conexão legada.
2. **`medium`/confiança alta — executor envia chave global e PII para URL controlada pelo
   tenant.** O writer aceita `apiUrl` parcial, o resolvedor combina essa URL com a chave default da
   agência e o executor novo envia `apikey`, telefone e texto ao host. Cadeia:
   `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts:87`–`106` →
   `lib/channels/evolutionCredentials.ts:125`–`131` →
   `lib/automations/executor.ts:288`–`326` → `lib/channels/evolution.ts:424`–`432`.
   Confirma B7 como risco de go-live, com CWE-918/CWE-441/CWE-522.

### Correção de causalidade e triagem do parecer

- **B7 é real no alvo, mas sua causa raiz não nasceu em `f45d8dc`.** Os blobs de
  `lib/channels/evolutionCredentials.ts:93`–`131` e `lib/channels/evolution.ts:360`–`432` já eram
  iguais em `9c146ef`; PATCH + DELETE também já davam um gatilho manual. O commit LIVE acrescentou
  o consumidor automático em `lib/automations/executor.ts:271`–`326`, ampliando a exposição de
  chave/PII. Portanto, “novo bloqueante” na seção 6 significa **finding novo nesta revisão**, não
  vulnerabilidade criada integralmente por este commit.
- **B2 continua bug confirmado e bloqueante de produto/consentimento**, mas o Codex Security o
  marcou `ignore` na política de vulnerabilidade: a sequência fail-open é determinística em
  `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:924`–`946`, porém não há
  evidência de que um atacante inferior consiga induzir a falha inicial do Postgres. Isso não
  revoga o blocker de release.
- **B5 continua recomendação defensiva**, mas foi suprimido como finding de segurança
  independente. `lib/channels/evolution.ts:62`–`100` aceita erro textual remoto e
  `lib/automations/executor.ts:329`–`333` o persiste sem redação; faltou prova de reflexão real da
  chave e de leitor adicional. Quando o host já é malicioso, ele recebe a chave no request de B7,
  então persistir o eco não cria uma segunda capacidade.

### Conferências e onde não apareceu finding novo

- O inventário nativo cobriu 9 fontes: as quatro rotas/bloco, executor, opt-out + teste e as duas
  migrations. `test/**` e a fixture não entraram no inventário nativo; ficaram cobertos pelas
  provas da seção 4, sem nova alegação de cobertura pelo plugin.
- `rtk vitest run lib/conversations/webhookAuth.test.ts lib/automations/optOut.test.ts`:
  **6/6, zero falhas**. O primeiro teste confirma explicitamente o fail-open legado em
  `lib/conversations/webhookAuth.test.ts:39`–`48`.
- **Sem finding novo:** autenticação/schema da rota execute
  (`app/api/internal/automations/execute/route.ts:17`–`45`), identidade do tick
  (`app/api/internal/automations/tick/route.ts:15`–`34`), authz/same-origin/allowlist de settings
  (`app/api/settings/automations-live/route.ts:84`–`104`, `:122`–`154`), detector integral de
  opt-out (`lib/automations/optOut.ts:29`–`53`) e privilégios/search path das RPCs
  (`supabase/migrations/20260913040000_funil_live_envio_real.sql:54`–`57`, `:861`–`862` e
  `supabase/migrations/20260913050000_funil_claim_sem_overflow.sql:105`–`108`).
- Nenhum banco/serviço remoto foi acessado, nenhum segredo foi semeado e nenhum teste criou
  fixture nova. Uso medido pelo workbench: `10.349.323` tokens totais, `10.300.979` de entrada,
  `9.744.384` de entrada em cache e `48.344` de saída (`coverage=complete`, 2 threads).

### Veredito sobre complementaridade

**Sim, vale usar as duas em sequência.** A `/cibersecurity` é melhor como baseline amplo de gates,
dependências e segredos; o Codex Security foi melhor para distinguir finding explorável de bug de
produto, provar caminhos completos e calibrar severidade/causalidade do diff. Nesta entrega ele não
adicionou um terceiro blocker: confirmou B1/B7, refinou a origem de B7 e evitou promover B2/B5 como
vulnerabilidades independentes sem evidência suficiente.
