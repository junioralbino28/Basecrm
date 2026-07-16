# Multi-número / Caixa unificada — MAPA DO CÓDIGO

> Superfície verificada por Claude no código (leitura direta, 2026-07-15). Caminho:linha reais. Serve pra o PLAN e pro Codex não trabalharem de memória.

## Banco (o essencial JÁ existe)

- **`channel_connections`** (`supabase/migrations/20260310010000_platform_channel_connections.sql`): `id`, `organization_id` (FK, **SEM unique** → N conexões por clínica), `provider`, `channel_type`, `name`, `status` ('pending'|'connected'|'disconnected'|'error'), `config jsonb`, `metadata jsonb`, `last_healthcheck_at`. RLS: membros leem (SELECT por org), `role='admin'` gerencia (FOR ALL).
  - `config` guarda hoje: `apiUrl`, `instanceName`, `webhookUrl`, `webhookSecret`, `apiKey`, `sendMode`. **É jsonb → adicionar `aiEnabled` NÃO precisa de migration de schema.**
  - `metadata` guarda: `phoneNumber`, `apiKeyLast4`, `notes`, e telemetria (`lastPairingCode`, `lastHealthcheckState`, `lastInboundPreview`, etc.).
- **`conversation_threads`** (`supabase/migrations/20260310020000_platform_conversations.sql`): **JÁ tem `channel_connection_id UUID` (linha 8, FK → channel_connections, ON DELETE SET NULL)** → cada conversa já sabe de qual número veio. Também `status` ('open' default; na prática 'ai_active'|'human_queue'|'human_active'|'resolved'|'closed'), `assigned_user_id`, `contact_name`, `contact_phone`, `last_message_at`.
- **`conversation_messages`**: `thread_id`, `direction`, `message_type`, `content`, `metadata`, `sent_at`.

## API de canais (rotas REST) — o CRUD JÁ existe, falta criar-instância e DELETE

- **`app/api/platform/tenants/[tenantId]/channels/route.ts`**
  - `GET` — lista conexões da org. Gate: `requireTenantAccess(tenantId, { requiredPermissions: ['whatsapp.access'] })`.
  - `POST` — cria conexão. Gate: `whatsapp.manage_connection`. **Já auto-gera `webhookSecret`** se vazio (`crypto.randomUUID().replace(/-/g,'')`, L75-76). **`instanceName` é opcional** (L23/72). `sendMode` default 'auto'. Chama `ensureTenantAgencyBinding` (L96) pra herdar a credencial global da agência quando um agency-admin cria pra outra org. Schema Zod `.strict()` (L16-34).
- **`app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts`**
  - `PATCH` — edita (nome/status/config/metadata). Gate `whatsapp.manage_connection`. **NÃO existe `DELETE`** (confirmado — só PATCH). → "Excluir" precisa de rota DELETE nova.
- **`app/api/platform/tenants/[tenantId]/channels/[connectionId]/connect/route.ts`** — pareia (chama `fetchEvolutionPairingCode` = `GET /instance/connect/{instanceName}`) + `setEvolutionWebhook`. **Assume a instância já existir na Evolution.**
- Também existem (mesma pasta `[connectionId]/`): `healthcheck/`, `disconnect/` (logout, NÃO remove a row), `send-test/`.
- **`app/api/platform/agency/evolution/route.ts`** — GET/PATCH da **credencial global da agência** (`apiUrl`+`apiKey`), guardada em `organization_editions.metadata.evolutionDefaults`.

## Libs Evolution — `lib/channels/evolution.ts`

Funções prontas (todas server-side, `apikey` header): `fetchEvolutionConnectionState` (`/instance/connectionState`), `fetchEvolutionPairingCode` (`/instance/connect` = parear/QR), `setEvolutionWebhook` (`/webhook/set`), `logoutEvolutionInstance` (`/instance/logout`), `sendEvolutionTextMessage`, `sendEvolutionMediaMessage`, `sendEvolutionAudioMessage`.
- **FALTA:** `createEvolutionInstance` (`POST /instance/create`). Nenhuma chamada a `/instance/create` existe no repo (grep confirmou). Params corretos na skill `evolution-api` R8: `{ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS', rejectCall, msgCall, groupsIgnore: true, alwaysOnline }`. O `/instance/create` com `qrcode:true` já retorna o QR base64 na resposta.

## Webhook de entrada + gate de IA

- **`app/api/public/channels/evolution/[connectionId]/webhook/route.ts`** — recebe o inbound por `connectionId`. Valida `config.webhookSecret` (L656) e o `instanceName` (L657). Cria/atualiza thread, insere mensagem.
  - **Gate da IA nativa (L186):** `if (latestThreadStatus !== 'ai_active') return;` → só responde automático se a thread está `ai_active`. Chama `generateConversationAutoReply` (L213) → `executeConversationAIReply` (autor 'Julia', `automationSource: 'native_crm'`).
  - `connectionConfig` disponível (L903) → dá pra ler `config.aiEnabled` aqui.
- **`lib/conversations/routing.ts`** — `getConversationStatusAfterInbound(current)`: mantém `human_active`/`human_queue`/`closed`; senão retorna `'ai_active'`. **É aqui (ou na criação da thread no webhook) que uma conexão com IA off deve nascer `human_queue` em vez de `ai_active`.** Também `pickNextHumanAssignee` (round-robin por `conversations.reply`).

## UI

- **`features/platform/tenants/TenantChannelsPage.tsx`** — "Conexões da clínica" (rota `/platform/tenants/[id]/channels`). Gate `canManageInfrastructure = canManageChannelConfig && isAgencyAdmin && isTechnicalRoute`. **Já tem:** lista de conexões (cards), botão "Instância +" + modal "Nova instância" (L1148+), por card: Editar/Atualizar status/Gerar QR/Testar envio/Desconectar, exibe QR (`extractPairingDisplay`), webhook do CRM, credencial global da agência. Form de criação usa `submit()` (POST/PATCH). **Falta:** modo simples (2 campos), botão Excluir, e o create chamar `/instance/create`.
- **`features/platform/tenants/TenantConversationsPage.tsx`** — a tela do print. `InboxFilter = 'all'|'ai_active'|'human_queue'|'human_active'|'resolved'|'closed'` (L51); `FILTER_OPTIONS` (L55, rótulos Tudo/Julia/Fila humana/…). **Já tem `activeConnectionId` no estado (L273)** e lê `tenant.channel_connections` (L593), default = 1ª conexão (L595/608-611). **MAS `filteredThreads` (L568-591) filtra só por status/lida/sem-dono/busca — NÃO por `channel_connection_id`.** → adicionar o seletor visível + a condição de conexão no filtro + selo de origem.
- `features/platform/tenants/useTenantDetail.ts` — carrega `tenant.channel_connections` (usado pelas 2 páginas).
- `lib/channels/publicChannel.ts` — `toPublicChannelConnection(c, { canManageChannelConfig })` redige o `config` sensível conforme permissão (usar/estender p/ expor `aiEnabled` e esconder segredo).

## Permissões (E1/E2, já no ar)

- `whatsapp.access` (ver o módulo), `whatsapp.manage_connection` (cadastrar/parear/editar/excluir). Defaults E2: clinic_admin/agency_admin = manage true; clinic_staff = access? (checar taxonomia — staff tem `whatsapp.access=false` pelos defaults aplicados). `conversations.access` / `conversations.reply` = acesso/uso da caixa.
- Enforcement de servidor: `requireTenantAccess(tenantId, { requiredPermissions: [...] })` (`lib/platform/tenantAccess.ts`) — já usado nas rotas de canais.

## Testes (padrão do repo)

- Vitest + happy-dom. Rotas testadas com mocks do Supabase admin; UI com Testing Library. Portão: `npm run precheck:fast` (lint + typecheck + `vitest run`). Testes de conexão/canais e conversas já existem — seguir o padrão dos arquivos vizinhos.
