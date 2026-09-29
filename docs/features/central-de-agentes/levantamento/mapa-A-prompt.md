# Mapa A — montagem do prompt de IA de atendimento (BaseCRM)

Repo: `C:\Users\PC Gamer\WorkSync\projetos\Basecrm-worktrees\central-agentes`
Branch: `feat/central-agentes`, commit `335f32b572057f70c3843c817d52bb98e78e3e19` (leitura em 2026-09-29, só leitura, sem consulta ao banco).

---

## 1. Caminho completo: webhook → montagem do system prompt → chamada do modelo

**Entrada (webhook):** `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`
- A rota recebe o evento da Evolution API, grava a mensagem inbound e agenda (via `after()`) a função `processDeferredAIReply` (definida no mesmo arquivo, `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:87`).
- `processDeferredAIReply` espera o debounce (`aiDebounceMs`), recarrega a conexão fresca (`loadFreshConversationAIGate`) e resolve agente/prompt:
  - `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:145` — `const { agentName, promptKey } = resolveConversationAIAgentConfig(freshConnectionConfig);`
  - `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:227-239` — chama `generateConversationAutoReply({ ..., promptKey, closing, threadMetadata })`. Se `promptKey` vier `null` (chave inválida gravada na conexão), nem chama o modelo: cai direto em `{ ok: false, reason: 'missing_prompt' }`.

**Resolução da chave do template (`aiPromptKey`):** `lib/conversations/aiAgentConfig.ts`
- `lib/conversations/aiAgentConfig.ts:5` — `DEFAULT_CONVERSATION_AI_PROMPT_KEY = 'task_conversations_whatsapp_auto_reply'`.
- `lib/conversations/aiAgentConfig.ts:15-29` — `resolveConversationAIAgentConfig(config)` lê `config.aiPromptKey` da **conexão de canal** (`channel_connections.config`, um JSON por número de WhatsApp). Se `config.aiPromptKey` estiver vazio → usa o default (`task_conversations_whatsapp_auto_reply`, o prompt da Dra. Jéssica). Se vier preenchido, valida contra o catálogo (`isConversationAIPromptKey`, linha 11-13: precisa casar `^task_[a-z0-9_]{1,115}$` **e** existir em `getPromptCatalogMap()`); se for uma string que não bate com nenhuma chave do catálogo, o resultado é `null` (não cai no default — é isso que gera `missing_prompt` no webhook).
- **Quem grava `aiPromptKey`:** `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts:36` (schema Zod) e `:125` (merge no `config` da conexão), dentro do `PATCH` da rota `platform/tenants/.../channels/...`. Exige permissão `whatsapp.manage_connection` (linha 60-63) — é rota de **plataforma/agência**, não da tela do cliente. Não encontrei em migration/seed nenhum `UPDATE`/`INSERT` que grave `aiPromptKey = 'task_conversations_whatsapp_cenno_aurora'` para a conexão da Cenoura Hub — presumo (não verificado, sem acesso ao banco) que foi setado manualmente via essa rota ou direto no banco.

**Função que monta o texto final do prompt:** `generateConversationAutoReply`, em `lib/conversations/aiReply.ts:373-647`.
1. `lib/conversations/aiReply.ts:447-451` — busca o prompt resolvido: `getResolvedPrompt(admin, organizationId, promptKey)` (ver seção "override" abaixo). Se vier `null` (nem override nem chave no catálogo) → `{ ok: false, reason: 'missing_prompt' }`.
2. `lib/conversations/aiReply.ts:456-515` — monta todo o contexto (agenda, host da reunião, etiquetas, estágio da conversa — detalhado na seção 2) e chama `renderPromptTemplate(resolvedPrompt.content, { ... })` (linha 501) para substituir os placeholders `{{...}}`.
3. `lib/conversations/aiReply.ts:519-530` — `generateOnce()` chama `generateText({ model, maxOutputTokens: 4096, output: Output.object({ schema: ConversationAutoReplySchema }), prompt })` da SDK `ai`. O texto renderizado inteiro vai como `prompt` (não há `system` separado — é um único prompt de usuário/instrução).
4. `model` vem de `getModel(provider, apiKey, orgSettings.ai_model || AI_DEFAULT_MODELS[provider], ...)` (linha 440-445), com `provider`/chave de API lidos de `organization_settings` (linha 409-431) — **por organização**, não por conexão.

**Onde entra o override por organização (tabela `ai_prompt_templates`):** `lib/ai/prompts/server.ts:30-69`, função `getResolvedPrompt(supabase, organizationId, key)`.
- Linha 35-36: pega o fallback do catálogo estático (`getPromptCatalogMap()[key]`).
- Linha 38-44: consulta `ai_prompt_templates` filtrando `organization_id = X AND key = Y AND is_active = true` com `.maybeSingle()`.
- Linha 51-60: se achar linha com `content` não vazio → **substitui inteiramente** o template do catálogo (`source: 'override'`); não há merge/concatenação, é troca total do texto.
- Linha 62-68: se não houver linha ativa (nenhuma linha, ou erro de leitura) → cai no `defaultTemplate` do catálogo (`source: 'default'`). Se a chave nem existir no catálogo E não houver override → retorna `null`.
- **Como a versão ativa é escolhida:** por coluna `is_active = true` (não pela maior `version`). O índice único parcial `ai_prompt_templates_org_key_active_unique` (`supabase/migrations/20251201000000_schema_init.sql:575-577`) garante no máximo UMA linha ativa por `(organization_id, key)`. Versões antigas ficam na tabela com `is_active = false`, preservadas como histórico.
- **Se não houver nenhuma linha na tabela para aquela org/key:** comportamento = usa o `defaultTemplate` estático do catálogo, sem erro (é exatamente o caso de qualquer cliente que nunca teve um override salvo — ex.: presumivelmente a Dra. Jéssica hoje, ver observação abaixo).

**Observação importante (confidence: Medium, inferência a partir do código, sem consulta ao banco):** o `defaultTemplate` de `task_conversations_whatsapp_auto_reply` no catálogo (`lib/ai/prompts/catalog.ts:131-182`) já é o texto específico da "assistente virtual do consultório da Dra. Jessica Barros" — ou seja, esse prompt não é genérico, é o prompt de produção da Julia hoje **codificado como fallback do sistema**. Isso significa que, se não houver override na tabela para a organização da clínica, ela roda direto do catálogo (`source: 'default'`); só saberemos com certeza se há ou não uma linha override consultando o banco, o que não foi feito (regra: só leitura de código).

---

## 2. Lista completa de placeholders `{{...}}` da resposta automática de WhatsApp

O motor de substituição é `renderPromptTemplate` (`lib/ai/prompts/render.ts:17-23`): regex `/\{\{\s*([\w.]+)\s*\}\}/g`, suporta path `a.b.c`, variável ausente vira string vazia, não executa lógica.

Objeto de variáveis passado em `lib/conversations/aiReply.ts:501-515`:

| Placeholder | Linha (valor) | De onde vem |
|---|---|---|
| `{{organizationName}}` | `aiReply.ts:502` | `organizations.name` da org (query em `aiReply.ts:433-437`), fallback `'Organizacao'` |
| `{{contactName}}` | `aiReply.ts:503` | Parâmetro `contactName` passado pelo webhook (nome do contato no CRM/perfil do WhatsApp), fallback `'Lead'` |
| `{{contactPhone}}` | `aiReply.ts:504` | Parâmetro `contactPhone` (telefone canônico) |
| `{{currentDateTime}}` | `aiReply.ts:505` | `new Date().toISOString()` calculado em `aiReply.ts:456`, momento UTC |
| `{{currentDateTimeLocal}}` | `aiReply.ts:507` | `formatLocalDateTimeForPrompt(currentDateTime, timezone)` — `lib/conversations/aiPromptContext.ts:12-30` — formata dia da semana + data + hora no fuso da organização, ex. "terça-feira, 22/09/2026 10:05 (America/Sao_Paulo)" |
| `{{timezone}}` | `aiReply.ts:508` | `calendarAvailability.calendar?.timezone`, senão `organization_settings.automation_timezone`, senão `'America/Sao_Paulo'` (`aiReply.ts:466-469`) |
| `{{meetingHostName}}` | `aiReply.ts:509` | `resolveMeetingHostName()` (`aiReply.ts:347-371`): 1º `config.meetingHostName` da conexão (validado por regex, `aiPromptContext.ts:34-37`), 2º nome do responsável da agenda (`profiles.first_name/last_name/nickname`, nunca e-mail), 3º padrão `'a equipe comercial'` (`aiPromptContext.ts:8`) |
| `{{meetingChannelText}}` | `aiReply.ts:510` | `readMeetingChannelText(config)` — `lib/conversations/closingReply.ts:20-23` — `config.meetingChannelText` da conexão, senão `'a combinar por aqui antes do horario'` |
| `{{conversationStageContext}}` | `aiReply.ts:511` | Ver detalhe abaixo — bloco que descreve a "situação da conversa" |
| `{{recentMessagesText}}` | `aiReply.ts:512` | `formatRecentMessages(recentMessages)` — `aiReply.ts:175-205` — histórico formatado (ver detalhe abaixo) |
| `{{calendarContext}}` | `aiReply.ts:513` | `calendarAvailability.calendarContext`, de `loadAvailableMeetingSlots()` (`aiReply.ts:254-341`) → `formatMeetingAvailabilityContext()` em `lib/conversations/meetingAvailability.ts` (não lido byte a byte nesta rodada; texto final é a lista de horários livres ou uma das strings fixas `AGENDA_NAO_CONFIGURADA...` / `AGENDA_TEMPORARIAMENTE_INDISPONIVEL...`) |
| `{{availableTagsContext}}` | `aiReply.ts:514` | `buildAvailableTagsContext(tagCatalog)` de `lib/conversations/etiquetasSugeridas.ts`; só é consultado no banco (`loadTagCatalog`) **se** o prompt resolvido contém literalmente `{{availableTagsContext}}` (checado por regex em `aiReply.ts:484`, `wantsTagContext`) — prompts que não citam o placeholder nem disparam a consulta |

Placeholder condicional adicional:
- `{{conversationStageContext}}` só é usado pelos prompts que o citam; se `closing` (encerramento pós-handoff) for passado e o prompt resolvido **não contiver** `{{conversationStageContext}}`, a função devolve `{ ok: false, reason: 'closing_unsupported' }` (`aiReply.ts:476-480`) — trava explícita para não quebrar prompt antigo sem esse placeholder.

### `{{conversationStageContext}}` — como o valor é montado (`aiReply.ts:486-500`)
- Se `closing` (é resposta de encerramento pós-handoff): `buildClosingStageContext({ handoff, repliesUsed, meetingHostName, timezone, meetingChannelText })` — `lib/conversations/closingReply.ts` (função não lida por completo nesta rodada; monta texto começando com "ENCERRAMENTO" conforme citado no próprio catálogo do prompt da Aurora, linha 278-280 de `catalog.ts`).
- Senão: `buildConfirmedMeetingStageContext({ metadata: threadMetadata, meetingHostName, timezone, meetingChannelText, now })`, com fallback fixo `'ATENDIMENTO EM ANDAMENTO.'` se a função devolver vazio/null.

### `{{recentMessagesText}}` — texto concatenado FORA do sistema de placeholder simples (`aiReply.ts:175-205`)
- Sem mensagens: `'Sem historico anterior. Considere que pode ser o primeiro contato.'`.
- Com mensagens: cada linha vira `"- {DIRECAO} ({marca de midia, se houver}) | {autor} | {data}: {conteudo}"`, onde `DIRECAO` é `CRM` (outbound), `INTERNO` ou `LEAD`.
- Se **qualquer** mensagem do histórico tiver `metadata.media` (mídia recebida), o texto inteiro de `recentMessagesText` é **prefixado** com o bloco `INBOUND_MEDIA_AI_RULES` (constante de texto fixo, definida em `lib/conversations/inboundMediaPrompt.ts`, não citada como `{{...}}` — é concatenação literal feita em `aiReply.ts:204`: `` `${INBOUND_MEDIA_AI_RULES}\n${lines}` ``). Sem mídia no histórico, o texto é idêntico ao de sempre (comentário explícito no código, linha 203).
- Descrição de mídia por mensagem vem de `describeInboundMediaForAI()` (`lib/conversations/inboundMediaPrompt.ts:19-52`), ex.: "audio transcrito 0:42", "imagem descrita", "figurinha nao vista".

### Texto adicional concatenado FORA de qualquer placeholder
Não encontrado nenhum bloco extra colado diretamente no template renderizado (fora do objeto de `renderPromptTemplate`) além do prefixo `INBOUND_MEDIA_AI_RULES` descrito acima, que entra dentro do valor de `recentMessagesText`. A "instrução de formato de saída" (o que a IA deve retornar: `replyText`, `summary`, `shouldHandoff`, etc.) **não é injetada pelo runtime** — está escrita como texto fixo dentro de cada `defaultTemplate` do catálogo (seção "RETORNE APENAS UM OBJETO COM:" em `catalog.ts:175-179` e `:297-311`) e/ou dentro do override salvo na tabela; o runtime só garante a estrutura via `output: Output.object({ schema: ConversationAutoReplySchema })` (`aiReply.ts:527`), que é o schema Zod declarado em `aiReply.ts:105-145`.

---

## 3. `lib/ai/prompts/catalog.ts` — chaves do catálogo

Arquivo completo lido (`lib/ai/prompts/catalog.ts:1-324`). `PROMPT_CATALOG` tem **10 chaves**:

| key | título | usado por | é o default do sistema? |
|---|---|---|---|
| `task_inbox_sales_script` | Inbox · Script de vendas | `app/api/ai/tasks/inbox/sales-script` | não relacionado a WhatsApp auto-reply |
| `task_inbox_daily_briefing` | Inbox · Briefing diário | idem | não relacionado |
| `task_deals_objection_responses` | Deals · Respostas de objeção | idem | não relacionado |
| `task_deals_email_draft` | Deals · Rascunho de e-mail | idem | não relacionado |
| `task_deals_analyze` | Deals · Análise (coach) | idem | não relacionado |
| `task_boards_generate_structure` | Boards · Gerar estrutura | idem | não relacionado |
| `task_boards_generate_strategy` | Boards · Gerar estratégia | idem | não relacionado |
| `task_boards_refine` | Boards · Refinar com IA | idem | não relacionado |
| `agent_crm_base_instructions` | Agente · System prompt base (CRM Pilot) | `lib/ai/crmAgent`, `app/api/ai/chat` | não relacionado (chat interno do CRM, não WhatsApp) |
| `task_conversations_whatsapp_auto_reply` | Conversas · Atendimento automático WhatsApp | `lib/conversations/aiReply -> generateConversationAutoReply` | **SIM — é o `DEFAULT_CONVERSATION_AI_PROMPT_KEY`** (`aiAgentConfig.ts:5`); template default = prompt da "assistente virtual do consultório da Dra. Jessica Barros" (`catalog.ts:135`) |
| `task_conversations_whatsapp_cenno_aurora` | Conversas · Aurora · Cenoura Hub | `lib/conversations/aiReply -> generateConversationAutoReply` | não é o default do sistema; só é usado por conexões cujo `config.aiPromptKey` aponte explicitamente para essa chave |

**Quais clientes usam qual chave, segundo o código:**
- **Não há, em nenhum arquivo de código, migration ou seed, uma associação explícita "organização X → chave Y"** — essa associação vive em `channel_connections.config.aiPromptKey`, que é dado de runtime no banco (fora do escopo desta leitura, que foi só código).
- Evidência indireta por **nome/conteúdo do prompt**, não por configuração:
  - `task_conversations_whatsapp_auto_reply` (default): o texto do template cita literalmente "Dra. Jessica Barros" (`catalog.ts:135`) — indício forte [Inferred] de que é o prompt da clínica dela, mas só é PROVA se a conexão dela não tiver `aiPromptKey` configurado (cairia no default) e não tiver override na tabela.
  - `task_conversations_whatsapp_cenno_aurora`: o texto cita "Aurora, SDR da Cenoura Hub" (`catalog.ts:187-188`) — indício forte [Inferred] de que é o prompt da Aurora/Cenoura Hub, mas SÓ é usado de fato se a conexão da Cenoura Hub tiver `config.aiPromptKey = 'task_conversations_whatsapp_cenno_aurora'` gravado no banco.
- **Testes** (`lib/ai/prompts/catalog.aurora.test.ts`) testam exclusivamente o `defaultTemplate` de `task_conversations_whatsapp_cenno_aurora` direto do objeto `PROMPT_CATALOG` (import de `catalog.ts`), não testam contra o banco nem contra qual organização usa qual chave.
- **Conclusão (confidence: Low/Não verificado no banco):** por código, a separação Aurora/Julia é feita hoje por duas chaves de catálogo diferentes, escolhidas por número de WhatsApp via `channel_connections.config.aiPromptKey`. Não posso confirmar por leitura de código qual organização_id efetivamente está configurada com qual chave — isso está no banco, fora do escopo desta tarefa (só leitura de repositório, sem consulta a banco).

---

## 4. Tela "Central de I.A" — o que edita, rotas, quem acessa; schema de `ai_prompt_templates`

**Componente raiz:** `features/settings/AICenterSettings.tsx:1-71`
- Linha 20: `podeConfigurarMotor = isAgencyRole(profile?.role)` — só perfil de agência vê `AIConfigSection` (provedor/modelo/chave) e pode editar prompt.
- Linha 17: `isAdmin = canManageClinicSettings(profile?.role)` — admin do cliente (clínica) só vê o toggle "IA ativa na organização" (liga/desliga tudo) e os toggles de feature; não edita prompt.
- Linha 66: `<AIFeaturesSection podeEditarPrompt={podeConfigurarMotor} />`.

**O que a tela deixa editar:** `features/settings/components/AIFeaturesSection.tsx:1-381`
- Lista fixa `FEATURES` (linha 19-80, 10 itens hardcoded no componente) mapeando `feature.key` (feature flag) → `feature.promptKey` (chave do catálogo). O item de WhatsApp é:
  ```
  { key: 'ai_conversation_auto_reply', title: 'Atendimento WhatsApp', promptKey: 'task_conversations_whatsapp_auto_reply' }  // linhas 56-61
  ```
- **`task_conversations_whatsapp_cenno_aurora` NÃO aparece na lista `FEATURES`.** Ou seja: hoje a tela "Central de I.A" **não oferece nenhum jeito de abrir/editar o prompt da Aurora** pela interface — só o prompt-chave `task_conversations_whatsapp_auto_reply` (o "genérico"/Jéssica) tem botão de editor. Isso é achado relevante para o projeto da Central de Agentes: hoje não existe edição por UI do prompt específico da Cenoura Hub.
- Editor: clique no lápis (linha 264-273) chama `openPromptEditor(feature)` (linha 124-152) → `GET /api/settings/ai-prompts/{key}` (linha 132), preenche `textarea` com `active.content` (linha 142-145) ou o `defaultTemplate` do catálogo se não houver override.
- **Não mostra lista/histórico de versões** — só o conteúdo ativo atual. O botão "Reset" (linha 196-218) chama `DELETE /api/settings/ai-prompts/{key}` (desativa a linha ativa, sem apagar); "Salvar" (linha 171-194) chama `POST /api/settings/ai-prompts` com `{ key, content }` — cria versão nova (ver seção rotas).
- Não há campo de "trocar de agente" nem seleção de organização na tela — ela sempre edita para `auth.targetOrganizationId` resolvido no backend (via cookie de tenant selecionado, ver `adminTenantContext.ts`).

**Rotas de API (arquivo:linha):**
- `GET /api/settings/ai-prompts` — `app/api/settings/ai-prompts/route.ts:13-34`. Retorna `activeByKey` (mapa key → {version, updatedAt}) só das linhas `is_active=true` da org alvo. Exige `requireAdminTenantContext()` (agência OU admin do cliente — linha 15-16), sem exigir `isAgencyAdmin` — **porém a tela não chama esse endpoint** (não achei uso de `GET /api/settings/ai-prompts` sem `[key]` no componente lido; a `AIFeaturesSection` só chama a rota com `[key]`). Não confirmado onde esse `GET` root é consumido — busquei apenas nos arquivos de settings lidos.
- `GET /api/settings/ai-prompts/[key]` — `app/api/settings/ai-prompts/[key]/route.ts:12-30`. Retorna `{ key, active, versions }` (até 20 versões, ordenadas por `version desc`). Mesma auth (`requireAdminTenantContext`, sem exigir `isAgencyAdmin` no GET) — ou seja, tecnicamente um admin de clínica logado também consegue chamar esse GET e ver o conteúdo do prompt/histórico de versões, mesmo a tela não expondo o botão de editar para ele (`podeEditarPrompt=false` esconde o botão, mas não é validação de servidor no GET).
- `POST /api/settings/ai-prompts` — `app/api/settings/ai-prompts/route.ts:43-97`. Validação: `isAllowedOrigin` (linha 44), `requireAdminTenantContext()` (linha 47), **e exige `auth.isAgencyAdmin`** (linha 52-54) — só agência publica prompt. Body via Zod `UpsertPromptSchema` (`key` 3-120 chars, `content` 1-50000 chars, `.strict()`, linha 36-41). Lógica do "Publicar": lê a maior `version` existente (linha 62-68), calcula `nextVersion = lastVersion + 1` (linha 72-73), **desativa** a linha ativa atual (`UPDATE is_active=false`, linha 75-82) e **insere** nova linha `{ organization_id, key, version: nextVersion, content, is_active: true, created_by: auth.me.id }` (linha 84-92). Sem transação explícita no código (duas chamadas separadas ao Supabase) — risco de corrida entre `UPDATE` e `INSERT` se dois publish simultâneos (não testado; ver seção 6, não há teste disso).
- `DELETE /api/settings/ai-prompts/[key]` — `app/api/settings/ai-prompts/[key]/route.ts:32-55`. Mesma exigência de `isAgencyAdmin` (linha 41-43). Só desativa (`is_active=false`) a linha ativa — não apaga nada, não recria o default explicitamente (o "voltar ao padrão" acontece porque `getResolvedPrompt` cai no catálogo quando não há linha ativa).

**Quem pode acessar (resumo):**
- Ver toggle geral de IA + toggles de feature: qualquer admin (`canManageClinicSettings`, inclui admin de clínica).
- Ver/editar prompt pela tela: só `isAgencyRole` (`podeConfigurarMotor`) — agência.
- Publicar (`POST`) / resetar (`DELETE`) no servidor: exige `auth.isAgencyAdmin`, resolvido em `lib/platform/adminTenantContext.ts:38-40` a partir do `role` do profile (`isAgencyAdminRole`, definido em `lib/auth/scope.ts`, não lido nesta rodada — apenas referenciado).
- `GET` (ver conteúdo/versões) no servidor: exige só `requireAdminTenantContext()` — passa tanto para `isAgencyAdmin` quanto `isClinicAdmin` (linha 42-44 de `adminTenantContext.ts`), sem checagem adicional de `isAgencyAdmin` nas duas rotas GET. Ou seja, há uma diferença notável entre o que a UI esconde (edição só para agência) e o que o servidor permite ler (admin de clínica também consegue, via chamada direta à API).

**Schema da tabela `ai_prompt_templates`:** `supabase/migrations/20251201000000_schema_init.sql:553-610`
```sql
CREATE TABLE IF NOT EXISTS public.ai_prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` (linha 565).
- Índices: `idx_ai_prompt_templates_org_key` (linha 567), `idx_ai_prompt_templates_org_key_active` (linha 568), únicos `ai_prompt_templates_org_key_version_unique` (org+key+version, linha 571-572) e `ai_prompt_templates_org_key_active_unique` (org+key WHERE is_active, linha 575-577 — garante no máximo 1 linha ativa por chave/organização).
- RLS: `"Admins can manage ai prompts"` — `FOR ALL TO authenticated USING/WITH CHECK (auth.uid() IN (SELECT id FROM profiles WHERE organization_id = ai_prompt_templates.organization_id AND role = 'admin'))` (linha 580-598); `"Members can view ai prompts"` — `FOR SELECT TO authenticated USING (auth.uid() IN (SELECT id FROM profiles WHERE organization_id = ai_prompt_templates.organization_id))` (linha 600-610). **Nota:** essas policies usam a role `'admin'` genérica da tabela `profiles` — não distinguem `isAgencyAdmin` de `isClinicAdmin` (essa distinção fica só na camada de aplicação, `requireAdminTenantContext`/`isAgencyAdminRole`); a rota usa `createClient()` (cliente autenticado do usuário, respeitando RLS) nas duas rotas de `ai-prompts`, então a RLS acima efetivamente também governa o acesso direto ao banco.
- **GRANT:** não encontrei nenhuma linha `GRANT ... ON public.ai_prompt_templates` explícita no arquivo de migration (busquei em todo `supabase/migrations/*.sql`, único resultado de `GRANT` relacionado a "ALL TABLES"/"DEFAULT PRIVILEGES" foi `supabase/migrations/20260916010000_r09_tirar_truncate_de_anon_e_authenticated.sql:36`, que revoga TRUNCATE de `anon, authenticated` para todas as tabelas — não é grant positivo). Não fabrico a causa: presumo (não verificado) que a tabela recebe os grants padrão do Supabase (privilégios default aplicados a toda tabela nova em `public` para `anon/authenticated/service_role`), como é comportamento padrão de projeto Supabase — mas isso está fora do repositório de migrations e não pude confirmar sem consultar o banco.

---

## 5. Cache de prompt ou configuração de IA entre requisições

**Não encontrado.** Busquei por `unstable_cache`, `new Map()`, `globalThis.`, `cache(` em `lib/ai/`, `lib/conversations/aiReply.ts` e `lib/ai/prompts/` — único resultado foi `lib/ai/medicaoResposta.ts:38`, que só usa `globalThis.fetch` como fallback de função fetch (não é cache de dado).
- `getResolvedPrompt()` (`lib/ai/prompts/server.ts:30`) faz uma consulta nova ao Supabase a cada chamada — sem memoização.
- `generateConversationAutoReply()` também relê `organization_settings` (`aiReply.ts:409-413`) e a conexão (via `loadFreshConversationAIGate`, chamado de novo dentro de `processDeferredAIReply`) a cada execução — o próprio nome da função (`loadFreshConversationAIGate`, "Fresh") e comentários no código (`aiReply.ts:174` do webhook: "a decisão é tomada pelo estado FRESCO") indicam que releitura sem cache é decisão deliberada, para refletir mudança de config/handoff feita por humano durante o debounce.
- Conclusão: qualquer edição de prompt (via `POST /api/settings/ai-prompts`) vale imediatamente na próxima geração, sem necessidade de invalidar cache — não existe cache a invalidar.

---

## 6. Testes que verificam conteúdo ou montagem do prompt

Arquivos encontrados sob `lib/ai/prompts/` e `lib/conversations/aiReply*`:

- **`lib/ai/prompts/catalog.aurora.test.ts`** — o mais extenso e diretamente relevante. Testa o `defaultTemplate` de `task_conversations_whatsapp_cenno_aurora` direto do objeto `PROMPT_CATALOG` (sem passar por `getResolvedPrompt` nem banco). Cobre, por `describe`/`it` (nomes literais do arquivo):
  - "mantem a qualificacao consultiva e o handoff estruturado da Cenoura Hub"
  - "aplica os ajustes de 20/09: nome e concordancia esporadicos, 2 horarios, sem oferecer ligacao, quem conduz e data local"
  - "confirma a reuniao com formato e quem conduz, e sabe encerrar depois do handoff"
  - "aplica o lote de 21/09: teto do nome, bora liberado, espelhamento, acentuacao, sem travessao, hoje, insistencia e nota interna factual"
  - "mantem o que o Junior mandou manter em 21/09: pedido de e-mail para o convite, sem prometer confirmacao, e a regra de concordancia"
  - bloco "correcoes dos primeiros leads reais (23/09)": nome do WhatsApp = nome da empresa, teto de perguntas antes de devolver leitura, resposta curta repetida = cansaço, "DEFENDE O AGORA" (não aceita "amanhã eu chamo" de primeira), apresenta quem conduz antes do nome
  - bloco "gate de capacidade + consultoria (27/09)": pergunta de capacidade antes da reunião, oferta da consultoria só depois do "não", preferência de hora vs. confirmação só após pagamento, envio do link parcelado por padrão, preço do serviço nunca dito, campo `capacityGate` no retorno estruturado, "o gate é SÓ da Cenoura Hub" (garante que o prompt padrão/outros clientes não ganharam o texto do gate)
  - bloco "etiquetas do funil (27/09)": carrega catálogo pelo placeholder e restringe a nomes exatos, amarra momentos (gate reprovado/quer agendar/só pesquisando) sem falar de etiqueta com o lead, etiqueta "Follow-up" para adiamento, e mais um teste "as etiquetas são SÓ da Cenoura Hub por enquanto" (garante que o prompt padrão não ganhou o placeholder de etiquetas)
  - bloco "funil andando, contato por engano e conversa encerrada (29/09)": etiquetas que movem o card, fluxo de contato por engano (pergunta uma vez, encerra sem insistir, nunca comenta idade da pessoa), e primeira mensagem se apresentando antes de pedir o nome.
  - **O que isso prova:** são todos testes de **string/regex sobre o texto do template** (garantindo presença/ausência de trechos, ordem de seções, ou diferenças entre o template da Aurora e o template padrão) — não testam o prompt renderizado em runtime (não chamam `renderPromptTemplate` nem `generateConversationAutoReply`), e não tocam banco.

- **`lib/conversations/aiReply.aiGate.test.ts`** — testa `executeConversationAIReply` (não a montagem do prompt): garante que a IA não consulta nem envia quando a conexão está com `aiEnabled` desativado.
- **`lib/conversations/aiReply.medicao.test.ts`** — testa a medição de tempo/chamadas do modelo (`AIReplyTiming`), não o conteúdo do prompt.
- **`lib/conversations/aiReply.meetingSlots.test.ts`** — testa `loadAvailableMeetingSlots` (merge de ocupado do Google Agenda) — alimenta o placeholder `{{calendarContext}}`, mas não testa o texto do prompt em si.
- **`lib/conversations/aiReply.threadStateGuard.test.ts`** — testa `executeConversationAIReply` e `recordConversationAIFailure` quanto a corrida de estado da thread durante o envio — não é sobre o prompt.
- **`lib/conversations/aiReplyOutputSchema.test.ts`** — testa `ConversationAutoReplySchema` (parsing do retorno estruturado do modelo), não o prompt de entrada.

**Não encontrado:** nenhum teste que (a) chame `getResolvedPrompt` contra um Supabase de teste para validar a lógica de override/`is_active`/fallback; (b) chame `renderPromptTemplate` com o conjunto completo de variáveis de `aiReply.ts:501-515` para garantir que a substituição byte a byte não muda; (c) teste o `defaultTemplate` de `task_conversations_whatsapp_auto_reply` (o prompt "padrão"/Jéssica) da mesma forma extensa que `catalog.aurora.test.ts` faz para o da Aurora — procurei por `catalog.default.test.ts`/`catalog.jessica.test.ts`/nome semelhante e não existe. Isso é relevante para a "regra de ouro" do projeto (resposta byte a byte igual): hoje só o prompt da Aurora tem rede de testes de regressão de texto; o da Julia/padrão não tem um arquivo equivalente.

---

## Lacunas explícitas (não verificado, e onde procurei)

1. **Qual `organization_id`/conexão está de fato configurada com `aiPromptKey = 'task_conversations_whatsapp_cenno_aurora'` hoje, e se a organização da Dra. Jéssica tem ou não uma linha em `ai_prompt_templates`** — não verificável por leitura de código/migration/seed; exigiria consulta ao banco de produção, fora do escopo desta tarefa (só leitura de repositório).
2. **Conteúdo exato de `buildClosingStageContext` e `buildConfirmedMeetingStageContext`** (`lib/conversations/closingReply.ts` e o segundo, provavelmente em `lib/conversations/threadMetadata.ts` ou correlato) — localizei a primeira função parcialmente (`closingReply.ts:1-60`), não lido byte a byte até o fim; e não localizei/li a implementação de `buildConfirmedMeetingStageContext` nesta rodada (grep indicou que não está em `closingReply.ts`, e não segui o import até o arquivo de origem por limite de tempo da tarefa). Fica como pendência para leitura futura se o placeholder `{{conversationStageContext}}` precisar ser clonado byte a byte.
3. **Conteúdo exato de `formatMeetingAvailabilityContext()`** (`lib/conversations/meetingAvailability.ts`) que gera o texto de `{{calendarContext}}` — localizado o arquivo, não lido por completo nesta rodada.
4. **`GRANT` explícito na tabela `ai_prompt_templates`** — não encontrado nas migrations; presumo privilégio default do Supabase, não confirmado.
5. **Quem consome o `GET /api/settings/ai-prompts` (rota raiz, sem `[key]`)** — não encontrado nenhum `fetch('/api/settings/ai-prompts')` sem parâmetro de key nos componentes de `features/settings/` lidos; pode ser usado por outra tela não localizada nesta busca, ou estar órfã.
