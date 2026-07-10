# Plano de implementação — Permissões granulares + convite (Basecrm)

> Base: spec `docs/spec-permissoes-granulares-e-convite.md` + mapa do código (workflow understand wpwijry2j).
> Regras: TDD, espelhamento entre features (padrão limpo), zod `.strict()`, permissões sempre data-driven do array central. Aprovar no localhost antes de subir (clínica no ar).

## Arquitetura confirmada (do mapa)
- **Modelo central** `lib/auth/permissions.ts`: `APP_PERMISSIONS` (5 chaves) → `PERMISSION_DEFINITIONS` (UI) → `ROLE_PERMISSION_DEFAULTS` (por cargo) → `resolvePermissionMap`/`hasPermission`. Os zod (`PermissionSchema`, invite) e o `profile_permissions.permission_key` (TEXT) herdam as chaves automaticamente → **chave nova = +1 no array, sem migration**.
- **Enforcement hoje**: server = `requireTenantAccess({requiredPermissions})` (único granular real) + `requireAdminTenantContext` (por role). Client = split de página estilo `FinanceReportPage` ("Acesso restrito" + `useAuth().profile.role`). **Gap: `useAuth()` não traz os overrides** → gate granular no client exige plumbing novo.
- **DB**: `organization_invites` e `profiles` não têm cargo/permission_overrides → 1 migration. `profile_permissions` já serve.

## Entregável 1 — Fluxo de convite granular (desbloqueia criar a Vitória)
### Task 0 — Migration
- Criar `supabase/migrations/20260634000000_invite_cargo_permissions.sql` (idempotente, header com régua):
  ```sql
  alter table public.organization_invites
    add column if not exists cargo text,
    add column if not exists permission_overrides jsonb not null default '{}'::jsonb;
  alter table public.profiles
    add column if not exists cargo text;
  ```
- Aditiva/backward-compatible (nullable + default). Testar em **Supabase branch** (MCP `create_branch`) → aplicar em prod só na aprovação.

### Task 1 — Taxonomia (`lib/auth/permissions.ts`) [TDD]
- Adicionar campo `group` (+ `level` opcional) a `PermissionDefinition`.
- Expandir `APP_PERMISSIONS` de 5 → ~30 chaves (10 grupos do spec), nível ver/editar/gerenciar.
- Preencher `ROLE_PERMISSION_DEFAULTS` para **TODAS** as chaves × 6 roles (TS `Record<AppPermission,boolean>` obriga — senão build quebra). Regra de default:
  - `agency_admin`/`admin`/`clinic_admin` = **tudo true**.
  - `clinic_staff`/`vendedor` = **operacional true** (dashboard/overview.view, contacts.view/edit, funnels.view/move, conversations.access/reply, activities.*, tasks.*, call_list.access, atendimentos.view, agenda.view/manage, ai.use, reports.view) e **sensível false** (settings.*, settings.finance, reports.finance, reports.professionals, contacts.delete, funnels.manage, atendimentos.manage, ai.configure, whatsapp.manage_connection, settings.users.manage).
  - `agency_staff` = como agency menos manage_connection e users.manage (mantém padrão atual).
- **Teste (red→green)**: `resolvePermissionMap` com chaves novas + overrides; `getDefaultPermissionMap('clinic_staff')['settings.finance']===false`; `['contacts.view']===true`.

### Task 2 — Invite create API (`app/api/admin/invites/route.ts`) [TDD]
- `CreateInviteSchema`: `email` vira **obrigatório**; add `cargo: z.string().trim().max(120).optional()` + `permissionOverrides` (record derivado de `APP_PERMISSIONS`, igual `PermissionSchema`).
- Insert grava `cargo` + `permission_overrides`. GET/return incluem as colunas.
- **Teste**: POST sem email → 400; POST com cargo+overrides → persiste; overrides com chave inválida → rejeitada pelo schema.

### Task 3 — Invite accept API (`app/api/invites/accept/route.ts`) [TDD]
- Select do invite inclui `cargo, permission_overrides`.
- Upsert `profiles` grava `cargo`.
- Após criar profile: iterar `permission_overrides`, validar `APP_PERMISSIONS.includes(key)` + `typeof===boolean`, upsert em `profile_permissions` (espelho EXATO de `users/[id]/permissions/route.ts`, `onConflict user_id,permission_key`, `organization_id = invite.organization_id`). Rollback `deleteUser` se falhar.
- **Teste**: aceite aplica overrides → linhas em profile_permissions; cargo no profile; email-lock (outro email → 400).

### Task 4 — UI do convite (`features/settings/UsersPage.tsx`)
- Extrair componente `Toggle` (do markup inline `button role=switch`, linhas 626-644) → reusar na grid E no convite (espelhamento).
- Modal "Gerar Convite": add `<input email required>` (helper `isValidEmail`), `<input>` texto-livre **Cargo/Função** (estado `newUserJobTitle`), e bloco de **toggles agrupados por `group`** (estado `invitePermissions`, init de `getDefaultPermissionMap(newUserRole)`, resync ao trocar role).
- `handleGenerateLink` envia `email`, `cargo`, `permissionOverrides` no POST.
- **Critério E1**: no convite escrevo Cargo + marco por área (ver/editar/gerenciar) + email → envio → a pessoa entra pelo link só com aquele email e já nasce com exatamente esses acessos gravados.

## Entregável 2 — Enforcement Fase 1 (só as sensíveis "trancam")
### Task 5 — Plumbing de permissão no client (gargalo)
- Fazer os overrides chegarem no front: incluir `permissions` (resolvido) no `AuthContext`/fetchProfile (o GET `/api/admin/users` já resolve; criar/estender um endpoint "me" ou o carregamento do profile).
- Helper/hook `usePermission(key)` = `resolvePermissionMap(role, overrides)[key]`.
- **Teste**: hook retorna false p/ staff em `settings.finance`, true p/ admin.

### Task 6 — Gates das áreas sensíveis (defense-in-depth, padrão existente) [TDD]
Aplicar em `settings.*`, `settings.finance`/`reports.finance`, `settings.users.manage`, `atendimentos.*`:
- **Server** (dado): `requireTenantAccess(tenantId,{requiredPermissions:['chave']})` nas rotas de dado; `requireAdminTenantContext` já cobre as rotas admin (complementar com chave).
- **Client página**: replicar split `FinanceReportPage` → `/atendimentos` (hoje SEM gate!) + financeiro.
- **Nav/aba**: `Layout.tsx` (item `/atendimentos` hoje aberto a todos) + `SettingsPage.tsx` (abas) passam a checar a chave via `usePermission`.
- **Fail-safe**: negar sensível se a permissão não resolver `true`.
- **Teste**: `*.rbac.test.tsx` no molde existente — staff sem a chave NÃO vê; admin/ com a chave vê.

## Ordem sugerida
E1 (Task 0→4) primeiro → **Junior cria a Vitória com acesso granular** → E2 (Task 5→6) enforça as sensíveis logo em seguida (não bloqueia criar a Vitória; só faz os toggles sensíveis "morderem").

## Gate de qualidade (cada task)
`npm run typecheck` + `npm run lint` + testes verdes; localhost OK; aprovação do Junior; só então FF → main → prod.

## Riscos travados (do mapa)
- `.strict()`: mexer schema + front juntos (senão 400). Email obrigatório quebra o front atual até a Task 4 → fazer Task 2 e 4 na mesma leva.
- Preencher default de toda chave × todo role (senão TS quebra).
- Validar overrides server-side no accept (jsonb é aberto). `organization_id = invite.organization_id` (não a do ator) → evita cross-tenant.
- Client gate nunca basta sozinho → sempre par com server/RLS.
