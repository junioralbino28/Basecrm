# Mapa exato — Central de Agentes (BaseCRM)

Repo: `C:\Users\PC Gamer\WorkSync\projetos\Basecrm-worktrees\central-agentes`
Branch: `feat/central-agentes`, commit `335f32b` (produção atual)
Levantamento SÓ LEITURA — nenhum arquivo editado, nenhum teste rodado.

---

## 1. Provedor/modelo/chave de IA por organização

### 1.1 Tabela e colunas

`supabase/migrations/20251201000000_schema_init.sql:51-62` — `organization_settings`:

```
organization_id uuid PK/FK organizations
ai_provider text DEFAULT 'google'
ai_model text DEFAULT 'gemini-2.5-flash'
ai_google_key text
ai_openai_key text
ai_anthropic_key text
ai_enabled boolean NOT NULL DEFAULT true   -- toggle da organização inteira
created_at / updated_at timestamptz
```

Coluna adicionada depois, só para transcrição de áudio (não é provedor de conversa):
`supabase/migrations/20260921010000_organization_settings_ai_groq_key.sql:17-21` — `ai_groq_key text`. Comentário na própria migration (linhas 1-15) deixa explícito: não é opção de tela, só lida por `service_role` no módulo de mídia.

Há também `user_settings.ai_provider/ai_api_key/ai_model` (`supabase/migrations/20251201000000_schema_init.sql:420-422`), mas é config **pessoal legada** (comentário linha 1313-1314 a marca "Legacy column"); não é a usada no caminho de resposta automática (ver 1.4).

### 1.2 Criptografia da chave

**Não há criptografia.** `ai_google_key`, `ai_openai_key`, `ai_anthropic_key` (e `ai_groq_key`) são `text` puro no Postgres. A proteção é só por **GRANT de coluna** (Postgres privilege, não cripto):

- `supabase/migrations/20260630020000_m6_adversarial_fixes.sql:17-22` — revoga `SELECT` da tabela inteira de `anon`/`authenticated` e concede `SELECT` só nas colunas não-secretas: `organization_id, ai_provider, ai_model, ai_enabled, task_nudge_interval_minutes, created_at, updated_at`. As colunas `ai_*_key` ficam **sem grant nenhum** para `authenticated`/`anon` — só `service_role` lê.
- Confirmado no comentário da migration da Groq (`20260921010000...sql:10-14`): "a coluna nova nasce invisível para o navegador, como `ai_google_key`".
- RLS de linha (não de coluna) continua existindo por cima: `supabase/migrations/20260311013000_core_multi_tenant_rls.sql:279-290` — `organization_settings_select_by_tenant` (`can_access_organization`) e `organization_settings_mutate_by_tenant_admin` (`can_configure_organization`), `for all` — isto é, a policy de UPDATE/INSERT não distingue campo, só linha.

### 1.3 Rota que grava + trava por CAMPO (admin do cliente só pausa)

`app/api/settings/ai/route.ts` — rota única (GET/POST) para config de IA da organização.

- `GET` (linhas 40-86): lê via `createStaticAdminClient()` (service-role) porque a coluna secreta não tem grant para `authenticated` (comentário linha 44-46). `canManageSecrets = auth.isAgencyAdmin` (linha 59). Não-admin-de-agência recebe só `aiEnabled/aiProvider/aiModel` + booleans `aiHasXKey` (linhas 64-78); a chave crua **nunca** vai ao browser (comentário linha 61-63); só quem gerencia segredo ganha `aiXKeyLast4` (linhas 80-85, via `keyLast4` linha 24-27, exige ≥8 chars).
- `POST` (linhas 88-152): schema `UpdateOrgAISettingsSchema` (linhas 29-38) aceita `aiEnabled, aiProvider, aiModel, aiGoogleKey, aiOpenaiKey, aiAnthropicKey`.
  - **Trava por campo está nas linhas 105-117**: calcula `mexeNaConfiguracaoDoMotor` = true se o payload tocar `aiProvider`/`aiModel`/qualquer chave (linhas 108-113); se isso for true e `!auth.isAgencyAdmin` → `403 Forbidden` (linhas 115-117). `aiEnabled` sozinho passa para qualquer admin autorizado por `requireAdminTenantContext` (agency_admin OU clinic_admin, ver 1.4). Isto é exatamente a decisão "cliente pausa, não configura": nega provedor/modelo/chave, libera ligar/desligar.
  - Persistência: `upsert` em `organization_settings` (linhas 143-145), `onConflict: 'organization_id'`.

**Inconsistência achada (UI x servidor), não fabricada — observada diretamente no código:**
`features/settings/components/AIConfigSection.tsx:141` — `const isAdmin = canManageClinicSettings(profile?.role)`. `canManageClinicSettings` (`lib/auth/scope.ts:60-62`) retorna `true` para `agency_admin` **e** `clinic_admin`. Ou seja, a UI mostra o formulário completo de provedor/modelo/chave (`AIConfigSection.tsx:333-…`) para `clinic_admin` também — só o servidor (`route.ts:115-117`, que checa `isAgencyAdmin`, não `isAgencyAdmin || isClinicAdmin`) é que devolve 403 quando um `clinic_admin` tenta salvar provedor/modelo/chave. A tela não desabilita esses campos para ele antes do POST falhar. Confidence: High (código lido, não inferência) — mas o **comportamento visível ao usuário clinic_admin** (se ele consegue editar e recebe erro, ou se algo no fluxo de fetch já filtra antes) eu não testei em runtime (regra de só-leitura/sem rodar app) — isso é `[Inferred]` a partir da leitura estática, não `[Behavior observed]`.

### 1.4 `requireAdminTenantContext` (guarda de acesso à rota)

`lib/platform/adminTenantContext.ts:17-84`. Exige usuário autenticado (linha 25-28), perfil com `organization_id` (linha 30-36), papel normalizado (linha 38) e `isAgencyAdmin || isClinicAdmin` (linhas 39-44) — outros papéis (`clinic_staff`, `vendedor`, `agency_staff`) tomam 403 aqui, antes mesmo do corpo da rota. Resolve `targetOrganizationId`: se `agency_admin` pedir `scope=agency` usa a própria org (linha 54-55); se pedir tenant específico ou tiver cookie de tenant selecionado, troca via `requireTenantAccess(..., { adminOnly: true })` (linhas 56-72) — `adminOnly` aqui exige `isAgencyAdminRole` (`lib/platform/tenantAccess.ts:54`), então só agência troca de tenant por essa rota.

### 1.5 `getModel` no caminho da resposta automática

`lib/ai/config.ts:46-75` — `getModel(provider, apiKey, modelId, options?)`. Cria cliente do provider (`google`/`openai`/`anthropic`) via `@ai-sdk/*`, aceita `options.fetch` para injetar um fetch instrumentado (usado para medição, ver seção 2).

Chamado em `lib/conversations/aiReply.ts` dentro de `generateConversationAutoReply` (linhas 373-…):
- Linhas 409-419: lê `organization_settings` (`ai_enabled, ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key, automation_timezone`) via `admin` (service-role); se `ai_enabled !== true` retorna `{ ok:false, reason:'ai_disabled' }`.
- Linhas 421-431: escolhe a chave certa conforme `provider` (google/openai/anthropic); sem chave → `{ ok:false, reason:'missing_api_key' }`.
- Linhas 439-445: `criarFetchContador()` (medição) + `getModel(provider, apiKey, orgSettings?.ai_model || AI_DEFAULT_MODELS[provider] || AI_DEFAULT_MODELS.google, { fetch: fetchContador.fetch })`.
- Defaults por provider: `lib/ai/defaults.ts:6-10` — `google: 'gemini-3-flash-preview'`, `openai: 'gpt-4o'`, `anthropic: 'claude-sonnet-5'`.

Config por **agente/conexão** (não por organização): `lib/conversations/aiAgentConfig.ts:15-29` — `resolveConversationAIAgentConfig` lê `config.aiAgentName` e `config.aiPromptKey` de dentro do **JSON de config da conexão de WhatsApp** (não de `organization_settings`), com regex de validação (linha 7-8) e fallback para nome neutro `"Assistente"` (linha 4) e prompt padrão `task_conversations_whatsapp_auto_reply` (linha 5). Ou seja, hoje já existe granularidade **por conexão/agente** para nome e prompt, mas **não** para provider/model/key — esses são só por organização inteira.
Gravação desse `aiAgentName`/`aiPromptKey`/`aiEnabled` por conexão: `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts:34-36,123-125`, atrás de `requireTenantAccess(tenantId, { requiredPermissions: ['whatsapp.manage_connection'] })` (linha 60-63) — **sem** a trava por campo equivalente à de `organization_settings`: qualquer papel com a permissão `whatsapp.manage_connection` (pode incluir `clinic_admin`/`clinic_staff` conforme `resolvePermissionMap`, não conferido linha a linha aqui — ver nota abaixo) grava nome/prompt/ligar-desligar do agente daquela conexão. Isso é relevante para o editor "por agente" da Central: hoje o nome/prompt do agente já é editável por conexão, mas sem o mesmo gate de governança que existe para provider/modelo/chave.

---

## 2. Custo (tokens) e medição de tempo

### 2.1 `usage` do AI SDK: não é capturado

`lib/conversations/aiReply.ts:521-529` — `generateOnce()` chama `generateText({ model, maxRetries: 2, maxOutputTokens: 4096, output: Output.object({ schema: ConversationAutoReplySchema }), prompt })` e o código só extrai `.output` do resultado (linha 553: `generated = (await generateOnce()).output;`, linha 569 idem). **Busquei `usage`, `totalTokens`, `promptTokens`, `completionTokens`, `inputTokens`, `outputTokens` no arquivo inteiro (1394 linhas) — nenhuma ocorrência.** O AI SDK (`generateText`) devolve `usage` no objeto de retorno, mas ele não é lido nem descartado explicitamente — simplesmente não é destructured. **Confidence: High** — grep no arquivo inteiro, não amostra.

Não encontrei em nenhum outro lugar do `lib/conversations/` ou `lib/ai/` uma leitura de `usage`/tokens dessa chamada. Não fabrico "não existe em lugar nenhum do repo" (não fiz grep exaustivo em toda a árvore, só nos módulos do caminho de IA de conversa) — dentro do escopo pedido (a chamada em `generateConversationAutoReply`), a resposta é: **não é usado nem gravado.**

### 2.2 `ai_timing` no metadata da mensagem

`lib/ai/medicaoResposta.ts` (arquivo inteiro, 61 linhas):
- Tipo `AIReplyTiming` (linhas 14-31): `total_ms, setup_ms, calendar_ms, model_ms, model_http_calls, model_http_errors[], generations, repaired`. **Não tem nenhum campo de tokens ou custo em dinheiro** — só tempo e contagem de chamadas HTTP.
- `criarFetchContador()` (linhas 33-47): fetch instrumentado que conta chamadas e status de falha — é o que é passado a `getModel(..., { fetch })` em `aiReply.ts:444`.
- `resumirMedicao()` (linhas 50-53) e `lerMedicaoDoErro()` (linhas 56-60): formatam/leem a medição para log.

Em `aiReply.ts`: `medir()` (linhas 532-544) monta o `AIReplyTiming` a partir de `criarFetchContador` + timestamps; é pendurado no erro quando a geração falha (`error.aiTiming = medir()`, linha 576) e retornado como `modelTiming` no caminho de sucesso (linha 580) — não vi o retorno final da função (só li até a linha 592; o `modelTiming` deve seguir até o `return` da função, que não conferi linha exata, mas o consumo dele no webhook confirma que chega até lá).

Gravação no metadata da mensagem: `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:289-298` — dentro do `metadata` passado a `executeConversationAIReply`: `ai_timing: { ...nativeReply.timing, queue_ms: queueMs }` (linha 297). No caminho de falha, `lerMedicaoDoErro(nativeAiError)` (linha 342) + `resumirMedicao` (linha 345) viram parte do texto de erro registrado (`nativeFailureError`), não estruturado.

### 2.3 Tabela de preço por modelo

**Não encontrada.** Procurei (`grep -rln "price|pricing|custo_por|cost_per|USD|centavos"`) em `lib/ai/` e `features/settings/`; os únicos hits (`lib/ai/crmAgent.ts`, `CommissionsManager.tsx`, `ProductsCatalogManager.tsx`, `SpecialtyProductsPicker.tsx`) são sobre **preço de produto/comissão do CRM**, não custo de IA — conferido (`crmAgent.ts:193` é um comentário sobre header HTTP, "costuma enviar"). `lib/ai/defaults.ts` (10 linhas, arquivo inteiro lido) só tem `AI_DEFAULT_MODELS` e `AI_DEFAULT_PROVIDER`, nada de preço. **Não existe hoje nenhuma fonte de preço por modelo no código** — para "custo de cada resposta" a Central de Agentes precisaria (a) capturar `usage` do `generateText` (mudança em `aiReply.ts`) e (b) introduzir uma tabela de preço própria (não existe nem placeholder).

---

## 3. Estrutura da área da agência/plataforma

### 3.1 Árvore de rotas em `app/(protected)/platform/`

```
app/(protected)/platform/page.tsx                                    -> /platform
app/(protected)/platform/team/page.tsx                                -> /platform/team
app/(protected)/platform/tenants/page.tsx                             -> /platform/tenants
app/(protected)/platform/tenants/new/page.tsx                         -> /platform/tenants/new
app/(protected)/platform/tenants/[tenantId]/page.tsx                  -> /platform/tenants/:id
app/(protected)/platform/tenants/[tenantId]/dashboard/page.tsx
app/(protected)/platform/tenants/[tenantId]/visao-geral/page.tsx
app/(protected)/platform/tenants/[tenantId]/boards/page.tsx
app/(protected)/platform/tenants/[tenantId]/contacts/page.tsx
app/(protected)/platform/tenants/[tenantId]/conversations/page.tsx
app/(protected)/platform/tenants/[tenantId]/inbox/page.tsx
app/(protected)/platform/tenants/[tenantId]/activities/page.tsx
app/(protected)/platform/tenants/[tenantId]/call-list/page.tsx
app/(protected)/platform/tenants/[tenantId]/tarefas/page.tsx
app/(protected)/platform/tenants/[tenantId]/atendimentos/page.tsx
app/(protected)/platform/tenants/[tenantId]/automations/page.tsx
app/(protected)/platform/tenants/[tenantId]/whatsapp/page.tsx
app/(protected)/platform/tenants/[tenantId]/channels/page.tsx
app/(protected)/platform/tenants/[tenantId]/domains/page.tsx
app/(protected)/platform/tenants/[tenantId]/branding/page.tsx
app/(protected)/platform/tenants/[tenantId]/reports/page.tsx
app/(protected)/platform/tenants/[tenantId]/reports/financeiro/page.tsx
app/(protected)/platform/tenants/[tenantId]/reports/profissionais/page.tsx
app/(protected)/platform/tenants/[tenantId]/settings/page.tsx
```
(listagem via `find`, 23 arquivos `page.tsx` sob `platform/`)

### 3.2 Como as páginas por cliente são montadas

Padrão observado em `app/(protected)/platform/page.tsx:1-13`: cada `page.tsx` é um client component fino que faz `dynamic(() => import('@/features/platform/.../XxxPage').then(m => ({ default: m.XxxPage })), { ssr:false, loading: ... })` — a lógica de verdade mora em `features/platform/`. Confirmei o mesmo padrão de import dinâmico só no arquivo `platform/page.tsx`; não abri individualmente todos os 22 outros `page.tsx` de tenant (seria fora do escopo de profundidade pedido) — **assumo** (marcado como tal) que seguem o mesmo padrão fino, por ser o padrão dominante do repo (confirmado indiretamente pela existência de `features/platform/tenants/TenantWorkspacePage.tsx`, `TenantChannelsPage.tsx`, `TenantConversationsPage.tsx`, `TenantBrandingPage.tsx`, `TenantDomainsPage.tsx`, um arquivo de feature por rota).

`features/platform/` (árvore completa, `find`):
```
features/platform/PlatformPage.tsx
features/platform/tenants/TenantsPage.tsx
features/platform/tenants/NewTenantPage.tsx
features/platform/tenants/TenantWorkspacePage.tsx
features/platform/tenants/TenantChannelsPage.tsx (+ .test.tsx)
features/platform/tenants/TenantConversationsPage.tsx (+ .test.tsx)
features/platform/tenants/TenantBrandingPage.tsx
features/platform/tenants/TenantDomainsPage.tsx
features/platform/tenants/MetaCapiSettings.tsx (+ .test.tsx)
features/platform/tenants/useTenantDetail.ts
features/platform/tenants/components/TenantProvisioningWizard.tsx
features/platform/tenants/conversations/  (CalendarBlocksPanel, ChannelCalendarSettings, ConversationDealPanel,
    ConversationHandoffCard, MessageBubble, WeeklyAvailabilityEditor, calendarSettingsForm.ts, feedbackDoEnvio.ts)
```

### 3.3 `TENANT_SCOPED_BASE_ROUTES` — onde fica e o teste

Fica em `lib/tenancy/workspaceRoutes.ts:17-38` (`const TENANT_SCOPED_BASE_ROUTES = new Set([...])`, 19 entradas: `/inbox, /dashboard, /visao-geral, /boards, /contacts, /conversations, /activities, /call-list, /tarefas, /atendimentos, /automations, /whatsapp, /channels, /domains, /branding, /reports, /reports/financeiro, /reports/profissionais, /settings, /pipeline`). Consumida por `getTenantWorkspaceHref` (linhas 53-69) — usada pelo seletor de cliente no cabeçalho ao trocar de tenant sem perder a tela (comentário linhas 1-16 conta o incidente de produção de 24/09).

Teste que trava a lista contra o disco: `lib/tenancy/workspaceRoutes.test.ts` (arquivo inteiro lido, 60+ linhas mostradas):
- `rotasEmDisco()` (linhas 28-40) faz `fs.readdirSync` recursivo em `app/(protected)/platform/tenants/[tenantId]/`, pulando segmentos dinâmicos (`[dealId]`) e de grupo (`(x)`), e coleta todo caminho com `page.tsx`.
- `it.each(rotas)` (linha 50-57) exige que **cada rota real em disco** passe por `getTenantWorkspaceHref` e saia com o prefixo `/platform/tenants/<id>` — se uma rota nova não estiver em `TENANT_SCOPED_BASE_ROUTES`, o teste falha apontando exatamente o arquivo a editar (mensagem da linha 54-56).
- Se a Central de Agentes ganhar uma rota nova sob `[tenantId]/agents` (ou similar), **precisa entrar nesta lista**, senão trocar de cliente estando na tela de agentes cai em 404 (mesmo bug documentado no comentário 1-16).

### 3.4 Componente do menu lateral da plataforma

Não existe um arquivo chamado "Sidebar"/"PlatformNav" (busquei `PlatformSidebar|PlatformNav|PlatformMenu`, zero ocorrência). O menu é montado por `components/navigation/navConfig.ts` (arquivo inteiro, 127 linhas):
- `getPrimaryNav()` (linhas 61-71): nav mobile/primário fixo (Boards, Contatos, Atividades, Mais) — `PRIMARY_NAV_BASE` linhas 27-32.
- `getSecondaryNav({ isAdmin, getHref })` (linhas 73-91): se `isAdmin`, prefixa com `Plataforma` (`/platform`, linha 86), `Clientes` (`/platform/tenants`, linha 87) e `Novo Cliente` (`/platform/tenants/new`, linha 88) — é aqui que um item "Agentes" da agência (lista de todos os clientes) entraria.
- `getTenantWorkspaceNav({ tenantId, canAccessWhatsapp, canAccessConversations, canAccessAutomations, ... })` (linhas 93-126): monta o menu **dentro** do workspace de um tenant — hoje só `Automações`, `Conversas`, `Conexões` condicionados a permissão (linhas 110-125). É aqui que entraria um item "Agentes" por cliente, do mesmo jeito (bandeira de permissão + `href` com `tenantId`).
- Consumido em `components/Layout.tsx` e testado em `components/Layout.navOrder.test.tsx` (não abri o corpo de `Layout.tsx` — fora do escopo detalhado pedido, mas confirmo a referência via grep).
- Renderização visual da navegação: `components/navigation/NavigationRail.tsx` e `components/navigation/BottomNav.tsx` (não lidos linha a linha — achados por `find`, não abertos por completo; **não afirmo o conteúdo deles**, só a existência e o nome).
- `components/navigation/TenantClinicSwitcher.tsx` — o seletor de cliente no cabeçalho citado no comentário de `workspaceRoutes.ts` (não lido por completo).

### 3.5 Componentes de lista/tabela já usados na plataforma (para reaproveitar)

Não há um `DataTable`/`Table` genérico (busquei `*table*`/`*Card*` em `components/`; só achei `components/ui/card.tsx` e `components/ui/Modal.tsx` como primitivos reaproveitáveis — não abertos por completo).

O padrão real de lista é **grid manual com Tailwind**, visto por completo em `features/platform/tenants/TenantsPage.tsx` (292 linhas, arquivo inteiro lido):
- Cabeçalho de colunas: `grid grid-cols-[1.8fr_0.8fr_1fr_1fr_0.8fr]` (linha 210) com rótulos fixos (`Cliente, Edição, Último status, Funil inicial, Ações`).
- Cada linha é um `<button>` com o mesmo `grid-cols-...` (linha 232-286), estado de carregamento (linha 218-219), erro (220-221) e vazio (222-225) tratados manualmente.
- Busca os dados via `fetch('/api/platform/tenants')` num `useEffect` (linhas 42-68) — sem lib de data-fetching (sem SWR/React Query neste arquivo).
- Esse é o modelo mais próximo do que a tela "todos os agentes de todos os clientes" replicaria: grid manual, sem paginação, sem ordenação — a Central de Agentes teria que construir isso do zero ou introduzir uma lib de tabela (nenhuma está instalada hoje, não conferido `package.json` linha a linha para libs de tabela — busquei só os usos, não o manifesto completo de dependências).

Rota que essa tela consome: `app/api/platform/tenants/route.ts` — guarda de acesso em `requireAdminProfile()` (linhas 24-39 do arquivo, lidas): exige `isAgencyAdminRole(normalizeAppUserRole(profile.role))` (linha 39) — só agência lista/cria tenants. Modelo direto para a rota "listar agentes de todos os clientes" (mesma guarda).

---

## 4. Helpers de permissão (agência vs. admin do cliente)

| Helper | Arquivo:linha | O que exige |
|---|---|---|
| `requireAdminTenantContext(options?)` | `lib/platform/adminTenantContext.ts:17-84` | Usuário logado + perfil com `organization_id`; papel `isAgencyAdmin` **ou** `isClinicAdmin` (linha 39-44), senão 403. Resolve `targetOrganizationId` (próprio ou de outro tenant, só agência troca). Devolve `isAgencyAdmin`, `isClinicAdmin`, `managingOwnOrganization`. |
| `requireTenantAccess(tenantId, { adminOnly?, requiredPermissions? })` | `lib/platform/tenantAccess.ts:28-66` | Usuário logado; perfil pertence ao `tenantId` **ou** é `isAgencyAdminRole` (linha 48-49,53); `adminOnly` exige `isAgencyAdminRole` (linha 54); `requiredPermissions` checado via `hasPermission(role, perm, overrides)` (linha 55-57). Devolve `permissions`, `canManageChannelConfig`, `canPairDevices`. |
| `isAgencyAdminRole(role)` | `lib/auth/scope.ts:31-34` | `role === 'agency_admin' \|\| role === 'admin'` (papel legado). |
| `isClinicAdminRole(role)` | `lib/auth/scope.ts:44-46` | `role === 'clinic_admin'`. |
| `canManageClinicSettings(role)` | `lib/auth/scope.ts:60-62` | `isAgencyAdminRole \|\| isClinicAdminRole` — **usado indevidamente** como gate de UI em `AIConfigSection.tsx:141` para um recurso (provedor/modelo/chave) que o servidor restringe só a `isAgencyAdmin` (ver 1.3). |
| `can_configure_organization(org_id)` (SQL) | `supabase/migrations/20260311013000_core_multi_tenant_rls.sql:71-84` | `is_agency_admin_role()` **ou** (`current_profile_organization_id() = org_id` **e** `current_profile_app_role() in ('clinic_admin')`). Usado em `organization_settings_mutate_by_tenant_admin` (linhas 285-290) — mas é `for all`, ou seja, não distingue campo, só linha; a trava por campo (provider/modelo/chave vs. `ai_enabled`) é feita **na aplicação** (`route.ts`), não no banco. |
| `can_access_organization(org_id)` (SQL) | `...core_multi_tenant_rls.sql:44-54` | `is_agency_role()` ou pertencer à org — usado no `SELECT` (linha 279-283, mas a coluna secreta já não tem grant, ver 1.2). |
| `has_permission(permission_key)` (SQL, plpgsql) | `supabase/migrations/20260635000000_e2_server_permission_enforcement.sql:303-360` | Lê `profiles.role/organization_id` do `auth.uid()` atual; resolve default de permissão por papel + override por usuário (não copiei a lógica interna completa das linhas 328-360, só o cabeçalho e a assinatura — fora do escopo dos 6 pontos pedidos, mas confirmo que existe e é `security definer`, `search_path=''`, `grant execute ... to authenticated` linha 363). |

Não encontrei nenhum papel literal chamado `platform_admin` no código (a pergunta cita `platform_admin/clinic_admin/clinic_staff`) — os papéis reais em `APP_USER_ROLES` (`lib/auth/scope.ts:1-8`) são `agency_admin, agency_staff, clinic_admin, clinic_staff, admin, vendedor`. `agency_admin` (+ o legado `admin`) é o equivalente funcional de "platform_admin".

---

## 5. Colunas `boards.agent_*`

### 5.1 Migration e tipo

`supabase/migrations/20251201000000_schema_init.sql:144-151` (dentro do `CREATE TABLE boards`, lido em contexto):
```
goal_description TEXT
goal_kpi TEXT
goal_target_value TEXT
goal_type TEXT
agent_name TEXT
agent_role TEXT
agent_behavior TEXT
entry_trigger TEXT
```
`default_product_id`: adicionado depois, `ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS default_product_id UUID REFERENCES public.products(id)` — `schema_init.sql:280-281`, com índice `boards_default_product_id_idx` (linhas 283-284). Todas as colunas `agent_*`/`goal_*`/`entry_trigger` são `TEXT` livre (sem enum, sem tamanho máximo, sem `NOT NULL`).

### 5.2 Onde a tela grava

Mapeamento DB ↔ tipo do app em `lib/supabase/boards.ts`:
- Tipo de leitura do banco (linhas 107-113, aprox.): `agent_name, agent_role, agent_behavior, entry_trigger` como `string | null`.
- Conversão DB → app (linhas 184-207): monta `agentPersona: { name, role, behavior }` só se `agent_name` existir (linha 184), e `entryTrigger: db.entry_trigger || undefined` (linha 207).
- Conversão app → DB, no `insert`/`create` (linhas 258-261): `agent_name/agent_role/agent_behavior` a partir de `board.agentPersona?.{name,role,behavior}`, `entry_trigger` de `board.entryTrigger`.
- No `update` parcial (linhas 566, 577-580): só grava o que veio em `updates.entryTrigger`/`updates.agentPersona`.

A tela que edita é `features/boards/components/Kanban/BoardStrategyHeader.tsx` (arquivo inteiro lido, ~490 linhas pelas referências): usa `board.agentPersona`/`board.entryTrigger`/`board.goal` (camelCase, já mapeado — a tela nunca vê `agent_name` cru). Edição inline: campos de nome/role (linhas 369, 383) e "Como o agente deve agir" (linha 397-398) escrevem em `editedBoard.agentPersona.{name,role,behavior}`; salva via `updateBoard` (hook `useCRM`, linha 34, chamado em algum ponto não citado aqui — não seguido até o fim, mas o padrão de save assíncrono é visível pelas outras telas do repo).
Exibição recolhida (linhas 165-170) e expandida (linhas 356-483) mostram nome/role/behavior do agente com tooltip.

### 5.3 O atendimento de WhatsApp lê alguma dessas colunas?

**Não.** Busquei `agent_name|agent_role|agent_behavior|entry_trigger|agentPersona` em `lib/conversations/`, `app/api/public/channels/` e `lib/ai/` — as únicas 3 ocorrências (`lib/ai/actionsClient.ts`, `lib/ai/tasks/schemas.ts`, `lib/ai/tasksClient.ts`) são do **gerador de estratégia de board por IA** (`generateBoardStrategy`, `actionsClient.ts:216-234`) — a IA que **ajuda a preencher** esses campos na tela de configuração do funil, não o motor de resposta de WhatsApp. Confirmado lendo o trecho: `callAIProxy('generateBoardStrategy', { boardData })` e o retorno tem forma `{ goal, agentPersona, entryTrigger }` para popular o formulário — nada disso entra em `generateConversationAutoReply` (`aiReply.ts`), que só lê `organization_settings` (ver seção 1.5) e o `config` da conexão (`aiAgentConfig.ts`). **Confidence: High** (grep nos 3 módulos relevantes + leitura do trecho que apareceu).

Isso é um achado relevante para o design da Central: `boards.agent_*` já modela "nome/papel/comportamento de agente" **por board (funil)**, mas essa modelagem está isolada — nunca alimenta o prompt real do WhatsApp, que usa outro caminho (`aiAgentConfig.ts` por conexão + prompt template em `organization_settings`/catálogo de prompts). Uma Central de Agentes de verdade provavelmente precisa decidir se unifica essas duas fontes de "identidade do agente" ou mantém separadas.

---

## 6. Suíte de testes de plataforma

### 6.1 Vitest (componente/unidade)

`package.json` scripts relevantes (linhas 9-23 do arquivo): `"test": "vitest"`, `"test:run": "vitest run"`, `"stories": "vitest run test/stories --reporter=dot"`, `"test:e2:server": "vitest run test/e2ServerEnforcement.test.ts test/e2ServerIsolation.local.test.ts --reporter=verbose"`.

Testes de componente dentro de `features/platform/` (9 arquivos, `find` + contagem):
```
features/platform/tenants/MetaCapiSettings.test.tsx
features/platform/tenants/TenantChannelsPage.test.tsx
features/platform/tenants/TenantConversationsPage.test.tsx
features/platform/tenants/conversations/CalendarBlocksPanel.test.tsx
features/platform/tenants/conversations/ChannelCalendarSettings.test.tsx
features/platform/tenants/conversations/ConversationDealPanel.test.tsx
features/platform/tenants/conversations/ConversationHandoffCard.test.tsx
features/platform/tenants/conversations/feedbackDoEnvio.test.ts
features/platform/tenants/conversations/messageBubbleRemetente.test.tsx
```
(não abri o conteúdo de cada um — confirmo só a existência/local via `find`, fora do escopo dos 6 pontos pedidos rodar/ler todos).

Teste de rota/navegação da plataforma, lido por completo: `lib/tenancy/workspaceRoutes.test.ts` (ver seção 3.3) — compara `TENANT_SCOPED_BASE_ROUTES` com as pastas reais em disco.

### 6.2 Playwright (ponta a ponta)

Config: `playwright.config.ts:1-40+` (lido) — `testDir: './test/e2e'`, `baseURL` default `http://localhost:3000` (nunca produção por padrão, comentário linha 19-20), usa `storageState` de `playwright/.auth/user.json` se existir (linha 5-6,24), sobe `npm run dev` como `webServer` quando não há `PLAYWRIGHT_BASE_URL` (linhas 27-32).

Só existe **um** spec de ponta a ponta em todo o repo, e é exatamente da plataforma: `test/e2e/tenant-workspace-navigation.spec.ts` (lido por completo, 30 linhas mostradas + resto do describe) — testa que o seletor de board não quebra a navegação lateral ao trocar de tela dentro do workspace de um tenant (`/platform/tenants/:id/boards` → `Contatos` → `Configurações`), com `test.skip` automático se cair em `/login` (linha 9-11) — ou seja, só roda de fato com sessão autenticada salva previamente.

Scripts: `"test:e2e": "playwright test"`, `"test:e2e:headed": "playwright test --headed"`, `"test:e2e:auth": "playwright test test/e2e/auth.setup.ts"` (`package.json:21-23`).

**Conclusão do item 6:** existe suíte de componente (Vitest + Testing Library, pelo padrão `.test.tsx` — não confirmei a lib exata de testing-library no `package.json`, não lido por completo) cobrindo pedaços da plataforma, e exatamente 1 teste Playwright de ponta a ponta, focado em navegação — não há hoje nenhum teste (unidade, componente ou e2e) sobre agentes de IA, modelo por agente, custo ou tempo de resposta na área de plataforma; esses testes teriam que ser criados do zero junto com a Central de Agentes.

---

## Achados que pedem decisão (não é meu papel decidir)

1. **Inconsistência UI × servidor em `AIConfigSection.tsx:141`**: a tela libera o formulário completo de provedor/modelo/chave para `clinic_admin`, mas o servidor (`app/api/settings/ai/route.ts:115-117`) só aceita esse POST de `agency_admin`. Para a Central de Agentes (que provavelmente reusa essa mesma governança "agência configura, cliente só pausa"), vale decidir se conserta esse mismatch agora ou se herda o mesmo padrão (tela mostrando campo que o servidor rejeita) no editor novo.
2. **Duas fontes de "identidade de agente" que não se falam**: `boards.agent_name/agent_role/agent_behavior` (por funil, não usado no WhatsApp) vs. `connection.config.aiAgentName/aiPromptKey` (por conexão de WhatsApp, efetivamente usado). Decisão de produto: a Central de Agentes edita qual das duas (ou unifica)?
3. **Custo por resposta não existe hoje em nenhuma camada** (nem captura de `usage`, nem tabela de preço) — é trabalho novo, não só exposição de dado existente.
