# APIs e integrações

> Parte da documentação-mãe. Índice geral em [docs/README.md](../README.md).
> Levantado por varredura de código em 2026-07-23 (103 route handlers).

## Os 6 modelos de autenticação (saber qual protege o quê)

| Modelo | Onde | Como |
|---|---|---|
| Sessão + CSRF | rotas de IA, agenda, settings | `resolveActiveTenantContext()` + checagem de Origin |
| API key pública | `/api/public/v1/*`, `/api/mcp` | header `x-api-key` → RPC `validate_api_key` (hash, escopo por org) |
| Token de relatório | `/api/public/v1/reports/summary?token=` | RPC `validate_report_token` — só agregados, sem PII, credencial isolada |
| Bearer interno | `/api/internal/automations/*` | `AUTOMATION_TICK_SECRET` / `AUTOMATION_WORKER_SECRET` (timing-safe) |
| Secret por conexão | webhook Evolution + `/ai-reply` | secret da conexão via query/header |
| Guard de instalador | `/api/installer/*` | `INSTALLER_ENABLED` / `INSTALLER_TOKEN` |

## Grupos de rotas

- **API pública v1** (`/api/public/v1/*`): CRUD de contatos, deals (+ mark-won/lost,
  move-stage, move por identidade), empresas, atividades, boards/stages, `me`,
  relatório agregado. OpenAPI em `/api/public/v1/openapi.json` + Swagger em `/docs`.
  Consumidores: n8n, Sheets, integrações.
- **MCP** (`/api/mcp`): tools do CRM via JSON-RPC (registry em `lib/mcp/`).
- **IA** (`/api/ai/*`): chat do agente CRM (streaming), ações, e tarefas
  (`analyze`, `email-draft`, `objection-responses`, `daily-briefing`,
  `sales-script`, geração de estrutura de funil). Gate: `ai_enabled` +
  feature flags por org.
- **Plataforma** (`/api/platform/*`): tenants (CRUD, branding, domains),
  conversas por thread, automações (draft/publish/test), canais Evolution
  (connect/disconnect/healthcheck/send-test), defaults da agência.
- **Automação interna** (`/api/internal/automations/*`): `tick` (cron → RPCs de
  roteamento/waits/jobs), `jobs/claim` e `jobs/[id]/complete` (worker).
- **Agenda/Clinicorp** (`/api/agenda/*`): appointments, available-times, book
  (cria AO VIVO no Clinicorp), confirm, cancel, professionals-sync. Credenciais
  na tabela `clinicorp_config` (não em env).
- **Admin** (`/api/admin/*`): usuários, permissões, convites (+ `/api/invites/*`,
  `/api/me/permissions`, `/api/setup-instance`).
- **Instalador** (`/api/installer/*`): provisionamento Supabase/Vercel self-host.

## WhatsApp (Evolution API) — o fluxo completo

**Inbound:** Evolution → `POST /api/public/channels/evolution/[connectionId]/webhook`
→ valida secret → parseia (`fromMe` decide direção) → dedupe por
`provider_message_id` (duplicado inbound ainda resolve wait de automação via
RPC `resolve_automation_wait_from_inbox`) → materializa contato/thread/deal →
grava `conversation_messages` → se thread `ai_active`: agenda resposta da IA
com debounce de 7s; se IA nativa falhar/desligada, cai pro webhook n8n da
conexão (`notifyConversationAutomation`), que responde de volta via
`POST .../ai-reply`.

**Outbound:** `executeConversationAIReply` — respeita `human_active`/`human_queue`
(não fala por cima do humano), quebra em até 3 mensagens, envia via
`sendEvolutionTextMessage`, grava status de entrega; handoff → `human_queue` +
pausa de inscrições de automação. Envio manual idempotente:
`dispatchManualConversationOutbound` (idempotency_key).

**Camada HTTP:** `lib/channels/evolution.ts` (create instance QR, connectionState,
webhook set com `MESSAGES_UPSERT`/`MESSAGES_UPDATE`/`CONNECTION_UPDATE`, sendText/
Media/Audio). Credenciais por tenant com default da agência.

## ⚠️ A trava de simulação — o que ela cobre e o que NÃO cobre

- **Cobre o motor de automação (funil):** em simulação, o dispatch força
  `status: 'simulated'` sem tocar o provider; o teste do builder RECUSA rodar se
  `automation_live_enabled !== false`; ligar envio real só via RPC
  `set_automation_live_enabled` (com gate de saúde do tick).
- **NÃO cobre o auto-reply conversacional da IA:** quando uma thread está
  `ai_active` com `config.aiEnabled`, a resposta da IA **envia de verdade** pela
  Evolution — esse caminho não consulta `automation_live_enabled`. Faz sentido
  (é conversa ao vivo, não campanha), mas precisa estar CONSCIENTE: desligar a
  IA da conversa é outra chave (`config.aiEnabled` da conexão), não a trava do
  funil. **Registrado como ponto de decisão de produto.**

## IA — provedores e chaves

- AI SDK v6 com Google (default, `gemini-3-flash-preview`), OpenAI (`gpt-4o`),
  Anthropic (`claude-sonnet-4-5`).
- **As chaves de IA NÃO são env vars** — vivem em `organization_settings`
  (colunas só-service-role), configuradas em Configurações → IA por org.
- Persona do auto-reply de WhatsApp: "Julia" (SPIN selling), prompt customizável
  por org (`lib/ai/prompts/*`).

## Variáveis de ambiente (nomes, por grupo)

- **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  (+ fallbacks legados `ANON_KEY`), `SUPABASE_SECRET_KEY` (+ legado
  `SERVICE_ROLE_KEY`).
- **Automação:** `AUTOMATION_TICK_SECRET`, `AUTOMATION_WORKER_SECRET`.
- **Instalador:** `INSTALLER_ENABLED`, `INSTALLER_TOKEN`, `VERCEL_PROJECT_ID`,
  `VERCEL_ORG_ID`.
- **Dev-only:** `ALLOW_AI_TEST_ROUTE`, `ALLOW_UI_MOCKS_ROUTE`,
  `NEXT_PUBLIC_DEBUG_REALTIME`, `AI_TOOL_APPROVAL_BYPASS`, `AI_TOOL_CALLS_DEBUG`.
- **Só em scripts:** `CLINICORP_*` (live-check), `RLS_TEST_*` (verify-rls-live).

## Scripts npm

| Script | O que faz |
|---|---|
| `dev:local` | Next contra Supabase LOCAL; **aborta se o local não está no ar** |
| `dev` / `dev:prod` | ⚠️ banco de PRODUÇÃO (`.env.local`) — só sob pedido |
| `test:local` | vitest contra o local; **recusa alvo ≠ 127.0.0.1** |
| `precheck` / `precheck:fast` | lint+ts+unit (+build) — **não roda integração** |
| `test:e2:server`, `test:e2e`, `stories` | enforcement server / Playwright / stories |
| `e2:permissions:snapshot:*` | snapshot dos defaults de permissão |
| `smoke:integrations` | ⚠️ **QUEBRADO** — `scripts/smoke-integrations.mjs` não existe |
| `legacy:tenant` | migração legada (usa secret) |

## Não verificado nesta varredura

- Detalhe fino de auth de cada uma das 103 rotas (padrões confirmados por grupo).
- `integration_inbound_sources` / `webhook_events_out` não aparecem no código
  TypeScript — existem no schema (ver [banco-de-dados.md](./banco-de-dados.md)).
