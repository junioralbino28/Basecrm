# Mapa B — Comportamento da IA de WhatsApp (BaseCRM)

Repositório: `C:\Users\PC Gamer\WorkSync\projetos\Basecrm-worktrees\central-agentes`
Branch: `feat/central-agentes` — commit `335f32b572057f70c3843c817d52bb98e78e3e19`
Levantamento só-leitura, feito em 29/09/2026. Todo caminho é relativo à raiz do repo acima.

Nota geral importante: o tipo TypeScript `ChannelConnectionConfig` em `lib/channels/types.ts:9-16`
só declara `apiUrl, instanceName, webhookUrl, webhookSecret, apiKey, sendMode`. NENHUM dos campos de
comportamento de IA abaixo (`aiEnabled`, `aiIdleNudge`, `media`, `manualReplyPausesAI`, `aiAgentName`,
`aiPromptKey`, `meetingHostName`, `meetingChannelText`, `signManualReplies`, `automationSendSpacing`)
está nesse tipo. Todo o código de runtime lê `config` como `Record<string, unknown>` cru e ignora esse
tipo — ele está desatualizado/não reflete a config real gravada no banco.

---

## 1. Agrupar mensagens / debounce antes de responder

| Campo | Detalhe |
|---|---|
| (a) onde mora | **NÃO é campo de configuração.** É constante hard-coded na rota do webhook. |
| (b) valor padrão | `7000` ms nas mensagens normais; `2000` ms quando a mensagem chega por clique de anúncio (`parsed.adClick` truthy). |
| (c) onde é lido/calculado | `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:1425` — `const aiDebounceMs = parsed.adClick ? 2000 : 7000;`. Usado em `processDeferredAIReply` (linha 135: `await sleep(aiDebounceMs)`), dentro de `after()` (linha 1469). |
| (d) onde é gravado | Não há escrita pela API — não existe campo de config nem rota que grave isso. O valor calculado é persistido só como rastro operacional em `conversation_threads.metadata.aiDebounceMs` (linha 1459) e ecoado em `ai_timing.ai_debounce_ms` da mensagem de saída (linha 293/297), mas nunca é LIDO de volta do banco — é sempre recalculado na hora pela mesma regra fixa. |
| (e) tela | Nenhuma. |
| (f) testes | Nenhum teste dedicado ao valor 7000/2000 foi encontrado (procurei em `route.*.test.ts` da pasta do webhook por "7000", "2000", "adClick" combinado com debounce — não achei asserção direta sobre o número). `route.aiGate.test.ts`, `route.post.test.ts` cobrem o fluxo do gate mas não fixam o valor do debounce. |

**Implicação para "campo ausente = comportamento de hoje":** como não existe campo, qualquer novo
campo de config para isto precisa ter fallback explícito para 7000/2000 codificado no resolver, e a
condição `parsed.adClick` (que já existe) não pode ser substituída — hoje ela é o único critério do
valor menor.

---

## 2. Dividir a resposta em várias mensagens de WhatsApp (+ intervalo entre partes)

| Campo | Detalhe |
|---|---|
| (a) onde mora | **NÃO é campo de configuração.** Função pura `splitReplyIntoParts` em `lib/conversations/aiReply.ts:207-252`. |
| (b) valor padrão/regra | Divide primeiro por parágrafo (`\n{2,}`, linha 212); se só sobrar 1 parágrafo, tenta dividir por frase quando o parágrafo passa de **240 caracteres** (linha 220, 226, 238); agrupa frases num buffer até 240 chars; corta em no máximo **3 partes** (`slice(0, 3)`, linha 251). Envio das partes é **sequencial, sem espera entre elas** — loop `for (const part of replyParts) { await sendEvolutionTextMessage(...) }` em `aiReply.ts:905-915`, sem `sleep`/`setTimeout` no meio. O parâmetro `options.delay` do payload Evolution vem hard-coded em `0` em `lib/channels/evolution.ts:464` (no modo `number_textMessage`; os outros 3 formatos de envio nem têm campo de delay). |
| (c) onde é lido | `generateConversationAutoReply`/execução da resposta nativa chama `splitReplyIntoParts(effectiveReplyText)` em `aiReply.ts:885`. |
| (d) onde é gravado | Não há escrita pela API — nenhum campo de config existe para o limite de caracteres, o máximo de partes ou o intervalo entre envios. |
| (e) tela | Nenhuma. |
| (f) testes | Não encontrei arquivo de teste dedicado a `splitReplyIntoParts` (procurei `*.test.ts` em `lib/conversations/` com "splitReply", "reply_part", "240" — sem resultado direto; `aiReply.aiGate.test.ts`, `aiReply.medicao.test.ts`, `aiReply.meetingSlots.test.ts`, `aiReply.threadStateGuard.test.ts` cobrem outros aspectos do mesmo arquivo). Marcar como **não encontrado** teste que trave o corte em 240/3 partes. |

---

## 3. Memória: quantas mensagens do histórico vão para o modelo

| Campo | Detalhe |
|---|---|
| (a) onde mora | **NÃO é campo de configuração.** Constante no `.limit(12)` da query. |
| (b) valor padrão | 12 mensagens (`conversation_messages`, mais recentes, revertidas para ordem cronológica). |
| (c) onde é lido | `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:193-200` dentro de `processDeferredAIReply`: `.order('sent_at', {ascending:false}).order('created_at',{ascending:false}).limit(12)`, depois `.slice().reverse()` na linha 210. |
| (d) onde é gravado | Não há escrita pela API — não existe campo de config para este número. |
| (e) tela | Nenhuma. |
| (f) testes | Não encontrei teste que fixe o número 12 (busquei "limit(12)", "recentMessages" nos arquivos de teste do webhook e de `aiReply`; os testes existentes montam listas de mensagens de tamanho arbitrário sem verificar o teto). |

---

## 4. Mídia recebida — `media.mode` por conexão

| Campo | Detalhe |
|---|---|
| (a) onde mora | `channel_connections.config.media.mode` (string dentro de objeto). |
| (b) valor padrão quando ausente | `'off'` — comportamento de sempre (sem transcrição/descrição). Tipo: `'off' \| 'record' \| 'understand'`. |
| (c) onde é lido | `lib/conversations/inboundMedia.ts:63-68` — `resolveInboundMediaMode`: le `config.media`; se não é objeto ou `mode` não é `'record'`/`'understand'`, cai em `'off'`. Consumido no webhook em `route.ts:817` (`const mediaMode = resolveInboundMediaMode(connectionConfig)`) e de novo dentro de `processDeferredAIReply` na linha 186 (`resolveInboundMediaMode(freshConnectionConfig) === 'understand'` para decidir se espera mídia pendente). |
| (d) onde é gravado | **Não há escrita pela API.** A rota `PATCH .../channels/[connectionId]/route.ts` (`ChannelUpdateSchema`, linhas 24-54) NÃO tem `media` no schema — não existe validação zod nem merge para este campo. Só é gravável hoje direto no banco/migration. |
| (e) tela | Nenhuma tela expõe (confirmado por busca em `features/`: nenhuma ocorrência de `media.mode`/`config.media`). |
| (f) testes | `app/api/public/channels/evolution/[connectionId]/webhook/route.media.test.ts` e `route.mediaUnderstand.test.ts` cobrem o comportamento runtime (parsing e roteamento de entendimento), mas não cobrem escrita/validação porque não existe rota de escrita. |

---

## 5. Cutucada de inatividade (`aiIdleNudge`)

| Campo | Detalhe |
|---|---|
| (a) onde mora | `channel_connections.config.aiIdleNudge` (objeto), por conexão. |
| (b) valor padrão quando ausente | `enabled: true` (linha 100, `source.enabled !== false` — ou seja, SÓ desliga se `enabled === false` explícito), `delayMinutes: 15` (`DEFAULT_IDLE_NUDGE_DELAY_MINUTES`), `text: 'Ainda estou por aqui. Quando quiser, seguimos de onde paramos.'`, `deferredResumeHour: 9`, `deferredText: 'Bom dia! Voltando como combinamos. Quando puder, seguimos de onde paramos.'`, `timezone: 'America/Sao_Paulo'`. Tudo em `lib/conversations/idleNudge.ts:18-34` (constantes) e `resolveIdleNudgeConfig` (linhas 69-107, leitura tolerante campo a campo — zod `IdleNudgeConfigSchema.strict()` primeiro, linhas 48-61, com fallback manual se o zod falhar). |
| (c) onde é lido | Runtime: `processDeferredAIReply` em `route.ts:440` (`resolveIdleNudgeConfig(freshConnectionConfig)`), decide se agenda (linha 465: `if (!idleNudge.enabled \|\| !shouldScheduleIdleNudge(...)) return;`). Quem **envia** de fato é o tick separado `lib/conversations/idleNudgeRunner.ts` (`sendDueConversationNudges`, citado no comentário da linha 429-431 do webhook) — não roda dentro do request do webhook, só agenda `aiInactivityNudgeDueAt` na metadata da conversa (`buildIdleNudgeScheduleMetadata`, linhas 184-209). |
| (d) onde é gravado | `PATCH .../channels/[connectionId]/route.ts` — schema na linha 39: `aiIdleNudge: IdleNudgeConfigSchema.partial().optional()`. Merge campo a campo nas linhas 127-140: parte do valor atual resolvido (`resolveIdleNudgeConfig(merged)`) e só sobrescreve os campos que vieram no payload — nunca apaga campo não enviado (comentário explícito nas linhas 129-131 avisando que um `spread` ingênuo apagaria configuração já feita). |
| (e) tela | Não encontrei ocorrência de `aiIdleNudge` em `features/` (a UI de `TenantChannelsPage.tsx` não tem esse campo) — **não exposto na tela hoje**, apesar de ter rota de escrita pronta. |
| (f) testes | `lib/conversations/idleNudge.test.ts`, `lib/conversations/idleNudgeRunner.test.ts`, e no webhook `route.idleNudge.test.ts`. |

---

## 6. Encerramento depois de passar para humano (`closingReply`)

| Campo | Detalhe |
|---|---|
| (a) onde mora | Constantes de código (não configuráveis por conexão): `CLOSING_REPLY_MAX = 2`, `CLOSING_REPLY_WINDOW_MINUTES = 60` em `lib/conversations/closingReply.ts:14-15`. O único pedaço configurável por conexão é `config.meetingChannelText` (ver item 9). |
| (b) valor padrão | Máx. 2 respostas, dentro de 60 min do handoff; `DEFAULT_MEETING_CHANNEL_TEXT = 'a combinar por aqui antes do horario'` quando `meetingChannelText` está ausente (linha 16, 21-24). |
| (c) onde é lido | `resolveClosingReplyEligibility` (linhas 35-72): só elegível se `status === 'human_queue'` (não `human_active`), handoff existe e foi feito pela própria IA (compara `handoffRequestedAt` com `lastHandoff.requestedAt`, tolerância de 1s, linhas 49-55), não é falha da IA (linha 57-61), dentro da janela de 60 min (linha 63-66) e `repliesUsed < CLOSING_REPLY_MAX` (linha 68-69). Chamado no webhook em dois pontos: `route.ts:176` (dentro do `processDeferredAIReply`, decide se a IA ainda responde) e `route.ts:1360` (antes de agendar a resposta, decide se entra no fluxo de debounce). Contador incrementado por `buildClosingReplyMetadata` (linhas 138-147), incrementado em algum ponto de `aiReply.ts` após enviar a resposta de encerramento (procurei e o incremento ocorre fora deste arquivo, no dispatch de `executeConversationAIReply` — não abri esse trecho neste levantamento; se precisar do local exato do incremento eu confirmo). |
| (d) onde é gravado | `meetingChannelText`: `PATCH .../channels/[connectionId]/route.ts:43` (`meetingChannelText: z.string().trim().max(200).optional()`), merge na linha 142 (`if (incoming.meetingChannelText !== undefined) merged.meetingChannelText = incoming.meetingChannelText \|\| undefined;` — string vazia limpa e volta ao padrão). `CLOSING_REPLY_MAX`/`CLOSING_REPLY_WINDOW_MINUTES`: **não há escrita pela API** — são constantes de código, não config de banco. |
| (e) tela | Não encontrei `meetingChannelText` em `features/` — **não exposto na tela hoje**, apesar de a rota de escrita existir. |
| (f) testes | `lib/conversations/closingReply.test.ts`. No webhook, `route.closing.test.ts`. |

---

## 7. Espaçamento entre envios de automação (`automationSendSpacing`)

| Campo | Detalhe |
|---|---|
| (a) onde mora | `channel_connections.config.automationSendSpacing = { minSeconds, maxSeconds }`. **Só existe hoje na função SQL** `public.defer_automation_jobs_before_claim`, migration `supabase/migrations/20260928010000_automation_send_spacing.sql`. Não há leitura/escrita em nenhum arquivo `.ts` do repositório (busquei "automationSendSpacing" em todo `*.ts` — zero ocorrências). |
| (b) valor padrão quando ausente | Desligado — espaçamento só ativa quando `spacing_min >= 1` E `spacing_max >= spacing_min` (linhas 131-133 da migration); com o campo ausente, `spacing_min`/`spacing_max` caem em `0` (linhas 66-69: regex `^[0-9]{1,6}$` sobre `config #>> '{automationSendSpacing,minSeconds}'`, senão `0`), e a fila normal (imediata) roda como hoje. |
| (c) onde é lido | Só dentro da própria função SQL (linhas 66-69, 130-184) — junta com `channel_connections` via `left join`, calcula um "cursor" por conexão dentro do laço do lote (`v_cursors jsonb`) para não deixar dois jobs do mesmo lote saírem juntos. Só vale para `job_type = 'send_message'` de automação (régua); respostas da IA na conversa **não passam por aqui** (comentário explícito na migration, linha 16). |
| (d) onde é gravado | **Não há escrita pela API.** Não existe rota nem schema zod para este campo — hoje só é gravável direto no banco. |
| (e) tela | Nenhuma. |
| (f) testes | **Não encontrado.** Não há teste `.sql`/pgTAP nem teste TS que exercite `defer_automation_jobs_before_claim` com `automationSendSpacing` (busquei por "spacing" em todo o repo fora de migrations — só achei a doc `docs/features/follow-up/FOLLOWUP-CENNO-12-TOQUES.md`, que é documentação, não teste). |

---

## 8. `manualReplyPausesAI` (resposta pelo celular pausa a IA)

| Campo | Detalhe |
|---|---|
| (a) onde mora | `channel_connections.config.manualReplyPausesAI` (boolean), por conexão. |
| (b) valor padrão quando ausente | `false` (desligado) — `lib/conversations/routing.ts:27-29`: `return config?.manualReplyPausesAI === true;`. Comportamento de hoje sem o campo: nada muda quando chega uma mensagem outbound pelo aparelho. |
| (c) onde é lido | `resolveManualReplyPausesAI` chamado em `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:944`, dentro do cálculo de `manualReplyTakesOver` (linhas 942-945: exige também `direction === 'outbound'` e `status !== 'closed'`). Efeitos: muda o status da conversa para `human_active` (linhas 985, 1029-1031), grava `aiLockedReason: 'manual_reply_from_device'` (linha 1002/1061), e pausa réguas via RPC `pause_automation_enrollments_for_thread` (linhas 1083-1111). |
| (d) onde é gravado | **Não há escrita pela API.** Não está no `ChannelUpdateSchema` da rota PATCH (confirmei a lista completa do schema, linhas 24-54 do route.ts — o campo não aparece). Só gravável direto no banco hoje. |
| (e) tela | Não encontrado em `features/` (nenhuma ocorrência de `manualReplyPausesAI`). |
| (f) testes | `app/api/public/channels/evolution/[connectionId]/webhook/route.manualReply.test.ts`. |

---

## 9. `aiAgentName`, `aiPromptKey`, `meetingHostName`, `meetingChannelText`, `signManualReplies`

| Campo | (a) onde mora | (b) padrão ausente | (c) onde é lido | (d) onde é gravado | (e) tela | (f) testes |
|---|---|---|---|---|---|---|
| `aiAgentName` | `channel_connections.config.aiAgentName` (string) | `'Assistente'` (`DEFAULT_CONVERSATION_AI_AGENT_NAME`, `lib/conversations/aiAgentConfig.ts:4`) — cai no padrão também se o valor não casar o regex `^[\p{L}\p{N} .'-]{1,80}$` (linha 7, 20-22) | `resolveConversationAIAgentConfig`, `aiAgentConfig.ts:15-29`; usado como `authorName` da mensagem de saída (`route.ts:288`, `agentName` no `processDeferredAIReply`) | `route.ts` (channels/[connectionId]) schema linha 35, merge linha 124 | UI: sim (toggle/campo, confirmado no `TenantChannelsPage.tsx`, mas não abri a JSX em detalhe — o grep achou `aiAgentName` só no schema/lib, **não encontrei o campo na tela** — só `aiEnabled`/`signManualReplies` foram confirmados na UI) | `lib/conversations/aiAgentConfig.test.ts` |
| `aiPromptKey` | `channel_connections.config.aiPromptKey` (string) | `'task_conversations_whatsapp_auto_reply'` (`DEFAULT_CONVERSATION_AI_PROMPT_KEY`, `aiAgentConfig.ts:5`) — se vier preenchido mas inválido (não bate `isConversationAIPromptKey`), vira `null` (linha 23-27), e mais acima em `processDeferredAIReply` (`route.ts:227`) `promptKey ? generateConversationAutoReply(...) : { ok:false, reason:'missing_prompt' }` — ou seja, prompt inválido explícito DESLIGA a IA nativa (diferente de campo ausente, que usa o padrão) | mesma função `resolveConversationAIAgentConfig` | `route.ts` schema linha 36 (`refine(isConversationAIPromptKey)`), merge linha 125 | Não encontrado na tela (`TenantChannelsPage.tsx` não tem `aiPromptKey`) | `aiAgentConfig.test.ts` |
| `meetingHostName` | `channel_connections.config.meetingHostName` (string) | Cadeia de fallback: nome configurado → nome do responsável da agenda (perfil) → `'a equipe comercial'` (`DEFAULT_MEETING_HOST_NAME`, `lib/conversations/aiPromptContext.ts:7,45-62`); regex de validação `^[\p{L}\p{N} .'-]{1,80}$` | `readConfiguredMeetingHostName`/`pickMeetingHostName` (`aiPromptContext.ts:36-62`), usado em `resolveMeetingHostName` (`aiReply.ts:347-371`) para compor o prompt de reunião/encerramento (`closingReply.ts` `buildClosingStageContext`) | `route.ts` schema linha 41 (vazio permitido, limpa o campo), merge linha 141 | Não encontrado na tela | `aiPromptContext.test.ts` |
| `meetingChannelText` | ver item 6 | ver item 6 | ver item 6 | ver item 6 | Não encontrado na tela | `closingReply.test.ts` |
| `signManualReplies` | `channel_connections.config.signManualReplies` (boolean) | `false`/desligado — `resolveAssinaturaAtivada`, `lib/conversations/assinaturaAtendente.ts:29-31`: só liga com `=== true` explícito ("nasce desligado em todo cliente") | `assinarMensagemDoAtendente` (`assinaturaAtendente.ts:59-75`) prefixa `"Nome: texto"` só no texto ENVIADO à Evolution (nunca no `content` gravado — comentário explícito linhas 11-13); exige nome resolvido via `resolveNomeDoAtendente` (linhas 39-57), senão não assina mesmo ligado | `route.ts` schema linha 46, merge linha 145 (grava `false` explicitamente em vez de apagar, para a tela distinguir "desligado" de "nunca configurado") | **Confirmado na tela** — `features/platform/tenants/TenantChannelsPage.tsx:768` (PATCH) e `:1145` (leitura do estado atual) | `assinaturaAtendente.test.ts`, `lib/conversations/assinaturaFronteira.test.ts` |

---

## 10. IA ligada/desligada por número e por organização (+ `ai_feature_flags`)

Existem **três camadas independentes**, todas precisam estar OK para a IA nativa responder:

### 10a. Por conexão/número — `channel_connections.config.aiEnabled`
- (a) onde mora: `config.aiEnabled` (boolean).
- (b) padrão ausente: **desligado** — toda leitura usa `=== true` estrito (nunca `!== false`). Ex.: `route.ts:777` (`const aiEnabled = connectionConfig.aiEnabled === true`), `route.ts:131` (dentro de `processDeferredAIReply`: `if (connectionConfig.aiEnabled !== true) return;`), `conversationAIGate.ts:34` (`if (connection.config?.aiEnabled !== true) return {ok:false, reason:'connection_ai_disabled'}`).
- (c) onde é lido: em toda a rota do webhook (define se a conversa nasce `ai_active` ou `human_queue`, linha 937 via `getConversationStatusAfterInbound`) e no gate `loadFreshConversationAIGate` (`lib/conversations/conversationAIGate.ts:14-36`).
- (d) onde é gravado: `route.ts` (channels/[connectionId]) schema linha 34, merge linha 123. Exige permissão `whatsapp.manage_connection` (ver seção final) — **hoje o admin do cliente (`clinic_admin`) NÃO tem essa permissão** (negada em `lib/auth/permissions.ts:187-191`), então ele não consegue pausar a IA por ESTE campo.
- (e) tela: sim — `TenantChannelsPage.tsx:725` (PATCH) e `:1121` (leitura).
- (f) testes: `lib/conversations/conversationAIGate.test.ts`, `route.aiGate.test.ts`.

### 10b. Por organização — `organization_settings.ai_enabled` (+ provedor/modelo/chave)
- (a) onde mora: colunas `organization_settings.ai_enabled, ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key`.
- (b) padrão ausente: `ai_enabled` cai em `true` quando a linha de settings não existe ainda (`app/api/settings/ai/route.ts:56`: `typeof orgSettings?.ai_enabled === 'boolean' ? orgSettings.ai_enabled : true`) — **atenção: esse default é o OPOSTO do default do gate de geração**, que em `aiReply.ts:417` (`generateConversationAutoReply`) trata `orgSettings?.ai_enabled !== true` como desligado (`reason: 'ai_disabled'`) quando a linha não existe (`orgSettings` viria `null`, `undefined !== true` → desligado). Ou seja: a TELA mostraria "ligado" (fallback true) para uma organização sem linha em `organization_settings`, mas a GERAÇÃO real trataria como desligada. Vale investigar/confirmar antes de espelhar esse campo na Central de Agentes — pode já ser bug de UI hoje, fora do escopo deste levantamento (só leitura).
- (c) onde é lido: `generateConversationAutoReply`, `aiReply.ts:409-419`.
- (d) onde é gravado: `app/api/settings/ai/route.ts` POST (linhas 88-152). Regra de permissão: **decisão "o cliente pausa, não configura"** — `mexeNaConfiguracaoDoMotor` (provider/model/chaves) exige `auth.isAgencyAdmin` (linhas 108-117); `aiEnabled` sozinho passa para qualquer admin autenticado (`requireAdminTenantContext`), inclusive `clinic_admin`, que tem a permissão `ai.pause` mas não `ai.configure` (`lib/auth/permissions.ts` — `ai.configure` está em `CLINIC_ADMIN_DENIED`, `ai.pause` não está na lista negada).
- (e) tela: rota existe e claramente serve uma tela de configurações de IA da organização (não abri o componente React desta tela neste levantamento — não fazia parte da lista de arquivos pedida, mas a rota `app/api/settings/ai/route.ts` é consumida por alguma tela em `features/settings` ou similar).
- (f) testes: `app/api/settings/ai/route.test.ts`.

### 10c. `ai_feature_flags` (kill switch por organização + chave de feature)
- (a) onde mora: tabela `ai_feature_flags` — colunas usadas: `organization_id, key, enabled` (a definição completa da tabela está em `supabase/migrations/20251201000000_schema_init.sql`, não abri o DDL completo neste levantamento).
- (b) **comportamento quando a linha está ausente**: **desligado**. `lib/conversations/conversationAIGate.ts:38-50`: busca a linha com `key = 'ai_conversation_auto_reply'`; se `featureResult.data?.enabled !== true` (o que inclui `data === null`, ou seja, linha ausente) → `return {ok:false, reason:'feature_disabled'}`. **Isto é o oposto do padrão "seguro" que normalmente se espera de um feature flag ausente = ligado** — aqui ausência = IA nativa não responde. Qualquer migração/seed da Central de Agentes que crie conexões novas sem popular essa flag vai nascer com a IA nativa desligada nessa camada, mesmo com `config.aiEnabled = true` e `organization_settings.ai_enabled = true`.
- (c) onde é lido: só em `loadFreshConversationAIGate` (`conversationAIGate.ts:38-50`), chamado tanto no início do debounce (`route.ts:137-142`) quanto dentro de `generateConversationAutoReply` (`aiReply.ts:399-407`).
- (d) onde é gravado: não encontrei rota de API que grave `ai_feature_flags` (busquei "ai_feature_flags" em `app/api/**` — só aparece em leitura via `lib/ai/features/server.ts` e no gate; não achei INSERT/UPDATE em rota HTTP). Provavelmente é seed/migration/operação manual da agência. **Não encontrado**: rota de escrita.
- (e) tela: não encontrada.
- (f) testes: `lib/conversations/conversationAIGate.test.ts`.

---

## Tabela `channel_connections` — schema e tipo TS

- Migration de criação: `supabase/migrations/20260310010000_platform_channel_connections.sql:5-16`:
  ```
  id UUID PK, organization_id UUID NOT NULL FK organizations, provider TEXT, channel_type TEXT,
  name TEXT, status TEXT DEFAULT 'pending', config JSONB DEFAULT '{}', metadata JSONB DEFAULT '{}',
  last_healthcheck_at TIMESTAMPTZ NULL, created_at, updated_at
  ```
- RLS original (mesma migration, linhas 18-56): membros da org podem `SELECT`; só `role = 'admin'` pode `ALL` (INSERT/UPDATE/DELETE) — **essa policy é antiga (10/03) e não reflete mais os papéis atuais** (`clinic_admin`, `agency_admin`, `agency_staff` vieram depois); confirmar se há RLS mais recente antes de assumir que esta é a que vale — não achei uma migration posterior que reescreva a policy desta tabela especificamente (busquei "channel_connections" em todas as migrations, lista completa no corpo do levantamento acima; nenhuma altera a `POLICY`). Como as rotas de API usam `createStaticAdminClient()` (service role, bypassa RLS) em todo lugar que li, a autorização real de hoje está nas rotas (`requireTenantAccess` + `whatsapp.manage_connection`), não na RLS desta tabela.
- Tipo TS: `lib/channels/types.ts:9-16` — ver nota geral no topo do documento; está incompleto/desatualizado em relação aos campos de comportamento de IA.
- Nenhuma migration formaliza `aiEnabled`, `aiIdleNudge`, `media`, `manualReplyPausesAI`, `aiAgentName`, `aiPromptKey`, `meetingHostName`, `meetingChannelText`, `signManualReplies`, `automationSendSpacing`, `leadEntryRoutes` como colunas — todos vivem dentro do `config JSONB` sem schema de banco, só validados no momento da escrita pela rota (quando existe rota) via Zod.

## Rota que altera a config de uma conexão

- **Rota**: `PATCH /api/platform/tenants/[tenantId]/channels/[connectionId]` — arquivo `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts:56-207`.
- **Validação**: Zod `ChannelUpdateSchema` (linhas 24-54), `.strict()` — payload com campo fora do schema é rejeitado com 400 (linha 66). Campos de config aceitos hoje: `apiUrl, instanceName, webhookUrl, webhookSecret, apiKey, sendMode, aiEnabled, aiAgentName, aiPromptKey, calendar, aiIdleNudge (partial), meetingHostName, meetingChannelText, signManualReplies`. **Ausentes do schema** (logo, "não há escrita pela API" para eles): `media`/`media.mode`, `manualReplyPausesAI`, `automationSendSpacing`, `leadEntryRoutes` (rotas de entrada por anúncio, lidas em `readLeadEntryRoutes`/`resolveLeadEntryRoute`, não explorado a fundo neste levantamento pois não estava na lista de itens pedida, mas confirmo que não está no `ChannelUpdateSchema`).
- **Semântica de merge**: NÃO é um `PATCH` que apaga campos não enviados. A rota lê a config atual do banco (`current.data.config`, linha 93-98) e monta `nextConfig` fazendo spread da config atual (`{ ...(current.data.config || {}) }`, linha 117) e só sobrescrevendo campo a campo quando `incoming.<campo> !== undefined` (linhas 119-156). Caso especial: `aiIdleNudge` faz merge um nível mais fundo — não substitui o objeto inteiro, resolve o valor atual completo (`resolveIdleNudgeConfig(merged)`) e sobrescreve só as subchaves que vieram (linhas 127-140), com comentário explícito no código alertando que um merge raso apagaria configuração já feita. `webhookSecret` e `sendMode` têm fallback especial: se nunca configurados, um novo `webhookSecret` é gerado automaticamente (linha 146-153) e `sendMode` vira `'auto'` (linha 157) — únicos dois campos que a rota preenche sozinha mesmo sem o cliente mandar nada.
- **Efeito colateral de segurança**: quando o payload mexe em `apiUrl` ou `apiKey`, reabre a validação do par URL/chave (`validateEvolutionPairForWrite`, linhas 166-169) — mudar só IA ou `sendMode` não reabre essa checagem.

## Checagens de permissão na rota PATCH

- `isAllowedOrigin(req)` — CSRF/same-origin (linha 57).
- `requireTenantAccess(tenantId, { requiredPermissions: ['whatsapp.manage_connection'] })` (linhas 60-63) — TODO o corpo da rota, incluindo `aiEnabled`, está atrás desta ÚNICA permissão. Não existe hoje granularidade por campo dentro desta rota (diferente da rota `/api/settings/ai`, que separa `ai.pause` de `ai.configure`).
- **Quem tem `whatsapp.manage_connection`**: `agency_admin` e `admin` (mapa "tudo liberado", `permissions.ts:202-203`). **Quem NÃO tem**: `clinic_staff` (negado desde sempre, `permissions.ts:150`) e `clinic_admin` — **negado desde 26/09/2026 por decisão explícita do Junior** (comentário em `permissions.ts:177-191`: "as conexões, configuração de IA, webhook, ficam APENAS na agência"), e também `agency_staff` (negado, `permissions.ts:195`).
- **Decisão "o cliente pausa, não configura"**: implementada, mas em **rota diferente** (`/api/settings/ai`, que mexe em `organization_settings.ai_enabled`, ver item 10b) — não na rota de `channel_connections`. Na rota de `channel_connections`, hoje o `clinic_admin` **não consegue nem pausar** a IA por número (`aiEnabled` do `config`), porque a rota inteira exige `whatsapp.manage_connection`, que ele não tem. Ou seja: existem DOIS interruptores de "ligar/desligar IA" (organização e conexão) e a regra "cliente só pausa" hoje só está implementada para o de organização. Isso é um ponto que a Central de Agentes provavelmente vai precisar decidir explicitamente: se o `clinic_admin` deve ganhar um novo endpoint/permissão restrita para pausar `config.aiEnabled` por número sem herdar o resto de `whatsapp.manage_connection` (URL, chave, webhook, prompt).
- Vínculo agência↔cliente: se quem chama é `agency_admin` de organização diferente do `tenantId`, a rota garante o vínculo antes de prosseguir (`ensureTenantAgencyBinding`, linhas 69-91) — não é checagem de permissão em si, é setup de credencial compartilhada.

---

## Resumo dos "não encontrados" (para não fabricar)

- Teste dedicado ao valor 7000/2000 ms do debounce — não encontrado.
- Teste dedicado ao corte de 240 caracteres / máximo de 3 partes da resposta — não encontrado.
- Teste dedicado ao `.limit(12)` de histórico — não encontrado.
- Teste (SQL/pgTAP ou TS) para `automationSendSpacing` / `defer_automation_jobs_before_claim` — não encontrado.
- Rota de escrita HTTP para `media.mode`, `manualReplyPausesAI`, `automationSendSpacing`, `leadEntryRoutes` — não existe (confirmado pela leitura completa do `ChannelUpdateSchema`).
- Rota de escrita HTTP para `ai_feature_flags` — não encontrada (parece ser operação manual/seed da agência).
- Tela que exposte `aiIdleNudge`, `meetingHostName`, `meetingChannelText`, `media.mode`, `manualReplyPausesAI`, `automationSendSpacing` — não encontrada em `features/` (só `aiEnabled` e `signManualReplies` confirmados na UI de `TenantChannelsPage.tsx`; `aiAgentName`/`aiPromptKey` têm rota de escrita mas não achei o campo correspondente na JSX).
- DDL completo da tabela `ai_feature_flags` — não abri (está em `supabase/migrations/20251201000000_schema_init.sql`, migration de schema inicial grande; localizei a referência mas não fiz a leitura linha a linha do CREATE TABLE).
- Local exato do incremento de `aiClosingReplies` (função `buildClosingReplyMetadata` existe, mas não confirmei em qual arquivo/linha ela é chamada após o envio bem-sucedido — provavelmente dentro de `executeConversationAIReply` em `aiReply.ts`, que não li por completo).
