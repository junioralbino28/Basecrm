# E2 — Mapa verificado da superfície de enforcement (base do SPEC/PLAN)

> Levantado por subagente de exploração em 2026-07-15, com `caminho:linha` real (Vitest + Testing Library confirmados). É a fonte técnica do SPEC e do PLAN — o Codex pode confiar nisto, mas deve reconferir a linha antes de editar (o código pode ter mudado).

## Resumo executivo
O **servidor** já tem um gate granular real (`requireTenantAccess({requiredPermissions})`), mas ele só é usado nas rotas de **channels/whatsapp e conversations**. O **cliente** bloqueia por **ROLE** (`canManageClinicSettings`), nunca por permissão granular, porque `useAuth()` **não carrega os overrides**. **Atendimentos e Agenda praticamente não têm gate de permissão.**

## 1. Modelo E1 — `lib/auth/permissions.ts`
35 chaves em 10 grupos (`:1-47`). Tipos: `AppPermission` (`:49`), `PermissionOverrideMap = Partial<Record<AppPermission, boolean>>` (`:107`). Funções: `getDefaultPermissionMap(role)` (`:161-172`), `resolvePermissionMap(role, overrides?)` (`:174-185`), `hasPermission(role, permission, overrides?)` (`:187-193`). Merge: `overrides[key] ?? base[key]` — override booleano sempre vence; `undefined` cai no default do role. `PERMISSION_DEFINITIONS` (label/description/group) em `:59-105`.

## 2. Cliente — `context/AuthContext.tsx`
`useAuth()` (`:274-280`) expõe SÓ `role` (dentro de `profile`, interface em `:51-62`). `fetchProfile` (`:159-181`) faz `select('*')` na tabela `profiles` — **NÃO** carrega `profile_permissions`. **NÃO existe** `usePermission`/`useHasPermission` no repo. → plumbing novo é obrigatório pro E2.

## 3. Gates de servidor
- `lib/platform/tenantAccess.ts` — `requireTenantAccess(tenantId, { adminOnly?, requiredPermissions? })` (`:28`). Carrega overrides via `loadPermissionOverrides` (`:50`) e faz o gate granular real (`:55-57`). Retorna `{ profile, permissions, permissionOverrides, canManageChannelConfig }` (`:59-64`). **Único gate granular do projeto.**
- `lib/platform/adminTenantContext.ts` — `requireAdminTenantContext({tenantId?, scope?})` (`:17-20`). Gate **por ROLE** (`isAgencyAdminRole`/`isClinicAdminRole`, `:39-44`), sem `requiredPermissions`.
- `lib/auth/permissions.server.ts` — `loadPermissionOverrides(userId)` (`:6-42`, `server-only`). Lê `profile_permissions` via service role, filtra por `APP_PERMISSIONS`, fallback `{}` em erro.

## 4. Padrão de gate no cliente (a copiar)
`features/reports/FinanceReportPage.tsx`: conteúdo em `FinanceReportContent` (`:36-324`), wrapper `FinanceReportPage` (`:334-352`) com gate `if (!canManageClinicSettings(profile?.role))` → card `<Lock>` "Acesso restrito" (`:337-349`). Repetido em `ProfessionalsReportPage.tsx:211-` e variação em `UsersPage.tsx:97,:477-491` (`<KeyRound>`). **Todos por ROLE, nunca pela chave granular.**

## 5. Superfícies sensíveis — estado HOJE
- **Páginas `app/(protected)/**/page.tsx` = wrappers finos** (`dynamic import`, `ssr:false`), sem gate. `app/(protected)/layout.tsx` (`:43-110`) só monta providers, sem gate de permissão. Não há middleware de rota por permissão.
- **Configurações:** todas as rotas montam `features/settings/SettingsPage.tsx`. Gate `canManageSettings = canManageClinicSettings(role)` (`:256`) **só esconde abas** (`:284-290`). **BUG p/ E2:** `renderContent()` (`:293-312`) NÃO re-checa permissão e `activeTab` vem do pathname (`:262-280`) → acesso direto por URL a `/settings/financeiro|products|profissionais|integracoes` renderiza o conteúdo mesmo com a aba escondida. Só `UsersPage` tem gate interno (`:477`). `FinanceiroSettings/ProductsSettings/ProfessionalsSettings/IntegrationsSettings` não têm gate próprio. Chaves `settings.*` existem mas não são usadas.
- **Financeiro/Reports:** `FinanceReportPage`/`ProfessionalsReportPage` gated por ROLE; chaves `reports.finance`/`reports.professionals` não consultadas. `ReportsPage.tsx` (relatórios gerais) **sem gate**. Rota `app/api/reports/export/atendimentos/route.ts:11` gated por `requireAdminTenantContext` (role).
- **Equipe:** `UsersPage` gate por role (`:97,:477`). Rotas admin (`/api/admin/users*`, `/api/admin/invites*`) gated por `requireAdminTenantContext` (role), não pela chave `settings.users.manage`.
- **Atendimentos — ABERTO:** `features/atendimentos/AtendimentosPage.tsx:11-70` sem gate. **Não há rota `/api/atendimentos`** — CRUD vai direto ao Supabase via `useAtendimentos` (`lib/query/hooks/useAtendimentosQuery.ts:20-38`), gated só por RLS de tenant. Chaves `atendimentos.view/manage` nunca usadas.
- **Agenda:** `features/agenda/AgendaPage.tsx:10-49` sem gate de tela. Rotas `app/api/agenda/*` usam `requireTenantAccess(tenantId)` **sem** `requiredPermissions` (só valida tenant). Chaves `agenda.view/manage` nunca usadas.
- **Onde `requiredPermissions` É usado hoje:** só `conversations.access/reply` e `whatsapp.access/manage_connection` (rotas channels/conversations).

## 6. Convenções
- **Testes:** Vitest + @testing-library/react. Padrão RBAC: `features/settings/SettingsPage.rbac.test.tsx` e `FinanceiroSettings.rbac.test.tsx` mockam `@/context/AuthContext` (`useAuth: vi.fn()`) e variam `profile.role` por caso; asserção via `screen.queryByRole`. Testes de rota mockam o gate (`requireTenantAccessMock.mockResolvedValue(...)`, caso 403 = `{ error: new Response('Forbidden', {status:403}) }`). Unit do modelo: `lib/auth/permissions.test.ts`.
- **Componente de bloqueio reutilizável: NÃO EXISTE.** Cada tela reimplementa inline (`<Lock>`/`<KeyRound>`). Criar `<AccessDenied>` + hook `useHasPermission` client-side = trabalho novo do E2.

## Lacunas críticas (o que o E2 tem que resolver)
1. `useAuth()` não traz overrides → plumbing (carregar `profile_permissions` do próprio usuário) + hook `useHasPermission`.
2. Gates de client são por ROLE, não pela chave granular (apesar das chaves existirem).
3. `SettingsPage.renderContent()` não re-checa → bypass por URL direta.
4. Atendimentos e Agenda sem gate de permissão.
5. `requireAdminTenantContext` é role-only (rotas admin não complementam com chave granular).
6. `settings.audit` sem entrada de UI atual (`AuditLogDashboard.tsx` existe mas não plugado nas tabs).
