# E2 — Fase de servidor (RLS/B) · PLAN (handoff pro Codex)

> **Status:** liberada pelo Junior em 2026-07-15. Decisão A/B = **B (RLS)**, já aprovada.
> **Base:** `MAPA-CODIGO.md`, `OPINIAO-CODEX.md` (a trava que você mesmo definiu), `REVIEW.md`.
> **Regra-mãe:** esta fase mexe no **banco de uma clínica NO AR**. É o passo de maior risco do E2. NADA é aplicado no banco de produção sem revisão do Claude + aprovação explícita do Junior sobre a migration.
>
> Antes de começar: `git pull` na `feat/e2-enforcement` (o Claude adicionou `REVIEW.md`; HEAD atual = `34a3ce0`+).

## Objetivo

Fazer o enforcement de permissão valer **no banco** (não só na tela) para as superfícies que o client acessa direto: **Atendimentos** e **Financeiro**. Permissão compõe **em cima** do isolamento de tenant — nunca substitui. `tenant AND permission`, sempre.

## Duplo portão (obrigatório — sequência)

**S0 — DESIGN primeiro (você propõe, eu reviso, PARA).**
Escreva `docs/features/e2-enforcement/DESIGN-SERVIDOR.md` com o desenho ANTES de escrever qualquer SQL/migration. Depois **PARE** — o Claude revisa e o Junior aprova o desenho antes do S1.

**S1 — Implementar (só após o desenho aprovado).**
Migration + testes de isolamento. Mesmo pronta, a migration **NÃO é aplicada no banco de produção** até: testes verdes (em Supabase branch/local, não prod) + revisão do Claude + aprovação explícita do Junior sobre o SQL.

---

## S0 — o que o DESIGN-SERVIDOR.md tem que resolver

### 1. O helper SQL `has_permission` (o coração e o maior risco)
Hoje NÃO existe helper de permissão em SQL. A lógica de resolver (default do cargo em `ROLE_PERMISSION_DEFAULTS` + override por-chave em `profile_permissions`) só vive no TS (`lib/auth/permissions.ts`, função `resolvePermissionMap`). Proponha um helper tipo:
```
public.has_permission(permission_key text) returns boolean
```
que resolva, para o `auth.uid()` atual: role do profile + override em `profile_permissions` → default do cargo sobrescrito pelo override. `SECURITY DEFINER`, `stable`, `search_path` explícito (`= ''`), sem recursão de RLS.

**A decisão crítica que você tem que recomendar:** como os defaults de cargo (as listas `CLINIC_STAFF_DENIED`/`AGENCY_STAFF_DENIED` do TS) ficam representados no SQL **sem divergir do TS**? Opções a avaliar (e recomende uma, com o porquê):
- (a) tabela seed `role_permission_defaults` populada por migration a partir das constantes do TS (fonte única = precisa de um passo de geração/sincronização);
- (b) o helper só aplica o OVERRIDE explícito sobre um gate de cargo coarse (ex.: `can_configure_organization` pra finance) — mais simples, menos granular, mas evita duplicar as 35 chaves no banco;
- (c) outra que você enxergar.
Diga o trade-off de manutenção (o que quebra se alguém mudar a taxonomia no TS e esquecer o SQL).

### 2. Composição nas policies/RPCs (mapa verificado)
- **Atendimentos** (`supabase/migrations/20260614000000_atendimentos.sql`): hoje
  - SELECT: `can_access_organization(organization_id)` → passa a `can_access_organization(org) AND has_permission('atendimentos.view')`.
  - MUTATE: `can_operate_organization(organization_id)` → `... AND has_permission('atendimentos.manage')`.
- **Financeiro** (RPCs em `20260621000000_finance_reports_rpcs.sql` / `20260624000000_finance_rpcs_fix.sql`, hoje guardados por `can_configure_organization`): compor/validar com `has_permission('reports.finance')` / `has_permission('reports.professionals')` dentro dos RPCs `SECURITY DEFINER`. Cuidado: RPC `SECURITY DEFINER` roda com privilégio elevado — a checagem tem que ser explícita no corpo.
- **Regra invariável:** permissão é `AND` em cima do tenant. Nunca reescreva o tenant check.

### 3. Fail-closed no banco
Se a leitura de permissão falhar/for ambígua para operação sensível → **negar** (não conceder). Espelha o `DENY_ALL` que o client já faz. Diga como o helper garante isso.

### 4. Semântica de concessão (a dúvida que você levantou no OPINIAO)
Um override pode **conceder** a um `clinic_staff` uma permissão que o default do cargo nega (ex.: staff com `atendimentos.manage=true`)? No client, sim (override vence). No banco, o helper tem que honrar isso — mas sempre dentro do tenant. Confirme que o desenho concede E nega via override, sempre `AND tenant`.

### 5. Plano de testes de isolamento (liste antes de codar)
- tenant A não vê/muta dado do tenant B (permissão concedida NÃO fura tenant);
- `atendimentos.view` negado → `SELECT` volta vazio/negado para aquele user;
- `atendimentos.manage` negado → `INSERT/UPDATE/DELETE` recusado;
- override que concede a staff → passa a ver/mutar (dentro do tenant);
- default por cargo (admin vê, staff conforme default);
- chamada DIRETA via PostgREST por usuário autenticado (não só via app) é barrada;
- RPCs financeiros `SECURITY DEFINER` chamados direto por user sem `reports.finance` → negados.

---

## S1 — implementação (após desenho aprovado)

- [ ] Migration aditiva e reversível em `supabase/migrations/` (timestamp novo, header comment, idempotente `create or replace`/`drop policy if exists`).
- [ ] Testes de isolamento (o padrão do projeto: ver `20260610…` testes RLS não-tautológicos com skip gracioso pré-migração; e os `.test.ts` de rota). Rodar contra **Supabase branch/local, NUNCA prod**.
- [ ] `precheck:fast` verde.
- [ ] Atualizar `IMPL-LOG.md`.
- [ ] **PARAR.** Não aplicar no banco de prod. O Claude revisa o SQL + os testes; o Junior aprova a migration explicitamente; só então a aplicação controlada.

---

## Task extra (client, pequena) — aba "Dados" = agência-only

Decisão do Junior (2026-07-15): a aba **"Dados"** das Configurações é **visão APENAS da agência** — usuários de clínica não veem nem acessam.

- [ ] Em `features/settings/SettingsPage.tsx`: hoje `activePermission` do `data` é `true` (sempre). Trocar por um gate de **escopo de agência** (role agency_admin/agency_staff — use os helpers de `@/lib/auth/scope`, ex. `isAgencyAdminRole` e o equivalente de agency_staff; NÃO é uma chave de permissão granular, é escopo). Esconder a tab (não montar pra clínica) + `<AccessDenied>` se acessada por URL direta por user de clínica.
- [ ] Teste RBAC: user de clínica (clinic_admin/clinic_staff) NÃO vê a aba Dados e é bloqueado na URL direta; user de agência vê.
- [ ] Commit `feat(e2): aba Dados restrita a escopo de agencia`. (Pode ir junto no lote, é client, baixo risco.)

## Definition of Done (fase servidor)
Com um `clinic_staff` com `atendimentos.view` negado no convite: mesmo chamando o Supabase/PostgREST **direto** (fora do app), NÃO recebe os atendimentos (banco nega). Idem finance sem `reports.finance`. Tenant A×B nunca vaza. Testes de isolamento verdes. Aba Dados só pra agência. Nada aplicado em prod sem aprovação do Junior sobre a migration.
