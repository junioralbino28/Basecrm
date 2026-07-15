# E2 — Enforcement de permissões · PLAN (handoff pro Codex)

> **Para o Codex.** Este é o plano de implementação. O Junior já aprovou o `SPEC.md` (escopo + critério). Você implementa **independente**; o Claude revisa depois.
>
> **Autoridade das fontes:** `SPEC.md` = o quê/porquê (aprovado pelo Junior). `MAPA-CODIGO.md` = o estado atual verificado do código (com `caminho:linha`). Este `PLAN.md` = como fazer.
>
> **Modelo:** Opus 4.8 escreveu isto; você (Codex) implementa. Se discordar de algo, é bem-vindo — ver "Passo 0: sua opinião" abaixo, o Junior pediu explicitamente.

**Goal:** Fazer os toggles de permissão do E1 realmente bloquearem as áreas sensíveis (Financeiro, Configurações, Equipe, Atendimentos) em duas camadas — tela esconde (UX) + servidor/banco recusa (segurança real).

**Arquitetura:** Foundation primeiro (o cliente passa a conhecer as permissões do usuário logado + peças reutilizáveis), depois cada superfície troca o gate de ROLE por gate de PERMISSÃO e ganha enforcement de servidor. Client = UX; servidor/RLS = segurança.

**Tech stack / convenções:** siga o `AGENTS.md` do repo (raiz) — Next.js 16 App Router, Supabase (client/server/service-role em `lib/supabase/`), TanStack Query, Vitest + happy-dom + Testing Library, alias `@/`, testes `.test.ts(x)` ao lado do source, zero warnings no lint.

---

## Leitura obrigatória antes de codar (nesta ordem)

1. `docs/features/e2-enforcement/SPEC.md` — o quê e o critério de sucesso (6 pontos).
2. `docs/features/e2-enforcement/MAPA-CODIGO.md` — onde tudo está hoje, com linha.
3. `AGENTS.md` (raiz do repo) — comandos, cache rules, estilo.
4. `docs/basecrm-engineering-playbook.md` — padrões de engenharia do projeto.
5. **Skill de referência** (padrão que o Claude segue, pra vocês se entenderem): `C:/Users/PC Gamer/.claude/plugins/marketplaces/cenoura/engineering/skills/senku-fullstack/SKILL.md` — TDD lei de ferro, root-cause antes de fix, simplify (3 usos = abstrai, não menos), avisos Next.js 15+ (params/cookies/headers assíncronos), `'use client'` na folha.

## Regras de trabalho (não-negociáveis)

- **TDD**: teste que falha → roda e vê falhar → implementação mínima → roda e passa → commit. Um comportamento por teste.
- **Toque só o necessário** — sem refactor de passagem. Cada linha rastreia a uma tarefa deste plano.
- **Verificação antes de "pronto"**: `npm run typecheck` + `npm run lint` (zero warnings) + `npm run test:run` verdes antes de cada commit. Nunca declare "feito" sem rodar.
- **Segurança é server-side.** Gate de cliente é só UX — nunca a única camada. Todo bloqueio sensível tem que ter a camada de servidor/RLS junto.
- **Commits pequenos e frequentes**, um por tarefa. Convenção de mensagem: `feat(e2):`/`test(e2):`/`fix(e2):`. Rodapé: `Co-Authored-By: Codex <noreply@openai.com>` (ou sua assinatura).
- **Branch**: trabalhe em `feat/e2-enforcement` (a partir de `main` = `0dafe6b`). NÃO commite direto em `main`. NÃO faça deploy — o Junior aprova no localhost e o Claude/Junior sobem.
- **Não exclua nada** que não esteja no plano (o Junior deleta boards/dados manual).

---

## Passo 0 — Sua opinião ANTES de implementar (o Junior pediu)

Antes de escrever código, leia SPEC + MAPA + este PLAN e escreva um arquivo **`docs/features/e2-enforcement/OPINIAO-CODEX.md`** respondendo:

1. Concorda com a arquitetura de 2 camadas? Vê um caminho melhor/mais simples?
2. **A decisão em aberto mais importante — enforcement de servidor nas superfícies que NÃO passam por rota de API** (Financeiro via RPC e Atendimentos via Supabase client direto, ver MAPA §5). Duas opções:
   - **(A)** Rotear essas leituras por rotas de API novas que usem `requireTenantAccess({ requiredPermissions })` (padrão que já existe no projeto pra WhatsApp/Conversas).
   - **(B)** Adicionar policies RLS que leiam `profile_permissions` do usuário (enforcement no próprio banco), mantendo o acesso direto ao Supabase.
   Qual você recomenda pra este codebase, e por quê? (A é mais alinhada ao padrão atual; B é mais robusta mas mexe em RLS, que é delicado num sistema no ar.) **Não implemente a camada de servidor dessas duas superfícies até o Junior/Claude bater o martelo na sua recomendação.**
3. Algum risco que o plano não cobre?

Depois disso, siga pras tarefas. As Tarefas 0.1–4 (foundation + client + Equipe) podem ir independente da decisão acima; a camada de servidor de Financeiro/Atendimentos espera o martelo.

---

## Task 0.1 — Foundation: servidor expõe as permissões do usuário logado

**Files:**
- Create: `app/api/me/permissions/route.ts`
- Create: `app/api/me/permissions/route.test.ts`

**Contexto (MAPA §2):** o cliente hoje não sabe as permissões do usuário — `useAuth()` só tem `role`. `loadPermissionOverrides` é `server-only` (service role). Precisamos de um endpoint que devolva o mapa resolvido do PRÓPRIO usuário.

- [ ] **Passo 1 — teste que falha** (`route.test.ts`): mocka `@/lib/supabase/server` (getUser → user id), `profiles` select (role + organization_id), e `@/lib/auth/permissions.server` (`loadPermissionOverrides` → `{ 'reports.finance': false }`). Espera: `GET` retorna 200 com `{ permissions }` onde `permissions['reports.finance'] === false` e `permissions['contacts.view'] === true` (default do role). Sem user → 401.
- [ ] **Passo 2** — rode `npx vitest app/api/me/permissions/route.test.ts`, veja falhar.
- [ ] **Passo 3 — implementação**: `GET` que faz `getUser()` (401 se vazio), lê `profiles` (`role, organization_id`), chama `loadPermissionOverrides(user.id)` e `resolvePermissionMap(role, overrides)` (ambos de `@/lib/auth/permissions` e `@/lib/auth/permissions.server`), retorna `{ role, permissions }`. Sem organization_id → ainda retorna o mapa do role (não bloqueia).
- [ ] **Passo 4** — rode o teste, veja passar. Typecheck + lint.
- [ ] **Passo 5 — commit** `feat(e2): endpoint /api/me/permissions com o mapa resolvido do usuario logado`.

## Task 0.2 — Foundation: cliente carrega e expõe as permissões

**Files:**
- Modify: `context/AuthContext.tsx` (interface `AuthContextType` :69-88; `fetchProfile`/provider)
- Create: `lib/auth/useHasPermission.ts` (hook)
- Test: `lib/auth/useHasPermission.test.tsx`

- [ ] **Passo 1 — teste que falha** do hook: com um provider de teste que injeta `permissions: { 'reports.finance': false, 'contacts.view': true }`, `useHasPermission('reports.finance')` === `false`, `useHasPermission('contacts.view')` === `true`. Enquanto `permissions` não carregou (null) → o hook retorna `undefined` (estado "carregando", pra tela não piscar bloqueio antes da hora).
- [ ] **Passo 2** — rode, veja falhar.
- [ ] **Passo 3 — implementação**:
  - Em `AuthContext.tsx`: adicionar estado `permissions: Record<AppPermission, boolean> | null`; depois do profile carregar, `fetch('/api/me/permissions')` e setar. Expor `permissions` no `AuthContextType` e no value do provider. Resetar no signOut.
  - `useHasPermission(key: AppPermission): boolean | undefined` — lê `permissions` do `useAuth()`; `null` → `undefined`; senão `permissions[key] ?? false`.
- [ ] **Passo 4** — testes verdes. Typecheck + lint.
- [ ] **Passo 5 — commit** `feat(e2): AuthContext carrega permissions do usuario + hook useHasPermission`.

## Task 0.3 — Foundation: componente `<AccessDenied>` reutilizável

**Files:**
- Create: `components/AccessDenied.tsx`
- Test: `components/AccessDenied.test.tsx`

**Contexto (MAPA §4/§6):** hoje cada tela reimplementa o card de bloqueio (`<Lock>`/`<KeyRound>`) inline, com markup diferente. Unificar.

- [ ] **Passo 1 — teste que falha**: renderiza `<AccessDenied title="Acesso restrito" message="..."/>`, espera o título e a mensagem na tela, e `role="status"`/aria adequada.
- [ ] **Passo 2** — falhar.
- [ ] **Passo 3 — implementação**: componente client, props `{ title?: string; message: string; icon?: ReactNode }`, default title "Acesso restrito", ícone `<Lock>` (lucide), estilo do card que já existe em `FinanceReportPage.tsx:338-349` (reusar as classes pra manter o visual). Respeitar dark mode (tokens do tema).
- [ ] **Passo 4** — verde. Typecheck + lint.
- [ ] **Passo 5 — commit** `feat(e2): componente AccessDenied reutilizavel`.

## Task 1 — Financeiro (client) — trocar gate de ROLE por PERMISSÃO

**Files:**
- Modify: `features/reports/FinanceReportPage.tsx` (:334-352)
- Modify: `features/reports/ProfessionalsReportPage.tsx` (:211-)
- Modify: `features/settings/FinanceiroSettings.tsx` (gate)
- Modify/Create: os `.rbac.test.tsx` correspondentes

- [ ] Teste (seguindo o padrão de `features/settings/FinanceiroSettings.rbac.test.tsx`): usuário com `permissions['reports.finance'] === false` vê `<AccessDenied>`, não o conteúdo; com `true` vê o conteúdo. Idem `reports.professionals` e `settings.finance`.
- [ ] Trocar `if (!canManageClinicSettings(profile?.role))` por `const can = useHasPermission('reports.finance'); if (can === undefined) return <Loading/>; if (!can) return <AccessDenied .../>`. (Enquanto `undefined`, mostra loading — não pisca bloqueio.) Aplicar a chave certa em cada tela: `reports.finance`, `reports.professionals`, `settings.finance`.
- [ ] Verde + typecheck + lint. **Commit** `feat(e2): Financeiro gated por permissao (reports.finance/professionals, settings.finance)`.

## Task 2 — Configurações (client) — fechar o furo do acesso por URL

**Files:**
- Modify: `features/settings/SettingsPage.tsx` (:256, :283-312) — `renderContent()` e a lista de tabs
- Modify: `features/settings/{ProductsSettings,ProfessionalsSettings,IntegrationsSettings}.tsx` — gate próprio
- Modify/Create: `SettingsPage.rbac.test.tsx` (já existe, estender)

**Contexto (MAPA §5, FURO):** `renderContent()` (:293-312) não re-checa permissão e `activeTab` vem do pathname → acesso direto por URL renderiza o conteúdo mesmo com a aba escondida.

- [ ] Teste: com `permissions['settings.finance'] === false`, montar `SettingsPage` com `activeTab='financeiro'` (simulando URL direta) → mostra `<AccessDenied>`, NÃO `<FinanceiroSettings>`. Idem products/professionals/integrations com suas chaves.
- [ ] Em `renderContent()`: antes do `switch`, mapear cada tab → chave de permissão (`financeiro→settings.finance`, `products→settings.products`, `profissionais→settings.professionals`, `integracoes→settings.integrations`, `users→settings.users.manage`, `ai→ai.configure`, `general→settings.general`). Se o usuário não tem a chave do `activeTab` → renderizar `<AccessDenied>` em vez do conteúdo. Manter também o esconder-aba já existente (:284-290) trocando `canManageSettings` (role) pelas chaves por-aba.
- [ ] Verde + typecheck + lint. **Commit** `fix(e2): Settings re-checa permissao por aba (fecha bypass por URL direta)`.

## Task 3 — Equipe — gate por `settings.users.manage` (client + servidor)

**Files:**
- Modify: `features/settings/UsersPage.tsx` (:97, :477-491)
- Modify: rotas admin — `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts`, `app/api/admin/users/[id]/permissions/route.ts`, `app/api/admin/invites/route.ts`, `app/api/admin/invites/[id]/route.ts`
- Modify/Create: os `.test.ts` das rotas

- [ ] **Client**: trocar `canManageUsers` (role) por `useHasPermission('settings.users.manage')` + `<AccessDenied>`. Teste RBAC.
- [ ] **Servidor (defense-in-depth)**: hoje as rotas admin usam `requireAdminTenantContext` (role-only, MAPA §5). Complementar com a checagem da chave granular: depois do `requireAdminTenantContext`, carregar overrides do ator (`loadPermissionOverrides(me.id)`) e `hasPermission(me.role, 'settings.users.manage', overrides)` → 403 se não. **Padrão a definir com o Claude** se vira um helper (`requireAdminTenantContext` ganha `requiredPermissions?`) — proponha na sua OPINIAO-CODEX.md. Teste de rota: ator sem a chave → 403.
- [ ] Verde + typecheck + lint. **Commit** `feat(e2): Equipe gated por settings.users.manage (client + rotas admin)`.

## Task 4 — Financeiro (servidor) — AGUARDA a decisão A/B do Passo 0

- [ ] Depois do martelo (A = rotas de API com `requiredPermissions`; B = RLS lendo `profile_permissions`): implementar a camada de servidor pro Financeiro conforme decidido, com teste que prova 403/negação pra quem não tem `reports.finance`/`settings.finance`.
- [ ] **Commit** `feat(e2): enforcement de servidor do Financeiro`.

## Task 5 — Atendimentos — page gate + camada de dados (AGUARDA decisão A/B)

**Files:**
- Modify: `features/atendimentos/AtendimentosPage.tsx` (:11-70) — hoje SEM gate
- Camada de dados: `lib/query/hooks/useAtendimentosQuery.ts` (:20-38) + `lib/supabase/atendimentos.ts` (acesso direto ao Supabase) **ou** RLS — conforme decisão A/B

**Contexto (MAPA §5, o ponto mais delicado):** Atendimentos está totalmente aberto e vai **direto ao Supabase via RLS** (não há rota `/api/atendimentos`). Bloquear por permissão aqui é onde a decisão A/B mais pesa.

- [ ] **Client**: page gate com `useHasPermission('atendimentos.view')` + `<AccessDenied>`; esconder ações de escrita (Novo Atendimento) sem `atendimentos.manage`. Teste RBAC.
- [ ] **Servidor/dados**: implementar conforme A/B decidido, com teste provando que usuário sem `atendimentos.view` não recebe os dados (não só a tela escondida).
- [ ] **Commit** `feat(e2): Atendimentos gated (client + camada de dados)`.

---

## Definition of Done (o critério do SPEC, verificável)

Com um usuário de teste "Equipe da Clínica" e `reports.finance`/`settings.finance` desligados no convite:
1. Não vê menu Financeiro nem a aba financeiro de Configurações. ✅ teste RBAC + localhost
2. URL direta do Financeiro → `<AccessDenied>`, não o conteúdo. ✅ teste do bypass
3. A chamada de dados financeiros → 403 do servidor (ou RLS nega). ✅ teste de rota/RLS
4. Idem Configurações, Equipe, Atendimentos. ✅
5. Admin da Clínica vê e usa tudo. ✅
6. `npm run test:run` + typecheck + lint verdes, nada quebrado. ✅

Quando os 6 passarem: escreva o `IMPL-LOG.md` (o que fez, commits, desvios, dúvidas). O Claude revisa em `REVIEW.md`; o Junior aprova no localhost antes de qualquer deploy.

## Ordem sugerida
0 (opinião) → 0.1 → 0.2 → 0.3 → 1 → 2 → 3 (client) → **martelo A/B** → 3 (servidor) → 4 → 5. Foundation + client não dependem da decisão A/B; a camada de servidor de Financeiro/Atendimentos, sim.
