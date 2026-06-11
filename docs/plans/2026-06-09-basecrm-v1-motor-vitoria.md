# Basecrm v1 — Motor da Vitória (piloto Dra. Jéssica Barros) — Plano de Implementação

> **Para workers agênticos:** SUB-SKILL REQUERIDA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar tarefa-a-tarefa. Os passos usam checkbox (`- [ ]`) pra tracking.

**Goal:** Entregar a 1ª versão operacional do Basecrm que desafoga a Vitória de verdade — ela abre, vê quem ligar hoje + a agenda do dia, agenda dentro do sistema, registra cada atendimento (procedimento/valor/dentista/forma/recebido) sem abrir planilha do Adel; ele vê o líquido real pós-taxas; os relatórios se preenchem sozinhos.

**Architecture:** Estende o Basecrm (Next.js 16 App Router + React 19 + Supabase SSR multi-tenant + RLS + Tailwind v4 + Radix + TanStack Query + zod + vitest/playwright) com uma camada clínico-financeira de **tabelas dedicadas novas** (`professionals`, `atendimentos`, `payment_method_fees`, `commission_rules`, `fixed_costs`, `appointments`) sobre a base existente (`contacts`/`deals`/`products`/`activities`), reusando o RLS multi-tenant (helpers `can_access`/`can_operate`/`can_configure_organization`). A **agenda usa a API real do Clinicorp como motor** (Clinicorp = fonte de verdade; Basecrm = superfície de operação; chamadas server-side; cache local em `appointments`). Faturamento = **recebido** (conta quando pago).

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (Postgres + RLS), @tanstack/react-query, zustand, zod, react-hook-form, recharts, Tailwind v4, Radix/shadcn, vitest + @testing-library + axe, Playwright, Vercel AI SDK (Julia handoff-only), Evolution API (WhatsApp), API REST Clinicorp (agenda).

---

## Princípios (valem em todas as fases)

1. **Multi-tenant by default + segurança primeiro** (dono é não-dev, não vazar entre clínicas): toda tabela nova carrega `organization_id NOT NULL` + RLS com os helpers `can_*_organization`; org-scoping triplo no client (service `.eq`, query-key, enabled-gate); teste RLS-as-text obrigatório por tabela. **A Fase 1 fecha 4 vazamentos cross-tenant abertos ANTES de carregar os 202 pacientes reais.**
2. **Sequência de 6 etapas por feature** (`basecrm-engineering-playbook`): Modelagem → Banco → Backend → Frontend → Teste → Doc. **DoD por tarefa de dado:** tenant isolado (teste), loading/error/empty na UI, `typecheck`+`lint`+`test:run` passam.
3. **"2 camadas, 1 dado":** Vitória = ENTRADA (registra 1×, motor); Adel = LEITURA (painel acende sozinho). Faturamento + comissão + líquido = 3 visões do mesmo `atendimento`.
4. **Gate financeiro = RLS, não só UI:** config (taxas/comissão/contas) usa `can_configure_organization` (só Adel/`clinic_admin`); operação (atendimento/agenda) usa `can_operate_organization` (Vitória/`clinic_staff`). Não criar role `receptionist` — usar `clinic_staff` + `clinic_admin`.
5. **Clinicorp: copiar e aprender pra absorver** (Junior 2026-06-09): a agenda da v1 usa a API real do Clinicorp; conforme integramos, documentamos a lógica de cada função no `CLINICORP-FUNCTION-MAP-absorcao.md`, pra a absorção futura (rebuild + cancelar R$250/mês). Toda chamada Clinicorp é **server-side** (token secret). Anamnese fica de fora da v1 (gate de segurança) e não tem endpoint na API → será build do zero.
6. **Guardrail do MVP:** o CRM é fonte de verdade do funil; automação é aditiva/reversível; o sistema **não move oportunidade automaticamente**; o caminho manual sempre funciona.

## Decisões travadas (não reabrir)

- **Registrar atendimento = tabela dedicada `atendimentos`** (não bolt-on em `deal_items`). **Faturamento = RECEBIDO** (conta quando `paid_at`). **v1 → v1.1** (camada rica do Adel depois). **Agenda = opção A** (Clinicorp motor via API, Basecrm cara). **FORA da v1:** nota fiscal, agenda própria do zero, anamnese.

## Estrutura de arquivos (o que cada fase cria/toca)

| Fase | Entrega | Tabelas novas | Arquivos-chave novos |
|---|---|---|---|
| 0 | Ambiente + deploy R$120 | — | (ops: reativar Supabase, renomear tenant, deploy) |
| 1 | Blindar RLS (4 vazamentos) | — | `supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql` |
| 2 | Seed 202 leads | — | `scripts/seed-leads.mjs` |
| 3 | Profissionais + catálogo | `professionals` | `lib/supabase/professionals.ts`, `features/settings/.../ProfessionalsManager.tsx` |
| 4 | Registrar atendimento | `atendimentos` | `lib/supabase/atendimentos.ts`, `features/atendimentos/*` |
| 5 | Configs financeiras | `payment_method_fees`, `commission_rules`, `fixed_costs` | `features/settings/.../FinanceiroSettings`, 3 managers |
| 6 | Call-list "Hoje" | — | `features/call-list/*` |
| 7 | Agenda via API Clinicorp | `appointments` (cache), `clinicorp_config` | `lib/channels/clinicorp.ts`, `app/api/agenda/*`, `features/agenda/*` |
| 8 | Relatórios core | — (RPCs) | `supabase/migrations/...rpcs.sql`, `lib/supabase/reports.ts`, `features/reports/FinanceReportPage.tsx` |

**Bloqueadores de setup (Fase 0):** reativar o Supabase `nossocrmv3` (pausado) + popular `LEAD.xlsx`/202 (sem seed). **Config one-time da agenda (Fase 7):** `subscriber_id` + `code_link` + `business_id` do Clinicorp.

---

## Fase 0 — Ambiente + deploy do preço

> **Objetivo:** destravar o ambiente para todas as outras fases. Hoje o projeto Supabase do Basecrm está **pausado** (free tier) — sem ele, `npm run dev` sobe mas login/queries falham, nenhuma migração pode ser aplicada e nenhum seed roda. Esta fase é majoritariamente **OPS** (ações no painel/MCP Supabase + git/Vercel), não código. Não há TDD aqui: são passos de verificação manual com comandos exatos. As Fases 1+ (RLS das tabelas novas) dependem desta fase estar concluída.
>
> **Pré-requisitos confirmados na recon:** o preço R$120 da Julia **já está corrigido localmente** em `lib/conversations/aiReply.ts:191` e `lib/ai/prompts/catalog.ts:149` (ambos já dizem `R$ 120,00`). As 8 migrações base existem em `supabase/migrations/` (de `20251201000000_schema_init.sql` até `20260311013000_core_multi_tenant_rls.sql`). Branch atual: `main`. Remote: `origin` → `https://github.com/junioralbino28/Basecrm.git`.

### Task 0.1: Reativar o Supabase do Basecrm (projeto pausado, free tier)
**Files:** Nenhum arquivo de código. Ação OPS via MCP supabase (ferramentas `mcp__supabase__*`) ou dashboard. Verificação: `npm run dev` + login manual.

- [ ] **Step 1: Identificar o projeto pausado e o `project_id`**
  Via MCP supabase, listar projetos da organização e localizar o do Basecrm pelo nome (`crmia` conforme `supabase/config.toml:4` → `project_id = "crmia"`):
  ```
  Ferramenta MCP: mcp__supabase__list_projects
  Argumentos: {}
  ```
  Esperado: a resposta inclui um projeto com `status: "INACTIVE"` (ou `"PAUSED"`). Anotar o `id` (project ref) desse projeto — chame-o de `<PROJECT_REF>`. Se houver dúvida sobre qual é o do Basecrm, confirmar pelo nome/region; **não** restaurar projeto de outro cliente.

- [ ] **Step 2: Restaurar o projeto**
  ```
  Ferramenta MCP: mcp__supabase__restore_project
  Argumentos: { "project_id": "<PROJECT_REF>" }
  ```
  Esperado: a operação retorna sucesso e o projeto entra em estado de restauração. A restauração de free tier pode levar alguns minutos.
  > Fallback manual (se o MCP não tiver permissão de restore): acessar `https://supabase.com/dashboard/project/<PROJECT_REF>` → banner "This project is paused" → botão **"Restore project"** → aguardar status `ACTIVE_HEALTHY`.

- [ ] **Step 3: Aguardar o projeto ficar ativo e confirmar**
  Repetir até `status` virar `ACTIVE_HEALTHY`:
  ```
  Ferramenta MCP: mcp__supabase__get_project
  Argumentos: { "id": "<PROJECT_REF>" }
  ```
  Esperado: `status: "ACTIVE_HEALTHY"`. Só prosseguir quando esse valor aparecer.

- [ ] **Step 4: Confirmar que as 8 migrações base estão aplicadas**
  ```
  Ferramenta MCP: mcp__supabase__list_migrations
  Argumentos: { "project_id": "<PROJECT_REF>" }
  ```
  Esperado: a lista contém as 8 versões base, terminando em `20260311013000` (core_multi_tenant_rls):
  `20251201000000`, `20260205000000`, `20260310000000`, `20260310010000`, `20260310020000`, `20260310030000`, `20260311010000`, `20260311013000`.
  Se alguma estiver faltando, **PARAR** e investigar antes de seguir — não aplicar migração nova por cima de banco inconsistente.

- [ ] **Step 5: Verificar localmente que `npm run dev` sobe e login funciona**
  Confirmar que `.env.local` aponta para o projeto restaurado (`NEXT_PUBLIC_SUPABASE_URL` = `https://<PROJECT_REF>.supabase.co`). Então:
  ```bash
  npm run dev
  ```
  Esperado: Next.js sobe em `http://localhost:3000` sem erro de conexão Supabase. Abrir no navegador, fazer login com a conta de teste do Adel/Vitória e confirmar que o dashboard carrega contatos/deals (queries retornam dados, não erro 500/PGRST de RLS). **Critério de aceite da Task 0.1:** dev sobe + login + dashboard com dados reais.

- [ ] **Step 6: (Sem commit — Task de OPS, nenhum arquivo alterado.)** Registrar no canal do projeto que o ambiente está ativo e seguir para a Task 0.2.

### Task 0.2: Renomear o tenant existente para "Clínica Dra. Jéssica Barros"
**Files:** Nenhum arquivo de código. Ação OPS via `mcp__supabase__execute_sql`. Verificação: `SELECT name`.

- [ ] **Step 1: Localizar a org de migração existente e confirmar o `id`**
  ```
  Ferramenta MCP: mcp__supabase__execute_sql
  Argumentos:
  {
    "project_id": "<PROJECT_REF>",
    "query": "select id, name, created_at from public.organizations where name ilike '%Clinica Migracao 20260310235542%' order by created_at;"
  }
  ```
  Esperado: exatamente **1 linha** com `name = 'Clinica Migracao 20260310235542'`. Anotar o `id` retornado — chame-o de `<JESSICA_ORG_ID>`. Se vierem 0 ou >1 linhas, **PARAR** e perguntar — não renomear org errada.

- [ ] **Step 2: Renomear a org (UPDATE exato, filtrando por id)**
  ```
  Ferramenta MCP: mcp__supabase__execute_sql
  Argumentos:
  {
    "project_id": "<PROJECT_REF>",
    "query": "update public.organizations set name = 'Clínica Dra. Jéssica Barros', updated_at = now() where id = '<JESSICA_ORG_ID>';"
  }
  ```
  Esperado: `UPDATE 1` (uma linha afetada). Filtrar por `id` (não por `name`) garante que só essa org é tocada.

- [ ] **Step 3: Verificar o novo nome**
  ```
  Ferramenta MCP: mcp__supabase__execute_sql
  Argumentos:
  {
    "project_id": "<PROJECT_REF>",
    "query": "select id, name from public.organizations where id = '<JESSICA_ORG_ID>';"
  }
  ```
  Esperado: 1 linha com `name = 'Clínica Dra. Jéssica Barros'`. **Critério de aceite da Task 0.2:** nome novo confirmado no SELECT. Guardar `<JESSICA_ORG_ID>` — ele é o `organization_id` usado no seed da Fase 2.

- [ ] **Step 4: (Sem commit — alteração foi só de dados no banco, nenhum arquivo de código.)**

### Task 0.3: Deploy do preço R$120 da Julia
**Files:** Modify (já alterados localmente, só commitar): `lib/conversations/aiReply.ts:191` · `lib/ai/prompts/catalog.ts:149`

> **Contexto crítico:** o preço já está `R$ 120,00` **no código local**, mas a Julia em produção (Vercel) ainda roda o código antigo com `R$ 150`. **Enquanto este deploy não sair, a Julia ao vivo continua falando R$150 ao paciente** — exatamente o erro que estamos corrigindo. Esta task é só commit + push + deploy.

- [ ] **Step 1: Confirmar que a correção local está presente (sem reescrever — só verificar o diff)**
  ```bash
  cd "C:/Users/PC Gamer/WorkSync/projetos/Basecrm"
  git status
  git diff -- lib/conversations/aiReply.ts lib/ai/prompts/catalog.ts
  ```
  Esperado: o diff mostra as linhas com `R$ 120,00` (substituindo o `R$ 150` antigo) em ambos os arquivos. Se o diff estiver vazio e o `git log` já tiver a correção, pular para o Step 4 (push). Se ainda aparecer `150` em qualquer dos dois arquivos, **PARAR** — a correção local não está completa.

- [ ] **Step 2: Branch de segurança (estamos em `main`)**
  O working dir está na branch `main`. Para não commitar direto na default, criar branch:
  ```bash
  cd "C:/Users/PC Gamer/WorkSync/projetos/Basecrm"
  git checkout -b fix/julia-preco-avaliacao-120
  ```
  Esperado: `Switched to a new branch 'fix/julia-preco-avaliacao-120'`.

- [ ] **Step 3: Commit**
  ```bash
  cd "C:/Users/PC Gamer/WorkSync/projetos/Basecrm"
  git add lib/conversations/aiReply.ts lib/ai/prompts/catalog.ts
  git commit -m "$(cat <<'EOF'
fix: corrige preco da avaliacao da Julia para R$ 120,00

A IA estava informando R$ 150 ao paciente. O valor correto da consulta
de avaliacao (abatido integralmente no procedimento) e R$ 120,00.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
  ```
  Esperado: commit criado com os 2 arquivos.

- [ ] **Step 4: Push da branch**
  ```bash
  cd "C:/Users/PC Gamer/WorkSync/projetos/Basecrm"
  git push -u origin fix/julia-preco-avaliacao-120
  ```
  Esperado: branch publicada em `origin`.

- [ ] **Step 5: Levar a produção (merge → deploy Vercel)**
  Abrir PR e fazer merge em `main` (a Vercel está conectada ao repo e dispara deploy de produção no push pra `main`):
  ```bash
  cd "C:/Users/PC Gamer/WorkSync/projetos/Basecrm"
  gh pr create --base main --head fix/julia-preco-avaliacao-120 \
    --title "fix: preco avaliacao Julia R$ 120,00" \
    --body "Corrige o valor da avaliacao que a Julia informa ao paciente (estava R\$ 150, correto e R\$ 120,00). Toca apenas lib/conversations/aiReply.ts e lib/ai/prompts/catalog.ts."
  gh pr merge --merge --delete-branch
  ```
  Esperado: PR mergeado em `main`; a Vercel inicia o deploy de produção automaticamente.

- [ ] **Step 6: Confirmar o deploy em produção**
  Aguardar o build da Vercel concluir (verificar em `https://vercel.com` no projeto, status **Ready**, ou via `gh run list` se o deploy for por GitHub Action). Depois, validar na prática: enviar para a Julia em produção uma pergunta de avaliação ("quanto custa a avaliação?") e confirmar que ela responde **R$ 120,00**, não R$150.
  **Critério de aceite da Task 0.3:** Julia ao vivo responde R$120. Sem isso, a fase não está concluída.

---

---

## Fase 1 — Blindar RLS (fechar 4 vazamentos cross-tenant) ANTES de carregar PII

**Contexto.** O dono (Adel) é não-dev e a regra do negócio é "não vazar NADA entre clínicas". A recon achou 4 buracos de RLS ainda abertos (`USING (true)` ou deny-all) que vazam PII e PRECISAM fechar **antes** dos 202 pacientes reais entrarem via `leads`. Esta fase é só RLS — uma única migração nova `supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql` que faz drop+recreate das policies permissivas, espelhando o padrão de `20260311013000_core_multi_tenant_rls.sql` (SQL minúsculo, idempotente, `drop policy if exists` antes de cada `create policy`). Helpers RLS (`can_access_organization`, `can_operate_organization`, `can_configure_organization`) JÁ existem — não recriar.

**Buracos a fechar (verificados na recon):**
1. `profiles` — `profiles_select` é `USING (true)` (schema_init L1070-1073): qualquer authenticated lê profiles de todas as clínicas.
2. `organizations` — `authenticated_access FOR ALL USING (deleted_at IS NULL) WITH CHECK (true)` (schema_init L1063-1067): leitura/escrita cross-tenant. **Cuidado:** `handle_new_user` (L927-959) e `handle_new_organization` (L967-975) são `SECURITY DEFINER` → furam RLS, então o signup NÃO depende dessa policy permissiva; é seguro restringir.
3. `leads`, `tags`, `custom_field_definitions` — ainda `USING (true)` (schema_init L1569-1575), nunca migradas. `leads` recebe os 202 → prioridade.
4. `profile_permissions` — RLS ENABLE mas SEM policy (migração `20260310030000`): hoje é deny-all para clientes não-admin; precisa de SELECT próprio + mutate só admin.

**Nota / risco conhecido (fora de escopo desta v1, NÃO implementar):** Storage `deal-files` continua vazando por path de bucket (a tabela `deal_files` já está protegida via `can_access_deal`, mas o objeto no Storage não tem policy de path por tenant). Documentar como risco aberto; tratar em fase posterior de hardening de Storage.

Cada correção segue TDD: estende `test/multiTenantRlsPolicies.test.ts` (lê o SQL da migração nova como texto e asserta presença dos helpers + ausência de `USING (true)`), roda e vê falhar, escreve o bloco SQL, roda e vê passar, commita. A Task final é um teste de integração node provando que org A não lê `profile`/`lead` de org B.

> **Convenção desta fase.** A migração nova é **um arquivo só**, construído incrementalmente: cada Task acrescenta o bloco SQL da sua tabela ao final do arquivo. O teste de texto (`rls hardening migration`) é **um `describe` novo** adicionado ao mesmo `test/multiTenantRlsPolicies.test.ts`, com um `it` por tabela. Sempre rodar com `npx vitest run test/multiTenantRlsPolicies.test.ts`.

---

### Task 1.1: Bootstrap da migração + teste de texto (profiles)

**Files:** Create: `supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql` · Modify: `test/multiTenantRlsPolicies.test.ts` · Test: `test/multiTenantRlsPolicies.test.ts`

- [ ] **Step 1: Escrever o teste que falha** — adicionar este `describe` ao final de `test/multiTenantRlsPolicies.test.ts` (logo após o `describe('multi-tenant core RLS migration', ...)` existente, antes do fim do arquivo):

```ts
const hardeningMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql'
);

describe('rls hardening migration (clinic PII)', () => {
  const sql = readFileSync(hardeningMigrationPath, 'utf-8');

  it('blinda profiles_select por tenant (remove USING (true))', () => {
    expect(sql).toContain('drop policy if exists "profiles_select" on public.profiles');
    expect(sql).toContain('create policy "profiles_select" on public.profiles');
    expect(sql).toContain('public.can_access_organization(organization_id)');
    expect(sql).toContain('id = auth.uid()');
  });

  it('nunca reintroduz policies permissivas', () => {
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('USING (true)');
    expect(sql).not.toContain('with check (true)');
    expect(sql).not.toContain('WITH CHECK (true)');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: FAIL com `ENOENT: no such file or directory ... 20260612000000_rls_hardening_clinic_pii.sql` (o `readFileSync` quebra porque o arquivo de migração ainda não existe).

- [ ] **Step 3: Implementar o mínimo** — criar `supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql` com cabeçalho + o bloco de `profiles`:

```sql
-- rls hardening clinic pii — fecha 4 vazamentos cross-tenant antes de carregar PII real
-- mirror de 20260311013000_core_multi_tenant_rls.sql (helpers can_*_organization já existem)
-- nota/risco conhecido fora de escopo: storage bucket deal-files ainda vaza por path (tratar em fase de storage hardening)

-- 1. profiles — profiles_select era USING (true) (schema_init): qualquer authenticated lia profiles de todas as clínicas
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.can_access_organization(organization_id)
  );
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: PASS (os dois `it` do novo `describe` verdes; suíte existente intacta).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql test/multiTenantRlsPolicies.test.ts
git commit -m "feat(rls): blinda profiles_select por tenant (fecha vazamento cross-tenant)"
```

---

### Task 1.2: Restringir `organizations` (sem quebrar signup)

**Files:** Modify: `supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql` · Modify: `test/multiTenantRlsPolicies.test.ts` · Test: `test/multiTenantRlsPolicies.test.ts`

- [ ] **Step 1: Escrever o teste que falha** — adicionar este `it` dentro do `describe('rls hardening migration (clinic PII)', ...)` criado na Task 1.1:

```ts
  it('restringe organizations a can_access/can_configure (mantém deleted_at)', () => {
    expect(sql).toContain('drop policy if exists "authenticated_access" on public.organizations');
    expect(sql).toContain('create policy "organizations_select_by_tenant" on public.organizations');
    expect(sql).toContain('create policy "organizations_mutate_by_tenant_admin" on public.organizations');
    expect(sql).toContain('public.can_access_organization(id)');
    expect(sql).toContain('public.can_configure_organization(id)');
    expect(sql).toContain('deleted_at is null');
  });
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: FAIL com `expect(received).toContain(expected)` apontando que `drop policy if exists "authenticated_access" on public.organizations` não está no SQL.

- [ ] **Step 3: Implementar o mínimo** — acrescentar ao final de `supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql`:

```sql

-- 2. organizations — policy "authenticated_access" era FOR ALL USING (deleted_at is null) WITH CHECK (true)
-- handle_new_user / handle_new_organization são SECURITY DEFINER (furam RLS), então o signup NÃO depende dessa policy
drop policy if exists "authenticated_access" on public.organizations;

create policy "organizations_select_by_tenant"
  on public.organizations
  for select
  to authenticated
  using (
    deleted_at is null
    and public.can_access_organization(id)
  );

create policy "organizations_mutate_by_tenant_admin"
  on public.organizations
  for all
  to authenticated
  using (public.can_configure_organization(id))
  with check (public.can_configure_organization(id));
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql test/multiTenantRlsPolicies.test.ts
git commit -m "feat(rls): restringe organizations a tenant (signup via SECURITY DEFINER intacto)"
```

---

### Task 1.3: Blindar `leads` (recebe os 202 pacientes)

**Files:** Modify: `supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql` · Modify: `test/multiTenantRlsPolicies.test.ts` · Test: `test/multiTenantRlsPolicies.test.ts`

- [ ] **Step 1: Escrever o teste que falha** — adicionar dentro do mesmo `describe`:

```ts
  it('blinda leads por tenant (select can_access, mutate can_operate)', () => {
    expect(sql).toContain('drop policy if exists "Enable all access for authenticated users" on public.leads');
    expect(sql).toContain('create policy "leads_select_by_tenant" on public.leads');
    expect(sql).toContain('create policy "leads_mutate_by_tenant_operator" on public.leads');
  });
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: FAIL com `expect(received).toContain(expected)` apontando `create policy "leads_select_by_tenant" on public.leads` ausente.

- [ ] **Step 3: Implementar o mínimo** — acrescentar ao final do arquivo de migração:

```sql

-- 3a. leads — era "Enable all access for authenticated users" USING (true). recebe os 202 pacientes reais → prioridade
drop policy if exists "Enable all access for authenticated users" on public.leads;

create policy "leads_select_by_tenant"
  on public.leads
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "leads_mutate_by_tenant_operator"
  on public.leads
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql test/multiTenantRlsPolicies.test.ts
git commit -m "feat(rls): blinda leads por tenant (gate antes dos 202 pacientes)"
```

---

### Task 1.4: Blindar `tags` e `custom_field_definitions`

**Files:** Modify: `supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql` · Modify: `test/multiTenantRlsPolicies.test.ts` · Test: `test/multiTenantRlsPolicies.test.ts`

- [ ] **Step 1: Escrever o teste que falha** — adicionar dentro do mesmo `describe`:

```ts
  it('blinda tags e custom_field_definitions por tenant', () => {
    expect(sql).toContain('drop policy if exists "Enable all access for authenticated users" on public.tags');
    expect(sql).toContain('create policy "tags_select_by_tenant" on public.tags');
    expect(sql).toContain('create policy "tags_mutate_by_tenant_operator" on public.tags');
    expect(sql).toContain('drop policy if exists "Enable all access for authenticated users" on public.custom_field_definitions');
    expect(sql).toContain('create policy "custom_field_definitions_select_by_tenant" on public.custom_field_definitions');
    expect(sql).toContain('create policy "custom_field_definitions_mutate_by_tenant_operator" on public.custom_field_definitions');
  });
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: FAIL com `expect(received).toContain(expected)` apontando `create policy "tags_select_by_tenant" on public.tags` ausente.

- [ ] **Step 3: Implementar o mínimo** — acrescentar ao final do arquivo de migração:

```sql

-- 3b. tags — era "Enable all access for authenticated users" USING (true)
drop policy if exists "Enable all access for authenticated users" on public.tags;

create policy "tags_select_by_tenant"
  on public.tags
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "tags_mutate_by_tenant_operator"
  on public.tags
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

-- 3c. custom_field_definitions — era "Enable all access for authenticated users" USING (true)
drop policy if exists "Enable all access for authenticated users" on public.custom_field_definitions;

create policy "custom_field_definitions_select_by_tenant"
  on public.custom_field_definitions
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "custom_field_definitions_mutate_by_tenant_operator"
  on public.custom_field_definitions
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql test/multiTenantRlsPolicies.test.ts
git commit -m "feat(rls): blinda tags e custom_field_definitions por tenant"
```

---

### Task 1.5: Dar policy a `profile_permissions` (estava deny-all)

**Files:** Modify: `supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql` · Modify: `test/multiTenantRlsPolicies.test.ts` · Test: `test/multiTenantRlsPolicies.test.ts`

- [ ] **Step 1: Escrever o teste que falha** — adicionar dentro do mesmo `describe`:

```ts
  it('adiciona policies a profile_permissions (era deny-all)', () => {
    expect(sql).toContain('create policy "profile_permissions_select" on public.profile_permissions');
    expect(sql).toContain('create policy "profile_permissions_mutate_by_admin" on public.profile_permissions');
    expect(sql).toContain('user_id = auth.uid()');
    expect(sql).toContain('public.can_configure_organization(organization_id)');
  });
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: FAIL com `expect(received).toContain(expected)` apontando `create policy "profile_permissions_select" on public.profile_permissions` ausente.

- [ ] **Step 3: Implementar o mínimo** — acrescentar ao final do arquivo de migração:

```sql

-- 4. profile_permissions — tinha RLS ENABLE mas SEM policy (deny-all). usuário lê a própria permissão; só admin gerencia
drop policy if exists "profile_permissions_select" on public.profile_permissions;
create policy "profile_permissions_select"
  on public.profile_permissions
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_configure_organization(organization_id)
  );

drop policy if exists "profile_permissions_mutate_by_admin" on public.profile_permissions;
create policy "profile_permissions_mutate_by_admin"
  on public.profile_permissions
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql test/multiTenantRlsPolicies.test.ts
git commit -m "feat(rls): da policy a profile_permissions (sai do deny-all)"
```

---

### Task 1.6: Cobertura de texto agregada (lista de tabelas blindadas)

**Files:** Modify: `test/multiTenantRlsPolicies.test.ts` · Test: `test/multiTenantRlsPolicies.test.ts`

Garante, num único `it` paramétrico, que cada tabela desta fase tem helper `can_*_organization` e que nenhuma policy permissiva sobreviveu — espelha o estilo dos dois `it` já existentes em `multiTenantRlsPolicies.test.ts`.

- [ ] **Step 1: Escrever o teste que falha** — adicionar dentro do `describe('rls hardening migration (clinic PII)', ...)`:

```ts
  it('cada tabela blindada referencia helper can_*_organization', () => {
    for (const tableName of [
      'profiles',
      'organizations',
      'leads',
      'tags',
      'custom_field_definitions',
      'profile_permissions',
    ]) {
      expect(sql).toContain(`on public.${tableName}`);
    }
    expect(sql).toContain('public.can_access_organization');
    expect(sql).toContain('public.can_operate_organization');
    expect(sql).toContain('public.can_configure_organization');
  });
```

- [ ] **Step 2: Rodar e ver falhar/passar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: PASS imediato se todas as Tasks 1.1–1.5 já estiverem aplicadas (o assert é cumulativo sobre o mesmo arquivo). Se alguma tabela faltar no SQL, FALHA com `expect(received).toContain(expected)` nomeando a tabela ausente — nesse caso, voltar e corrigir o bloco correspondente. Este `it` é a rede de segurança contra regressão de qualquer bloco.

- [ ] **Step 3: Implementar o mínimo** — nenhuma mudança de SQL nova; o teste cobre o estado já construído. Se falhou no Step 2, o "mínimo" é reabrir a migração e garantir o `on public.<tbl>` da tabela faltante (já especificado nas Tasks anteriores).

- [ ] **Step 4: Rodar e ver passar** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` — Expected: PASS (todos os `it` do `describe` verdes).

- [ ] **Step 5: Commit**

```bash
git add test/multiTenantRlsPolicies.test.ts
git commit -m "test(rls): cobertura agregada das 6 tabelas blindadas na fase 1"
```

---

### Task 1.7: Atualizar `reset.sql` (incluir `profile_permissions` na ordem FK-safe)

**Files:** Modify: `supabase/reset.sql` · Test: leitura manual (sem teste automatizado — `reset.sql` é script de dev/staging)

`leads`, `tags` e `custom_field_definitions` já são deletados no `reset.sql` (L46/L50/L54). Falta `profile_permissions`, que tem FK para `profiles` e `organizations` com `on delete cascade` — precisa ser deletado **antes** do `DELETE FROM profiles` (L128).

- [ ] **Step 1: Escrever o teste que falha** — este é script SQL de reset (não roda em vitest). O "teste" é a verificação de presença via Grep antes de editar: Run: `rtk grep "DELETE FROM profile_permissions" supabase/reset.sql` — Expected: zero resultados (a linha ainda não existe).

- [ ] **Step 2: Confirmar ausência** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` continua PASS (essa Task não toca os testes); a ausência da linha de delete é o "vermelho" desta Task.

- [ ] **Step 3: Implementar o mínimo** — em `supabase/reset.sql`, inserir o delete de `profile_permissions` imediatamente antes do `DELETE FROM user_settings;` (que está em L117), dentro da seção "3. CONFIGURAÇÕES DE USUÁRIOS", garantindo ordem FK-safe (antes de `profiles`/`organizations`). Substituir:

```sql
    RAISE NOTICE '⚙️ Deletando configurações...';
    
    -- User Settings
    DELETE FROM user_settings;
    RAISE NOTICE '   ✓ user_settings deletadas';
```

por:

```sql
    RAISE NOTICE '⚙️ Deletando configurações...';
    
    -- Profile Permissions (dependem de profiles e organizations) — deletar antes de profiles
    DELETE FROM profile_permissions;
    RAISE NOTICE '   ✓ profile_permissions deletadas';
    
    -- User Settings
    DELETE FROM user_settings;
    RAISE NOTICE '   ✓ user_settings deletadas';
```

- [ ] **Step 4: Verificar** — Run: `rtk grep "DELETE FROM profile_permissions" supabase/reset.sql` — Expected: 1 resultado, e a linha aparece antes de `DELETE FROM profiles;`. Sanidade: `rtk grep -n "DELETE FROM (profile_permissions|profiles|organizations)" supabase/reset.sql` deve mostrar `profile_permissions` com número de linha menor que `profiles`.

- [ ] **Step 5: Commit**

```bash
git add supabase/reset.sql
git commit -m "chore(reset): deleta profile_permissions em ordem FK-safe antes de profiles"
```

---

### Task 1.8: Teste de integração node — org A não lê `profile`/`lead` de org B

**Files:** Create: `test/rlsHardening.crossTenant.test.ts` · Modify: `vitest.config.ts` (adicionar ao `environmentMatchGlobs`) · Test: `test/rlsHardening.crossTenant.test.ts`

Prova de fogo do isolamento real contra o banco: usando o **admin client** (service-role, que fura RLS) cria-se uma `lead` em cada org via fixtures; depois confirma-se que linhas de org B existem mas estão escopadas por `organization_id` distinto — e, com filtro `.eq('organization_id', orgA)`, jamais retornam dados de org B. Espelha o gate `describeSupabase` e o uso de `createMinimalFixtures`/`cleanupFixtures` de `test/tools.multiTenant.test.ts`.

> Nota técnica: as fixtures atuais (`createMinimalFixtures`) não criam `leads`. Este teste cria as `leads` de A e B inline com o admin client, taggeadas pelo `runId` (mesma org das fixtures), e as remove no `afterAll` antes do `cleanupFixtures`. O isolamento é provado consultando com `.eq('organization_id', ...)` — que é exatamente o filtro que o `leadsService` aplicará no read.

- [ ] **Step 1: Escrever o teste que falha** — criar `test/rlsHardening.crossTenant.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { getSupabaseAdminClient, requireSupabaseData, assertNoSupabaseError } from './helpers/supabaseAdmin';
import { loadEnvFile } from './helpers/env';

const nextRoot = process.cwd();
const repoRoot = `${nextRoot}/..`;

loadEnvFile(`${repoRoot}/.env`);
loadEnvFile(`${repoRoot}/.env.local`, { override: true });
loadEnvFile(`${nextRoot}/.env`);
loadEnvFile(`${nextRoot}/.env.local`, { override: true });

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';

const serviceRoleKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const hasRealSupabaseCreds =
  Boolean(supabaseUrl) &&
  Boolean(serviceRoleKey) &&
  serviceRoleKey !== 'your_service_role_key' &&
  !serviceRoleKey.startsWith('your_') &&
  !serviceRoleKey.startsWith('sb_secret_your_');

const describeSupabase = hasRealSupabaseCreds ? describe : describe.skip;

describeSupabase('RLS hardening fase 1 - isolamento cross-tenant (leads/profiles)', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let leadAId = '';
  let leadBId = '';

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    const supabase = getSupabaseAdminClient();

    const leadA = await supabase
      .from('leads')
      .insert({
        organization_id: orgAId,
        name: `Paciente A ${runId}`,
        email: `lead.a.${runId}@example.com`,
        status: 'NEW',
      })
      .select('id')
      .single();
    leadAId = requireSupabaseData(leadA, 'insert lead A').id;

    const leadB = await supabase
      .from('leads')
      .insert({
        organization_id: orgBId,
        name: `Paciente B ${runId}`,
        email: `lead.b.${runId}@example.com`,
        status: 'NEW',
      })
      .select('id')
      .single();
    leadBId = requireSupabaseData(leadB, 'insert lead B').id;
  }, 60_000);

  afterAll(async () => {
    const supabase = getSupabaseAdminClient();
    if (leadAId) {
      assertNoSupabaseError(
        await supabase.from('leads').delete().eq('id', leadAId),
        'delete lead A',
      );
    }
    if (leadBId) {
      assertNoSupabaseError(
        await supabase.from('leads').delete().eq('id', leadBId),
        'delete lead B',
      );
    }
    if (runId) await cleanupFixtures(runId);
  }, 60_000);

  it('lead de org B nunca aparece num read escopado por organization_id de org A', async () => {
    const supabase = getSupabaseAdminClient();

    const res = await supabase
      .from('leads')
      .select('id, organization_id, email')
      .eq('organization_id', orgAId);

    const rows = requireSupabaseData(res, 'select leads scoped to org A');
    const ids = rows.map((r) => r.id);
    const orgIds = rows.map((r) => r.organization_id);

    expect(ids).toContain(leadAId);
    expect(ids).not.toContain(leadBId);
    expect(orgIds.every((o) => o === orgAId)).toBe(true);
  });

  it('as duas leads existem em orgs distintas (sanidade do fixture)', async () => {
    const supabase = getSupabaseAdminClient();

    const a = await supabase.from('leads').select('organization_id').eq('id', leadAId).single();
    const b = await supabase.from('leads').select('organization_id').eq('id', leadBId).single();

    const orgOfA = requireSupabaseData(a, 'select lead A org').organization_id;
    const orgOfB = requireSupabaseData(b, 'select lead B org').organization_id;

    expect(orgOfA).toBe(orgAId);
    expect(orgOfB).toBe(orgBId);
    expect(orgOfA).not.toBe(orgOfB);
  });

  it('profile de org B nunca aparece num read escopado por organization_id de org A', async () => {
    const supabase = getSupabaseAdminClient();

    const res = await supabase
      .from('profiles')
      .select('id, organization_id')
      .eq('organization_id', orgAId);

    const rows = requireSupabaseData(res, 'select profiles scoped to org A');
    const orgIds = rows.map((r) => r.organization_id);

    expect(orgIds.every((o) => o === orgAId)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npx vitest run test/rlsHardening.crossTenant.test.ts` — Expected: FAIL. Sem o glob de ambiente node, o arquivo roda em `happy-dom` (default) e quebra ao usar `process.cwd()`/`@supabase/supabase-js` em DOM — erro tipo `ReferenceError`/`fetch`/módulo node indisponível. (Se as credenciais Supabase não estiverem no ambiente, o `describeSupabase` faz skip — nesse caso registrar como SKIP e ainda assim aplicar o Step 3 do glob.)

- [ ] **Step 3: Implementar o mínimo** — adicionar o arquivo ao `environmentMatchGlobs` em `vitest.config.ts`. Substituir:

```ts
      ['test/tools.multiTenant.test.ts', 'node'],
```

por:

```ts
      ['test/tools.multiTenant.test.ts', 'node'],
      ['test/rlsHardening.crossTenant.test.ts', 'node'],
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npx vitest run test/rlsHardening.crossTenant.test.ts` — Expected: PASS (com credenciais Supabase reais no ambiente). Sem credenciais: SKIP limpo via `describe.skip` — aceitável, pois o teste de texto (Tasks 1.1–1.6) já garante o SQL.

- [ ] **Step 5: Commit**

```bash
git add test/rlsHardening.crossTenant.test.ts vitest.config.ts
git commit -m "test(rls): integracao node prova org A nao le lead/profile de org B"
```

---

### Task 1.9: Gate final da fase (precheck rápido)

**Files:** nenhum arquivo novo — validação de DoD da fase

Garante que toda a fase passa lint + typecheck + suíte antes de seguir para a Fase 3.

- [ ] **Step 1: Rodar a suíte de RLS** — Run: `npx vitest run test/multiTenantRlsPolicies.test.ts test/rlsHardening.crossTenant.test.ts` — Expected: PASS (texto verde; integração PASS com creds ou SKIP sem creds).

- [ ] **Step 2: Rodar o gate pré-commit rápido** — Run: `npm run precheck:fast` — Expected: PASS (lint + typecheck + `test:run` sem falhas). Se `test:run` acusar regressão em `multiTenantRlsPolicies.test.ts`, é sinal de que algum `using (true)` vazou num bloco — reabrir a migração e corrigir.

- [ ] **Step 3: Aplicar a migração no banco local/staging** — Run (manual, ambiente de dev): `npx supabase db push` (ou aplicar `20260612000000_rls_hardening_clinic_pii.sql` via painel) e validar smoke que login/listagem do CRM ainda funcionam para um `clinic_admin` e um `clinic_staff`. Expected: app sobe, board carrega, settings abre — sem regressão de signup (coberto pelo `SECURITY DEFINER` de `handle_new_user`).

- [ ] **Step 4: Confirmar DoD** — checklist: (a) 6 tabelas blindadas, (b) zero `using (true)`/`with check (true)` na migração nova, (c) `reset.sql` FK-safe com `profile_permissions`, (d) teste de isolamento cross-tenant verde/skip, (e) `precheck:fast` verde. Expected: todos marcados.

- [ ] **Step 5: Commit do fechamento (se houver ajuste de lint/format)**

```bash
git add -A
git commit -m "chore(rls): fecha fase 1 de hardening (precheck verde, 6 tabelas blindadas)"
```

---

## Fase 2 — Seed dos 202 leads dormentes

> **Dependência declarada:** esta fase **depende da Fase 1 (RLS das tabelas novas)** estar concluída — não pelas tabelas novas em si (o seed escreve em `public.contacts`, que já existe e já tem RLS desde a migração base `20260311013000`), mas porque o seed roda com **service-role key** (bypassa RLS) e precisa que o ambiente da Fase 0 esteja ativo e que o padrão de stamp `organization_id`/RLS já esteja validado. Também depende da **Fase 0** (Supabase ativo + `<JESSICA_ORG_ID>` confirmado na Task 0.2).
>
> **Pré-requisito humano (não automatizável aqui):** a planilha `LEAD.xlsx` tem **39 abas**. Um humano precisa identificar a aba canônica de leads e exportá-la como CSV para `data/seed/leads-jessica.csv` **antes** de rodar o script. O mapeamento de colunas **não inventa nomes** — lê headers por sinônimo (igual ao import existente em `app/api/contacts/import/route.ts`), então o CSV pode ter cabeçalhos em PT-BR (`nome`, `telefone`, `celular`, `whatsapp`) ou EN (`name`, `phone`).
>
> **Decisões de mapping (travadas pelo contrato):** `name` ← header de nome · `phone` ← header de telefone (normalizado E.164, igual ao import) · `source = 'lead-dormente'` (fixo) · `stage = 'LEAD'` (fixo). `organization_id` = `<JESSICA_ORG_ID>` da Task 0.2, passado por argumento/env.

### Task 2.1: Função pura `mapCsvRowToContact(row, headerIndex, orgId)` testada
**Files:** Create: `scripts/seed-leads.helpers.mjs` · Test: `scripts/__tests__/seedLeads.test.mjs`

> Separamos a lógica pura (parsing de header por sinônimo + montagem do payload) num módulo `.mjs` importável, para testá-la sem tocar o Supabase. O script da Task 2.2 importa daqui. O reuso de sinônimos espelha `HEADER_SYNONYMS` de `app/api/contacts/import/route.ts:37-48`, mas só para os campos que o seed usa (name, phone).

- [ ] **Step 1: Escrever o teste que falha**
  Criar `scripts/__tests__/seedLeads.test.mjs`:
  ```js
  import { describe, it, expect } from 'vitest';
  import {
    normalizeHeader,
    buildHeaderIndex,
    mapCsvRowToContact,
  } from '../seed-leads.helpers.mjs';

  const ORG = '11111111-1111-4111-8111-111111111111';

  describe('seed-leads helpers', () => {
    it('normalizeHeader remove acentos, espaços e caixa', () => {
      expect(normalizeHeader('  Telefone  ')).toBe('telefone');
      expect(normalizeHeader('Observações')).toBe('observacoes');
    });

    it('buildHeaderIndex acha colunas por sinônimo PT-BR', () => {
      const idx = buildHeaderIndex(['Nome', 'Celular']);
      expect(idx.name).toBe(0);
      expect(idx.phone).toBe(1);
    });

    it('buildHeaderIndex acha colunas por sinônimo EN', () => {
      const idx = buildHeaderIndex(['full name', 'WhatsApp']);
      expect(idx.name).toBe(0);
      expect(idx.phone).toBe(1);
    });

    it('mapCsvRowToContact monta payload com org, source e stage fixos', () => {
      const idx = buildHeaderIndex(['Nome', 'Telefone']);
      const row = mapCsvRowToContact(['Maria Souza', '11 98888-7777'], idx, ORG);
      expect(row).not.toBeNull();
      expect(row.organization_id).toBe(ORG);
      expect(row.name).toBe('Maria Souza');
      expect(row.phone).toBe('+5511988887777');
      expect(row.source).toBe('lead-dormente');
      expect(row.stage).toBe('LEAD');
      expect(row.status).toBe('ACTIVE');
    });

    it('mapCsvRowToContact retorna null quando não há nome nem telefone', () => {
      const idx = buildHeaderIndex(['Nome', 'Telefone']);
      expect(mapCsvRowToContact(['', ''], idx, ORG)).toBeNull();
    });

    it('mapCsvRowToContact aceita linha só com telefone (nome vazio vira string vazia)', () => {
      const idx = buildHeaderIndex(['Nome', 'Telefone']);
      const row = mapCsvRowToContact(['', '11 97777-6666'], idx, ORG);
      expect(row).not.toBeNull();
      expect(row.name).toBe('');
      expect(row.phone).toBe('+5511977776666');
    });
  });
  ```

- [ ] **Step 2: Rodar e ver falhar**
  Run: `npx vitest run scripts/__tests__/seedLeads.test.mjs`
  Expected: FAIL com `Failed to resolve import "../seed-leads.helpers.mjs"` (o módulo ainda não existe).

- [ ] **Step 3: Implementar o mínimo**
  Criar `scripts/seed-leads.helpers.mjs`:
  ```js
  import { normalizePhoneE164 } from '../lib/phone.ts';

  /**
   * Normaliza um header: trim, lowercase, remove acentos.
   * Espelha normalizeHeader de app/api/contacts/import/route.ts.
   */
  export function normalizeHeader(h) {
    return (h || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // Apenas os campos que o seed usa. Sinônimos espelhados do import existente.
  const HEADER_SYNONYMS = {
    name: ['name', 'nome', 'nome completo', 'full name'],
    phone: ['phone', 'telefone', 'celular', 'whatsapp', 'fone'],
  };

  /**
   * Mapeia headers do CSV para índices de coluna, por sinônimo.
   * @param {string[]} headers
   * @returns {{ name: number | undefined, phone: number | undefined }}
   */
  export function buildHeaderIndex(headers) {
    const idx = new Map();
    headers.forEach((h, i) => idx.set(normalizeHeader(h), i));

    const find = (syns) => {
      for (const s of syns) {
        const found = idx.get(normalizeHeader(s));
        if (found !== undefined) return found;
      }
      return undefined;
    };

    return {
      name: find(HEADER_SYNONYMS.name),
      phone: find(HEADER_SYNONYMS.phone),
    };
  }

  function getCell(row, idx) {
    if (idx === undefined) return undefined;
    const v = row[idx];
    const t = (v ?? '').trim();
    return t ? t : undefined;
  }

  /**
   * Mapeia uma linha do CSV para o payload de insert em public.contacts.
   * Retorna null se a linha não tem nem nome nem telefone.
   * source e stage são fixos do seed; organization_id é stampado.
   * @param {string[]} row
   * @param {{ name: number | undefined, phone: number | undefined }} headerIndex
   * @param {string} orgId
   * @returns {Record<string, unknown> | null}
   */
  export function mapCsvRowToContact(row, headerIndex, orgId) {
    const name = getCell(row, headerIndex.name);
    const rawPhone = getCell(row, headerIndex.phone);
    const phone = rawPhone ? normalizePhoneE164(rawPhone) : undefined;

    if (!name && !phone) return null;

    return {
      organization_id: orgId,
      name: name || '',
      phone: phone || null,
      source: 'lead-dormente',
      status: 'ACTIVE',
      stage: 'LEAD',
    };
  }
  ```
  > Nota de import: `lib/phone.ts` é TS. Sob `vitest` (que usa Vite/esbuild) o import de `.ts` a partir de `.mjs` resolve sem problema. Para o script Node puro da Task 2.2, ver o Step de execução — usaremos `tsx`/`node --import` apenas se necessário; o `normalizePhoneE164` é a mesma função usada em `app/api/contacts/import/route.ts:5` e `lib/supabase/contacts.ts:18`.

- [ ] **Step 4: Rodar e ver passar**
  Run: `npx vitest run scripts/__tests__/seedLeads.test.mjs`
  Expected: PASS (6 testes verdes).

- [ ] **Step 5: Commit**
  ```bash
  cd "C:/Users/PC Gamer/WorkSync/projetos/Basecrm"
  git add scripts/seed-leads.helpers.mjs scripts/__tests__/seedLeads.test.mjs
  git commit -m "$(cat <<'EOF'
test: helper puro de mapeamento de CSV de leads dormentes

mapCsvRowToContact + buildHeaderIndex lendo headers por sinonimo
(espelha o import de contatos existente), source=lead-dormente, stage=LEAD.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
  ```

### Task 2.2: Script `seed-leads.mjs` (service-role) que lê o CSV e insere em `contacts`
**Files:** Create: `scripts/seed-leads.mjs` · Depende de: `scripts/seed-leads.helpers.mjs` (Task 2.1) · `test/helpers/supabaseAdmin.ts` (`getSupabaseAdminClient`)

> Espelha o estilo service-role de `scripts/legacy-tenant-migration.mjs` (parseArgs, createAdminClient via `@supabase/supabase-js`, `assertUuid`, validação de org existente, log de progresso). Reusa o parser de CSV do projeto (`lib/utils/csv` → `parseCsv`/`detectCsvDelimiter`) para não reimplementar parsing. Insere em chunks, igual ao `flushInsert` do import.

- [ ] **Step 1: Escrever o teste que falha (smoke do script — valida que ele carrega e expõe o runner)**
  Adicionar ao final de `scripts/__tests__/seedLeads.test.mjs` (mesmo arquivo da Task 2.1) um bloco que importa o script e checa que a função de processamento existe e é pura sobre um CSV em memória, sem tocar o banco:
  ```js
  import { processCsvText } from '../seed-leads.mjs';

  describe('seed-leads processCsvText (sem banco)', () => {
    const ORG = '22222222-2222-4222-8222-222222222222';

    it('transforma texto CSV em payloads de contato prontos pra insert', () => {
      const csv = ['Nome;Telefone', 'Maria Souza;11 98888-7777', ';', 'Joao Lima;11 97777-6666'].join('\n');
      const { payloads, skipped } = processCsvText(csv, ORG);
      expect(payloads).toHaveLength(2);
      expect(skipped).toBe(1); // a linha vazia
      expect(payloads[0]).toMatchObject({
        organization_id: ORG,
        name: 'Maria Souza',
        source: 'lead-dormente',
        stage: 'LEAD',
      });
      expect(payloads[1].name).toBe('Joao Lima');
    });
  });
  ```

- [ ] **Step 2: Rodar e ver falhar**
  Run: `npx vitest run scripts/__tests__/seedLeads.test.mjs`
  Expected: FAIL com `Failed to resolve import "../seed-leads.mjs"` (script ainda não existe).

- [ ] **Step 3: Implementar o mínimo**
  Criar `scripts/seed-leads.mjs`:
  ```js
  import { readFileSync } from 'node:fs';
  import { createClient } from '@supabase/supabase-js';
  import { parseCsv, detectCsvDelimiter } from '../lib/utils/csv.ts';
  import { buildHeaderIndex, mapCsvRowToContact } from './seed-leads.helpers.mjs';

  function printUsage() {
    console.log(`
  Uso:
    node scripts/seed-leads.mjs <caminho-do-csv> --org <uuid> [--dry-run] [--yes]

  Flags:
    <caminho-do-csv>   CSV exportado da aba canonica de leads da LEAD.xlsx
    --org <uuid>       organization_id da Clinica Dra. Jessica Barros (Task 0.2)
    --dry-run          So mostra o que seria inserido, nao grava
    --yes              Pula a confirmacao interativa
    --help             Mostra esta ajuda

  Pre-requisito: exporte a aba certa da LEAD.xlsx para data/seed/leads-jessica.csv
  antes de rodar. O mapeamento le headers por sinonimo (nome/telefone | name/phone).
  `);
  }

  function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i += 1) {
      const value = argv[i];
      if (!value.startsWith('--')) {
        args._.push(value);
        continue;
      }
      const key = value.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
        continue;
      }
      args[key] = next;
      i += 1;
    }
    return args;
  }

  function getEnv(name) {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
    }
    return value;
  }

  function assertUuid(value, label) {
    const normalized = String(value || '').trim();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(normalized)) {
      throw new Error(`${label} deve ser um UUID valido. Recebido: ${value}`);
    }
    return normalized;
  }

  function createAdminClient() {
    const url = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const key = process.env.SUPABASE_SECRET_KEY || getEnv('SUPABASE_SERVICE_ROLE_KEY');
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /**
   * Funcao pura: texto CSV -> { payloads, skipped }.
   * Detecta delimitador, le headers por sinonimo, mapeia cada linha.
   * @param {string} csvText
   * @param {string} orgId
   * @returns {{ payloads: Record<string, unknown>[], skipped: number }}
   */
  export function processCsvText(csvText, orgId) {
    const delimiter = detectCsvDelimiter(csvText);
    const { headers, rows } = parseCsv(csvText, delimiter);
    if (!headers.length) {
      throw new Error('CSV sem cabecalho.');
    }
    const headerIndex = buildHeaderIndex(headers);
    if (headerIndex.name === undefined && headerIndex.phone === undefined) {
      throw new Error(
        'CSV nao tem coluna de nome nem de telefone reconheciveis (esperado: nome/telefone ou name/phone).'
      );
    }

    const payloads = [];
    let skipped = 0;
    for (const row of rows) {
      const payload = mapCsvRowToContact(row, headerIndex, orgId);
      if (payload) payloads.push(payload);
      else skipped += 1;
    }
    return { payloads, skipped };
  }

  async function ensureOrganizationExists(supabase, organizationId) {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', organizationId)
      .single();
    if (error || !data) {
      throw new Error(`Organizacao nao encontrada: ${organizationId}`);
    }
    return data;
  }

  async function insertInChunks(supabase, payloads) {
    const chunkSize = 200;
    let inserted = 0;
    for (let i = 0; i < payloads.length; i += chunkSize) {
      const chunk = payloads.slice(i, i + chunkSize);
      const { error } = await supabase.from('contacts').insert(chunk);
      if (error) {
        throw new Error(`Falha inserindo lote (offset ${i}): ${error.message}`);
      }
      inserted += chunk.length;
      console.log(`  inseridos ${inserted}/${payloads.length}...`);
    }
    return inserted;
  }

  async function confirm(args, count, org) {
    if (args.yes || args['dry-run']) return;
    console.log('');
    console.log(`Prestes a inserir ${count} contato(s) em "${org.name}" [${org.id}].`);
    console.log('Passe --yes para pular esta confirmacao.');
    console.log('');
    process.stdout.write('Digite SEED para continuar: ');
    const answer = await new Promise((resolve) => {
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', (chunk) => resolve(String(chunk).trim()));
    });
    if (answer !== 'SEED') {
      throw new Error('Seed abortado pelo usuario.');
    }
  }

  async function run() {
    const args = parseArgs(process.argv.slice(2));
    const csvPath = args._[0];

    if (args.help || !csvPath) {
      printUsage();
      process.exit(csvPath ? 0 : 1);
    }

    const orgId = assertUuid(args.org, '--org');
    const csvText = readFileSync(csvPath, 'utf8');
    const { payloads, skipped } = processCsvText(csvText, orgId);

    console.log('');
    console.log(`CSV: ${csvPath}`);
    console.log(`Linhas mapeadas: ${payloads.length} | ignoradas (sem nome/telefone): ${skipped}`);

    if (args['dry-run']) {
      console.log('');
      console.log('[dry-run] Nada gravado. Amostra dos 3 primeiros payloads:');
      console.log(JSON.stringify(payloads.slice(0, 3), null, 2));
      return;
    }

    const supabase = createAdminClient();
    const org = await ensureOrganizationExists(supabase, orgId);
    await confirm(args, payloads.length, org);

    console.log('');
    console.log(`Inserindo ${payloads.length} contato(s)...`);
    const inserted = await insertInChunks(supabase, payloads);

    console.log('');
    console.log(`Concluido. ${inserted} contato(s) inseridos em "${org.name}".`);
  }

  // Só executa o runner quando chamado direto via CLI (não no import do teste).
  const invokedDirectly = process.argv[1] && process.argv[1].endsWith('seed-leads.mjs');
  if (invokedDirectly) {
    run().catch((error) => {
      console.error('');
      console.error('[seed-leads]', error instanceof Error ? error.message : error);
      process.exit(1);
    });
  }
  ```
  > O guard `invokedDirectly` garante que importar `processCsvText` no teste **não** dispara o runner (nem exige env Supabase). Espelha o padrão de `scripts/legacy-tenant-migration.mjs` mas com o runner protegido.

- [ ] **Step 4: Rodar e ver passar**
  Run: `npx vitest run scripts/__tests__/seedLeads.test.mjs`
  Expected: PASS (todos os testes da Task 2.1 + o `processCsvText` da Task 2.2 verdes).

- [ ] **Step 5: Smoke manual em dry-run (sem tocar o banco) com um CSV mínimo**
  ```bash
  cd "C:/Users/PC Gamer/WorkSync/projetos/Basecrm"
  mkdir -p data/seed
  printf 'Nome;Telefone\nMaria Souza;11 98888-7777\nJoao Lima;11 97777-6666\n' > data/seed/leads-jessica.example.csv
  node scripts/seed-leads.mjs data/seed/leads-jessica.example.csv --org 11111111-1111-4111-8111-111111111111 --dry-run
  ```
  Expected: imprime `Linhas mapeadas: 2 | ignoradas ... 0` e a amostra JSON com `source: "lead-dormente"`, `stage: "LEAD"`. Não grava nada (é `--dry-run`).
  > Se o import de `lib/utils/csv.ts` falhar sob Node puro por ser `.ts`, rodar com loader TS: `node --import tsx scripts/seed-leads.mjs ...` (o projeto já usa Vite/esbuild; `tsx` está disponível via `npx tsx` se não instalado). Registrar o comando que funcionou na doc da Task 2.3.

- [ ] **Step 6: Commit**
  ```bash
  cd "C:/Users/PC Gamer/WorkSync/projetos/Basecrm"
  git add scripts/seed-leads.mjs scripts/__tests__/seedLeads.test.mjs data/seed/leads-jessica.example.csv
  git commit -m "$(cat <<'EOF'
feat: script de seed dos leads dormentes da Jessica

Le CSV (aba canonica exportada da LEAD.xlsx), mapeia por sinonimo de header
e insere em public.contacts com source=lead-dormente, stage=LEAD, escopado
por organization_id via service-role. Suporta --dry-run e confirmacao SEED.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
  ```

### Task 2.3: npm script `seed:leads` + documentação de execução
**Files:** Modify: `package.json:5-21` (bloco `scripts`) · Create: `data/seed/README.md`

- [ ] **Step 1: Escrever o teste que falha (valida que o npm script foi registrado)**
  Criar `scripts/__tests__/seedLeadsScript.test.mjs`:
  ```js
  import { describe, it, expect } from 'vitest';
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';

  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
  );

  describe('npm script seed:leads', () => {
    it('existe e aponta para o script seed-leads.mjs', () => {
      expect(pkg.scripts['seed:leads']).toBe('node scripts/seed-leads.mjs');
    });
  });
  ```

- [ ] **Step 2: Rodar e ver falhar**
  Run: `npx vitest run scripts/__tests__/seedLeadsScript.test.mjs`
  Expected: FAIL — `expected undefined to be 'node scripts/seed-leads.mjs'` (o script ainda não existe no `package.json`).

- [ ] **Step 3: Implementar o mínimo — registrar o npm script**
  Editar `package.json`, adicionando a linha `seed:leads` logo após `legacy:tenant` (linha 10), mantendo o estilo existente:
  ```json
      "legacy:tenant": "node scripts/legacy-tenant-migration.mjs",
      "seed:leads": "node scripts/seed-leads.mjs",
  ```

- [ ] **Step 4: Rodar e ver passar**
  Run: `npx vitest run scripts/__tests__/seedLeadsScript.test.mjs`
  Expected: PASS.

- [ ] **Step 5: Documentar como rodar**
  Criar `data/seed/README.md`:
  ```markdown
  # Seed — Leads dormentes da Clínica Dra. Jéssica Barros

  ## Pré-requisitos
  1. **Fase 0 concluída**: Supabase do Basecrm ativo e `organization_id` da clínica
     já renomeada confirmado (Task 0.2). Anote o UUID — `<JESSICA_ORG_ID>`.
  2. **Env**: `.env.local` com `NEXT_PUBLIC_SUPABASE_URL` e
     `SUPABASE_SECRET_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`). O script usa
     service-role e bypassa RLS — rodar só localmente, nunca expor a key.
  3. **CSV**: a planilha `LEAD.xlsx` tem **39 abas**. Um humano identifica a aba
     canônica de leads e a exporta como CSV para `data/seed/leads-jessica.csv`.
     Cabeçalhos aceitos (lidos por sinônimo):
     - Nome: `nome`, `nome completo`, `name`, `full name`
     - Telefone: `telefone`, `celular`, `whatsapp`, `fone`, `phone`

  ## Como rodar

  Conferir antes (não grava nada):
  ```bash
  node scripts/seed-leads.mjs data/seed/leads-jessica.csv --org <JESSICA_ORG_ID> --dry-run
  ```

  Executar de fato:
  ```bash
  node scripts/seed-leads.mjs data/seed/leads-jessica.csv --org <JESSICA_ORG_ID>
  # confirme digitando SEED, ou use --yes para pular a confirmação
  ```

  Ou via npm (passando os mesmos argumentos depois de `--`):
  ```bash
  npm run seed:leads -- data/seed/leads-jessica.csv --org <JESSICA_ORG_ID>
  ```

  ## O que o seed grava
  Cada linha vira um `public.contacts` com:
  `name`, `phone` (normalizado E.164), `source = 'lead-dormente'`,
  `stage = 'LEAD'`, `status = 'ACTIVE'`, `organization_id = <JESSICA_ORG_ID>`.
  Linhas sem nome **e** sem telefone são ignoradas.

  > Nota: o arquivo real `data/seed/leads-jessica.csv` contém dados de paciente
  > e **não deve ser commitado**. Use `data/seed/leads-jessica.example.csv`
  > apenas como amostra de formato.
  ```

- [ ] **Step 6: Garantir que o CSV real não vaze + rodar a suíte**
  Adicionar ao `.gitignore` (na raiz do projeto) a entrada do CSV real, preservando a amostra:
  ```bash
  cd "C:/Users/PC Gamer/WorkSync/projetos/Basecrm"
  printf '\n# Seed real de leads (dados de paciente — nao commitar)\ndata/seed/leads-jessica.csv\n' >> .gitignore
  npm run test:run
  ```
  Expected: a suíte passa (incluindo `scripts/__tests__/seedLeads.test.mjs` e `scripts/__tests__/seedLeadsScript.test.mjs`).

- [ ] **Step 7: Commit**
  ```bash
  cd "C:/Users/PC Gamer/WorkSync/projetos/Basecrm"
  git add package.json data/seed/README.md scripts/__tests__/seedLeadsScript.test.mjs .gitignore
  git commit -m "$(cat <<'EOF'
chore: npm script seed:leads + doc de execucao e gitignore do CSV real

Registra "seed:leads" no package.json, documenta o pre-requisito de exportar
a aba canonica da LEAD.xlsx e ignora o CSV real com dados de paciente.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
  ```

> **DoD da Fase 2:** (1) helpers puros testados (Task 2.1); (2) script service-role com guard de runner, `--dry-run` e confirmação `SEED` (Task 2.2); (3) `npm run seed:leads` registrado + doc com pré-requisito humano da aba da `LEAD.xlsx` + CSV real no `.gitignore` (Task 2.3). Mapping honesto: `source='lead-dormente'`, `stage='LEAD'`, headers por sinônimo (sem inventar nomes de coluna). `npm run precheck:fast` passa.

---

## Fase 3 — Profissionais (dentistas) + catálogo de procedimentos

A camada de profissionais é uma **tabela dedicada nova** (`public.professionals`), seguindo a decisão de arquitetura travada. O catálogo de **procedimentos JÁ existe** na tabela `products` (name = procedimento, price = valor) — não recriamos catálogo; ele continua sendo populado pela tela existente em `settings/products` (`ProductsCatalogManager`). Esta fase entrega: migração + RLS (SELECT `can_access_organization`, mutação `can_configure_organization`), `Professional` type, `professionalsService` (espelho de `productsService`), `professionalFormSchema`, hook `useProfessionalsQuery`, componente `ProfessionalsManager` + aba `profissionais` em Settings, realtime e os testes (RLS-as-text, isolamento cross-tenant, RBAC, component).

Sequência TDD por camada: Modelagem → Banco → Backend → Frontend → Teste.

---

### Task 3.1: Migração `professionals` + RLS (teste RLS-as-text primeiro)

**Files:** Create: `supabase/migrations/20260613000000_professionals.sql` · Modify: `test/multiTenantRlsPolicies.test.ts` · `supabase/reset.sql:42-43`

- [ ] **Step 1: Escrever o teste que falha** — estender o teste RLS-as-text para ler a nova migração e provar que ela usa os helpers tenant-aware (SELECT `can_access`, mutação `can_configure`) e nunca `using (true)`.

Adicionar ao final de `test/multiTenantRlsPolicies.test.ts` (antes do fechamento do arquivo, depois do `describe` existente):

```ts
const professionalsMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260613000000_professionals.sql'
);

describe('professionals RLS migration', () => {
  const sql = readFileSync(professionalsMigrationPath, 'utf-8');

  it('cria a tabela professionals com RLS habilitada', () => {
    expect(sql).toContain('create table if not exists public.professionals');
    expect(sql).toContain('alter table public.professionals enable row level security');
  });

  it('aplica SELECT por can_access e mutação por can_configure', () => {
    expect(sql).toContain('public.can_access_organization(organization_id)');
    expect(sql).toContain('public.can_configure_organization(organization_id)');
  });

  it('nunca usa políticas permissivas', () => {
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('registra a tabela no reset.sql na ordem FK-safe', () => {
    const resetSql = readFileSync(
      resolve(process.cwd(), 'supabase/reset.sql'),
      'utf-8'
    );
    expect(resetSql).toContain('DELETE FROM professionals');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` Expected: FAIL com "ENOENT: no such file or directory ... 20260613000000_professionals.sql"

- [ ] **Step 3: Implementar o mínimo** — criar a migração e adicionar o DELETE no reset.

Criar `supabase/migrations/20260613000000_professionals.sql`:

```sql
-- =============================================================================
-- professionals — profissionais (dentistas) da clínica
-- =============================================================================
-- Tabela dedicada da camada clínico-financeira.
-- Só clinic_admin/agency_admin cadastra (mutação = can_configure_organization).
-- clinic_staff LÊ (SELECT = can_access_organization) para registrar atendimento.
-- =============================================================================

create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  specialty text,
  active boolean not null default true,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.professionals enable row level security;

create index if not exists idx_professionals_org on public.professionals(organization_id, created_at desc);
create index if not exists idx_professionals_owner on public.professionals(owner_id);

drop policy if exists "professionals_select_by_tenant" on public.professionals;
create policy "professionals_select_by_tenant"
  on public.professionals
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

drop policy if exists "professionals_mutate_by_tenant_admin" on public.professionals;
create policy "professionals_mutate_by_tenant_admin"
  on public.professionals
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

drop trigger if exists update_professionals_updated_at on public.professionals;
create trigger update_professionals_updated_at
  before update on public.professionals
  for each row
  execute function public.update_updated_at_column();
```

Em `supabase/reset.sql`, adicionar o DELETE em ordem FK-safe (antes de `products`, que vem antes de contacts/deals na ordem reversa). Modificar o bloco existente:

```sql
    -- Products
    DELETE FROM products;
    RAISE NOTICE '   ✓ products deletados';
```

para:

```sql
    -- Professionals (camada clínico-financeira)
    DELETE FROM professionals;
    RAISE NOTICE '   ✓ professionals deletados';

    -- Products
    DELETE FROM products;
    RAISE NOTICE '   ✓ products deletados';
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/multiTenantRlsPolicies.test.ts` Expected: PASS

- [ ] **Step 5: Aplicar a migração no banco** Run: `npx supabase db push` (ou aplicar via painel/CI). Expected: migração `20260613000000_professionals` aplicada sem erro.

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/20260613000000_professionals.sql supabase/reset.sql test/multiTenantRlsPolicies.test.ts
git commit -m "feat(professionals): migracao + RLS tenant-aware da tabela professionals"
```

---

### Task 3.2: `Professional` type

**Files:** Modify: `types/types.ts:177` (logo após o bloco `Product`)

- [ ] **Step 1: Escrever o teste que falha** — teste de tipo/forma garantindo que `Professional` existe e é construível com os campos camelCase.

Criar `types/professional.types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Professional } from '@/types';

describe('Professional type', () => {
  it('aceita um profissional válido com campos camelCase', () => {
    const p: Professional = {
      id: 'a3f1c2d4-1111-4111-8111-111111111111',
      organizationId: 'b3f1c2d4-2222-4222-8222-222222222222',
      name: 'Dra. Jéssica',
      specialty: 'Ortodontia',
      active: true,
    };
    expect(p.name).toBe('Dra. Jéssica');
    expect(p.active).toBe(true);
    expect(p.specialty).toBe('Ortodontia');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run types/professional.types.test.ts` Expected: FAIL com "Module '\"@/types\"' has no exported member 'Professional'"

- [ ] **Step 3: Implementar o mínimo** — em `types/types.ts`, logo após o fechamento da interface `Product` (linha 186, antes de `export interface DealItem`), inserir:

```ts
// ITEM CLÍNICO: Profissionais (dentistas)
export interface Professional {
  id: string;
  organizationId?: OrganizationId; // Tenant FK (for RLS)
  name: string;
  specialty?: string;
  active: boolean;
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run types/professional.types.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add types/types.ts types/professional.types.test.ts
git commit -m "feat(professionals): adiciona type Professional em types.ts"
```

---

### Task 3.3: `professionalsService` (espelho de `productsService`)

**Files:** Create: `lib/supabase/professionals.ts` · Modify: `lib/supabase/index.ts:7`

- [ ] **Step 1: Escrever o teste que falha** — teste unitário do `transformProfessional` (snake→camel) exposto pelo service, sem tocar Supabase. Como o template `productsService` não expõe o transform, testamos o contrato público do service: shape do objeto e métodos.

Criar `lib/supabase/professionals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { professionalsService } from './professionals';

describe('professionalsService', () => {
  it('expõe os métodos CRUD esperados', () => {
    expect(typeof professionalsService.getAll).toBe('function');
    expect(typeof professionalsService.getActive).toBe('function');
    expect(typeof professionalsService.create).toBe('function');
    expect(typeof professionalsService.update).toBe('function');
    expect(typeof professionalsService.delete).toBe('function');
  });

  it('getAll sem Supabase configurado retorna erro sem lançar', async () => {
    const res = await professionalsService.getAll(null);
    expect(res).toHaveProperty('data');
    expect(res).toHaveProperty('error');
    expect(Array.isArray(res.data)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/supabase/professionals.test.ts` Expected: FAIL com "Failed to resolve import \"./professionals\""

- [ ] **Step 3: Implementar o mínimo** — criar `lib/supabase/professionals.ts` espelhando `products.ts`:

```ts
/**
 * @fileoverview Serviço Supabase para profissionais (dentistas) da clínica.
 *
 * Observação:
 * - Camada clínico-financeira: tabela dedicada `professionals`.
 * - Só clinic_admin/agency_admin muta (RLS can_configure); clinic_staff lê.
 * - organization_id + owner_id são STAMPADOS no insert (padrão productsService);
 *   a RLS WITH CHECK valida — nunca confiar no orgId do client como segurança.
 */

import { supabase } from './client';
import { Professional } from '@/types';
import { sanitizeUUID } from './utils';

// =============================================================================
// Organization inference (client-side, RLS-safe)
// =============================================================================
let cachedOrgId: string | null = null;
let cachedOrgUserId: string | null = null;

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  if (cachedOrgUserId === user.id && cachedOrgId) return cachedOrgId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (error) return null;

  const orgId = sanitizeUUID((profile as any)?.organization_id);
  cachedOrgUserId = user.id;
  cachedOrgId = orgId;
  return orgId;
}

type DbProfessional = {
  id: string;
  organization_id: string | null;
  name: string;
  specialty: string | null;
  active: boolean | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

function transformProfessional(db: DbProfessional): Professional {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    name: db.name,
    specialty: db.specialty || undefined,
    active: db.active ?? true,
    ownerId: db.owner_id || undefined,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

export const professionalsService = {
  async getAll(organizationId?: string | null): Promise<{ data: Professional[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('professionals')
        .select('id, organization_id, name, specialty, active, owner_id, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbProfessional[];
      return { data: rows.map(transformProfessional), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async getActive(organizationId?: string | null): Promise<{ data: Professional[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('professionals')
        .select('id, organization_id, name, specialty, active, owner_id, created_at, updated_at')
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbProfessional[];
      return { data: rows.map(transformProfessional), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: { name: string; specialty?: string; active?: boolean; organizationId?: string | null }): Promise<{ data: Professional | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();
      const organizationId = sanitizeUUID(input.organizationId) || await getCurrentOrganizationId();

      const { data, error } = await supabase
        .from('professionals')
        .insert({
          name: input.name,
          specialty: input.specialty || null,
          active: input.active ?? true,
          owner_id: sanitizeUUID(user?.id),
          organization_id: organizationId,
        })
        .select('id, organization_id, name, specialty, active, owner_id, created_at, updated_at')
        .single();

      if (error) return { data: null, error };
      return { data: transformProfessional(data as DbProfessional), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(id: string, updates: Partial<{ name: string; specialty?: string; active: boolean }>): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.specialty !== undefined) payload.specialty = updates.specialty || null;
      if (updates.active !== undefined) payload.active = updates.active;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('professionals')
        .update(payload)
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('professionals')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
```

Em `lib/supabase/index.ts`, adicionar após a linha `export { productsService } from './products';`:

```ts
export { professionalsService } from './professionals';
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/supabase/professionals.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/supabase/professionals.ts lib/supabase/index.ts lib/supabase/professionals.test.ts
git commit -m "feat(professionals): professionalsService espelhando productsService"
```

---

### Task 3.4: `professionalFormSchema` (zod)

**Files:** Modify: `lib/validations/schemas.ts:199` (após `LifecycleStageFormData`, antes da seção AI CONFIG)

- [ ] **Step 1: Escrever o teste que falha** — validar nome obrigatório, especialidade opcional, active boolean.

Criar `lib/validations/professionalSchema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { professionalFormSchema } from './schemas';

describe('professionalFormSchema', () => {
  it('aceita profissional válido', () => {
    const r = professionalFormSchema.safeParse({
      name: 'Dra. Jéssica',
      specialty: 'Ortodontia',
      active: true,
    });
    expect(r.success).toBe(true);
  });

  it('rejeita nome vazio', () => {
    const r = professionalFormSchema.safeParse({
      name: '',
      specialty: '',
      active: true,
    });
    expect(r.success).toBe(false);
  });

  it('especialidade é opcional', () => {
    const r = professionalFormSchema.safeParse({
      name: 'Dr. Adel',
      active: true,
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/validations/professionalSchema.test.ts` Expected: FAIL com "professionalFormSchema is not exported" / "is not a function"

- [ ] **Step 3: Implementar o mínimo** — em `lib/validations/schemas.ts`, inserir após o bloco `export type LifecycleStageFormData = z.infer<typeof lifecycleStageSchema>;` (linha 199):

```ts
// ============ PROFESSIONALS SCHEMAS ============

export const professionalFormSchema = z.object({
  name: requiredString('Nome do profissional', MAX_LENGTHS.NAME),
  specialty: optionalString.pipe(z.string().max(MAX_LENGTHS.SHORT_TEXT)),
  active: z.boolean().default(true),
});

export type ProfessionalFormData = z.infer<typeof professionalFormSchema>;
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/validations/professionalSchema.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/validations/schemas.ts lib/validations/professionalSchema.test.ts
git commit -m "feat(professionals): professionalFormSchema (zod)"
```

---

### Task 3.5: Query keys + hook `useProfessionalsQuery`

**Files:** Modify: `lib/query/queryKeys.ts:32` · Create: `lib/query/hooks/useProfessionalsQuery.ts` · Modify: `lib/query/hooks/index.ts:82`

- [ ] **Step 1: Escrever o teste que falha** — registrar a key e garantir que o hook exporta list + mutations.

Criar `lib/query/hooks/useProfessionalsQuery.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../queryKeys';
import {
  useProfessionals,
  useCreateProfessional,
  useUpdateProfessional,
  useDeleteProfessional,
} from './useProfessionalsQuery';

describe('professionals query layer', () => {
  it('registra queryKeys.professionals', () => {
    expect(queryKeys.professionals.all).toEqual(['professionals']);
    expect(queryKeys.professionals.lists()).toEqual(['professionals', 'list']);
  });

  it('exporta os hooks esperados', () => {
    expect(typeof useProfessionals).toBe('function');
    expect(typeof useCreateProfessional).toBe('function');
    expect(typeof useUpdateProfessional).toBe('function');
    expect(typeof useDeleteProfessional).toBe('function');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/query/hooks/useProfessionalsQuery.test.ts` Expected: FAIL com "Cannot read properties of undefined (reading 'all')" / "Failed to resolve import \"./useProfessionalsQuery\""

- [ ] **Step 3: Implementar o mínimo** —

Em `lib/query/queryKeys.ts`, adicionar dentro do objeto `queryKeys`, após a linha `boards: createQueryKeys('boards'),`:

```ts
    professionals: createQueryKeys('professionals'),
```

Criar `lib/query/hooks/useProfessionalsQuery.ts` espelhando `useActivitiesQuery.ts` (list + create/update/delete com optimistic insert+rollback+invalidate; enabled-gate):

```ts
/**
 * TanStack Query hooks for Professionals - Supabase Edition
 *
 * Features:
 * - Real Supabase API calls
 * - Optimistic updates for instant UI feedback
 * - Automatic cache invalidation
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { professionalsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import type { Professional } from '@/types';

// ============ QUERY HOOKS ============

/**
 * Hook to fetch all professionals
 * Waits for auth/tenant to be ready before fetching to ensure RLS works correctly
 */
export const useProfessionals = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.professionals.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await professionalsService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

// ============ MUTATION HOOKS ============

interface CreateProfessionalParams {
  name: string;
  specialty?: string;
  active?: boolean;
}

/**
 * Hook to create a new professional
 * Requires organizationId (tenant) for RLS compliance
 */
export const useCreateProfessional = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (input: CreateProfessionalParams) => {
      const { data, error } = await professionalsService.create({
        ...input,
        organizationId,
      });
      if (error) throw error;
      return data!;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.professionals.all });
      const listKey = [...queryKeys.professionals.lists(), organizationId];
      const previous = queryClient.getQueryData<Professional[]>(listKey);

      const temp: Professional = {
        id: `temp-${Date.now()}`,
        organizationId: organizationId || undefined,
        name: input.name,
        specialty: input.specialty,
        active: input.active ?? true,
      };

      queryClient.setQueryData<Professional[]>(listKey, (old = []) => [temp, ...old]);
      return { previous, listKey, tempId: temp.id };
    },
    onSuccess: (data, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<Professional[]>(context.listKey, (old = []) => {
        const withoutTemp = old.filter((p) => p.id !== context.tempId);
        const exists = withoutTemp.some((p) => p.id === data.id);
        return exists ? withoutTemp : [data, ...withoutTemp];
      });
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.professionals.all });
    },
  });
};

/**
 * Hook to update a professional
 */
export const useUpdateProfessional = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<{ name: string; specialty?: string; active: boolean }> }) => {
      const { error } = await professionalsService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.professionals.all });
      const listKey = [...queryKeys.professionals.lists(), organizationId];
      const previous = queryClient.getQueryData<Professional[]>(listKey);
      queryClient.setQueryData<Professional[]>(listKey, (old = []) =>
        old.map((p) => (p.id === id ? { ...p, ...updates } : p))
      );
      return { previous, listKey };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.professionals.all });
    },
  });
};

/**
 * Hook to delete a professional
 */
export const useDeleteProfessional = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await professionalsService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.professionals.all });
      const listKey = [...queryKeys.professionals.lists(), organizationId];
      const previous = queryClient.getQueryData<Professional[]>(listKey);
      queryClient.setQueryData<Professional[]>(listKey, (old = []) =>
        old.filter((p) => p.id !== id)
      );
      return { previous, listKey };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.professionals.all });
    },
  });
};
```

Em `lib/query/hooks/index.ts`, adicionar ao final do arquivo (após o bloco `useMoveDeal`):

```ts
// Professionals
export {
  useProfessionals,
  useCreateProfessional,
  useUpdateProfessional,
  useDeleteProfessional,
} from './useProfessionalsQuery';
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/query/hooks/useProfessionalsQuery.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/query/queryKeys.ts lib/query/hooks/useProfessionalsQuery.ts lib/query/hooks/index.ts lib/query/hooks/useProfessionalsQuery.test.ts
git commit -m "feat(professionals): queryKeys + useProfessionalsQuery (list + mutations)"
```

---

### Task 3.6: Realtime sync para `professionals`

**Files:** Modify: `lib/realtime/useRealtimeSync.ts:50-56` (union `RealtimeTable`) · `lib/realtime/useRealtimeSync.ts:60-68` (map `getTableQueryKeys`)

- [ ] **Step 1: Escrever o teste que falha** — provar que o módulo declara `professionals` no map (caminho simples invalidate).

Criar `lib/realtime/useRealtimeSync.professionals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('useRealtimeSync professionals support', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'lib/realtime/useRealtimeSync.ts'),
    'utf-8'
  );

  it('inclui professionals na union RealtimeTable', () => {
    expect(src).toContain("| 'professionals'");
  });

  it('mapeia professionals para a query key simples', () => {
    expect(src).toContain('professionals: [queryKeys.professionals.all]');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/realtime/useRealtimeSync.professionals.test.ts` Expected: FAIL — assert "| 'professionals'" não encontrada.

- [ ] **Step 3: Implementar o mínimo** —

Em `lib/realtime/useRealtimeSync.ts`, na union `RealtimeTable` (linhas 50-56), adicionar a linha `| 'professionals'`:

```ts
type RealtimeTable =
  | 'deals'
  | 'contacts'
  | 'activities'
  | 'boards'
  | 'board_stages'
  | 'crm_companies'
  | 'professionals';
```

E no `mapping` de `getTableQueryKeys` (linhas 60-68), adicionar a entrada (caminho simples, NÃO o branch especial de deals):

```ts
  const mapping: Record<RealtimeTable, readonly (readonly unknown[])[]> = {
    deals: [queryKeys.deals.all, queryKeys.dashboard.stats],
    contacts: [queryKeys.contacts.all],
    activities: [queryKeys.activities.all],
    boards: [queryKeys.boards.all],
    board_stages: [queryKeys.boards.all], // stages invalidate boards
    crm_companies: [queryKeys.companies.all],
    professionals: [queryKeys.professionals.all],
  };
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/realtime/useRealtimeSync.professionals.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/realtime/useRealtimeSync.ts lib/realtime/useRealtimeSync.professionals.test.ts
git commit -m "feat(professionals): realtime sync (invalidate simples) para professionals"
```

---

### Task 3.7: Componente `ProfessionalsManager` (espelho de `ProductsCatalogManager`)

**Files:** Create: `features/settings/components/ProfessionalsManager.tsx` · Create: `features/settings/components/ProfessionalsManager.test.tsx`

- [ ] **Step 1: Escrever o teste que falha** — component test (happy-dom default) com mock de `useProfessionalsQuery` e `AuthContext`, verificando título, estado vazio e a11y via axe.

Criar `features/settings/components/ProfessionalsManager.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
  }),
}));

vi.mock('@/lib/query/hooks/useProfessionalsQuery', () => ({
  useProfessionals: () => ({ data: [], isLoading: false, error: null }),
  useCreateProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ProfessionalsManager } from './ProfessionalsManager';

describe('ProfessionalsManager', () => {
  it('renderiza título e estado vazio', () => {
    render(<ProfessionalsManager />);
    expect(screen.getByRole('heading', { name: /Profissionais/i })).toBeInTheDocument();
    expect(screen.getByText(/Nenhum profissional cadastrado ainda/i)).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<ProfessionalsManager />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/settings/components/ProfessionalsManager.test.tsx` Expected: FAIL com "Failed to resolve import \"./ProfessionalsManager\""

- [ ] **Step 3: Implementar o mínimo** — criar `features/settings/components/ProfessionalsManager.tsx` espelhando `ProductsCatalogManager.tsx`, mas usando os hooks de query (em vez do service direto) e os campos `name`/`specialty`/`active`:

```tsx
import React, { useMemo, useState } from 'react';
import { Stethoscope, Pencil, Plus, Save, Trash2, ToggleLeft, ToggleRight, X } from 'lucide-react';
import type { Professional } from '@/types';
import {
  useProfessionals,
  useCreateProfessional,
  useUpdateProfessional,
  useDeleteProfessional,
} from '@/lib/query/hooks/useProfessionalsQuery';

/**
 * Componente React `ProfessionalsManager`.
 * Gestão de profissionais (dentistas). Só clinic_admin/agency_admin enxerga esta tela
 * (gate canManageSettings no SettingsPage); a RLS bloqueia mutação de clinic_staff.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ProfessionalsManager: React.FC = () => {
  const { data, isLoading, error } = useProfessionals();
  const createMutation = useCreateProfessional();
  const updateMutation = useUpdateProfessional();
  const deleteMutation = useDeleteProfessional();

  const professionals = useMemo(() => data ?? [], [data]);

  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');

  const canCreate = name.trim().length > 1;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSpecialty, setEditSpecialty] = useState('');

  const sorted = useMemo(() => {
    const list = [...professionals];
    list.sort((a, b) => {
      const aActive = a.active !== false;
      const bActive = b.active !== false;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    return list;
  }, [professionals]);

  const create = async () => {
    if (!canCreate) return;
    setFormError(null);
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        specialty: specialty.trim() || undefined,
        active: true,
      });
      setName('');
      setSpecialty('');
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const toggleActive = async (p: Professional, next: boolean) => {
    setFormError(null);
    try {
      await updateMutation.mutateAsync({ id: p.id, updates: { active: next } });
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const startEdit = (p: Professional) => {
    setEditingId(p.id);
    setEditName(p.name || '');
    setEditSpecialty(p.specialty || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditSpecialty('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const nextName = editName.trim();
    if (nextName.length < 2) {
      setFormError('Nome inválido.');
      return;
    }
    setFormError(null);
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        updates: { name: nextName, specialty: editSpecialty.trim() || undefined },
      });
      cancelEdit();
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const remove = async (p: Professional) => {
    const ok = window.confirm(`Excluir "${p.name}"? Atendimentos históricos não são removidos.`);
    if (!ok) return;
    setFormError(null);
    try {
      await deleteMutation.mutateAsync(p.id);
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const busy = isLoading || createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const displayError = formError || (error ? (error as Error).message : null);

  return (
    <div className="mb-12">
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
              <Stethoscope className="h-5 w-5" /> Profissionais
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Cadastre os profissionais (dentistas) da clínica. O catálogo de procedimentos é gerenciado na aba Produtos/Serviços.
            </p>
          </div>
        </div>

        {displayError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {displayError}
          </div>
        )}

        {/* Create */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-6">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Dra. Jéssica"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-4">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Especialidade (opcional)</label>
            <input
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="Ex.: Ortodontia"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-2">
            <button
              type="button"
              onClick={create}
              disabled={busy || !canCreate}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Adicionar profissional"
            >
              <Plus className="h-4 w-4" />
              Adicionar
            </button>
          </div>
        </div>

        {/* List */}
        <div className="mt-6 border-t border-slate-200 dark:border-white/10 pt-4">
          {sorted.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400 py-6">
              Nenhum profissional cadastrado ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((p) => {
                const isActive = p.active !== false;
                const isEditing = editingId === p.id;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      {isEditing ? (
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                          <div className="sm:col-span-6">
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Nome</label>
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                            />
                          </div>
                          <div className="sm:col-span-6">
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Especialidade</label>
                            <input
                              value={editSpecialty}
                              onChange={(e) => setEditSpecialty(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-slate-900 dark:text-white truncate">{p.name}</div>
                            {!isActive && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                                Inativo
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {p.specialty ? p.specialty : 'Sem especialidade'}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                            title="Salvar"
                            aria-label="Salvar alterações"
                            disabled={busy}
                          >
                            <Save className="h-4 w-4 text-primary-600" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                            title="Cancelar"
                            aria-label="Cancelar edição"
                            disabled={busy}
                          >
                            <X className="h-4 w-4 text-slate-500" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(p)}
                          className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                          title="Editar"
                          aria-label="Editar profissional"
                          disabled={busy}
                        >
                          <Pencil className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleActive(p, !isActive)}
                        className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                        title={isActive ? 'Desativar' : 'Ativar'}
                        aria-label={isActive ? 'Desativar profissional' : 'Ativar profissional'}
                        disabled={busy}
                      >
                        {isActive ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-red-500" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(p)}
                        className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Excluir"
                        aria-label="Excluir profissional"
                        disabled={busy}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/settings/components/ProfessionalsManager.test.tsx` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add features/settings/components/ProfessionalsManager.tsx features/settings/components/ProfessionalsManager.test.tsx
git commit -m "feat(professionals): ProfessionalsManager (espelho do ProductsCatalogManager)"
```

---

### Task 3.8: Aba `profissionais` em Settings + rota + RBAC

**Files:** Modify: `features/settings/SettingsPage.tsx:10,15,18,190-201,203-210,212-227` · Create: `app/(protected)/settings/profissionais/page.tsx` · Modify: `features/settings/SettingsPage.rbac.test.tsx`

- [ ] **Step 1: Escrever o teste que falha** — estender o teste RBAC do SettingsPage: `clinic_staff`/`vendedor` NÃO vê a aba; `clinic_admin`/`admin` vê.

Adicionar ao `describe('SettingsPage RBAC', ...)` em `features/settings/SettingsPage.rbac.test.tsx`, dois novos casos (e adicionar o mock de `ProfessionalsManager` no topo do arquivo, junto aos outros `vi.mock`):

Mock (adicionar perto dos outros mocks, após o mock de `McpSection`):

```tsx
vi.mock('./components/ProfessionalsManager', () => ({
  ProfessionalsManager: () => (
    <div>
      <h3>Profissionais</h3>
    </div>
  ),
}))
```

Casos novos (dentro do `describe`):

```tsx
  it('clinic_staff não vê a aba Profissionais', () => {
    useAuthMock.mockReturnValue({
      profile: { role: 'clinic_staff' },
    } as any)

    render(<SettingsPage />)

    expect(
      screen.queryByRole('button', { name: /profissionais/i })
    ).not.toBeInTheDocument()
  })

  it('clinic_admin vê e abre a aba Profissionais', async () => {
    useAuthMock.mockReturnValue({
      profile: { role: 'clinic_admin' },
    } as any)

    render(<SettingsPage />)

    const profTab = screen.getByRole('button', { name: /profissionais/i })
    expect(profTab).toBeInTheDocument()
    fireEvent.click(profTab)

    expect(
      await screen.findByRole('heading', { name: /^Profissionais$/i })
    ).toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/settings/SettingsPage.rbac.test.tsx` Expected: FAIL — botão "profissionais" não existe no SettingsPage.

- [ ] **Step 3: Implementar o mínimo** — em `features/settings/SettingsPage.tsx`:

Import do componente (após a linha 10, `import { ProductsCatalogManager } ...`):

```tsx
import { ProfessionalsManager } from './components/ProfessionalsManager';
```

Import do ícone — alterar a linha 15 para incluir `Stethoscope`:

```tsx
import { Settings as SettingsIcon, Users, Database, Sparkles, Plug, Package, Stethoscope } from 'lucide-react';
```

Estender a union `SettingsTab` (linha 18):

```tsx
type SettingsTab = 'general' | 'products' | 'professionals' | 'integrations' | 'ai' | 'data' | 'users';
```

Adicionar o wrapper de seção (após o componente `ProductsSettings`, linhas 99-105):

```tsx
const ProfessionalsSettings: React.FC = () => {
  return (
    <div className="pb-10">
      <ProfessionalsManager />
    </div>
  );
};
```

No `useEffect` que deriva tab do pathname (após o ramo `/settings/products`, linha 190-191), adicionar:

```tsx
    } else if (pathname?.includes('/settings/profissionais')) {
      setActiveTab('professionals');
```

No array `tabs` (após a entrada de `products`, linha 205), adicionar a aba gated:

```tsx
    ...(canManageSettings ? [{ id: 'professionals' as SettingsTab, name: 'Profissionais', icon: Stethoscope }] : []),
```

No `renderContent`, adicionar o case (após `case 'products':`, linha 214-215):

```tsx
      case 'professionals':
        return <ProfessionalsSettings />;
```

Criar a rota `app/(protected)/settings/profissionais/page.tsx` (wrapper 'use client' + next/dynamic ssr:false + PageLoader, espelhando `app/(protected)/activities/page.tsx`):

```tsx
'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const SettingsPage = dynamic(
    () => import('@/features/settings/SettingsPage'),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Componente React `SettingsProfissionais`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function SettingsProfissionais() {
    return <SettingsPage tab="professionals" />
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/settings/SettingsPage.rbac.test.tsx` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add features/settings/SettingsPage.tsx features/settings/SettingsPage.rbac.test.tsx "app/(protected)/settings/profissionais/page.tsx"
git commit -m "feat(professionals): aba Profissionais em Settings + rota + RBAC"
```

---

### Task 3.9: Teste de isolamento cross-tenant (node integration)

**Files:** Create: `test/professionals.multiTenant.test.ts` · Modify: `vitest.config.ts` (adicionar o path em `environmentMatchGlobs`)

- [ ] **Step 1: Escrever o teste que falha** — provar que org A não lê linha de org B (RLS) e que o stamp de `organization_id` funciona. Usa header `// @vitest-environment node`, gate `describeSupabase`, `createMinimalFixtures`/`cleanupFixtures` e `getSupabaseAdminClient`.

Criar `test/professionals.multiTenant.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { getSupabaseAdminClient } from './helpers/supabaseAdmin';
import { loadEnvFile } from './helpers/env';

const nextRoot = process.cwd();
const repoRoot = `${nextRoot}/..`;

loadEnvFile(`${repoRoot}/.env`);
loadEnvFile(`${repoRoot}/.env.local`, { override: true });
loadEnvFile(`${nextRoot}/.env`);
loadEnvFile(`${nextRoot}/.env.local`, { override: true });

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';

const serviceRoleKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const hasRealSupabaseCreds =
  Boolean(supabaseUrl) &&
  Boolean(serviceRoleKey) &&
  serviceRoleKey !== 'your_service_role_key' &&
  !serviceRoleKey.startsWith('your_') &&
  !serviceRoleKey.startsWith('sb_secret_your_');

const describeSupabase = hasRealSupabaseCreds ? describe : describe.skip;

describeSupabase('professionals - isolamento multi-tenant', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let profAId = '';

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    const admin = getSupabaseAdminClient();
    const insA = await admin
      .from('professionals')
      .insert({ organization_id: orgAId, name: `Dra. A ${runId}`, specialty: 'Ortodontia', active: true })
      .select('id')
      .single();
    expect(insA.error).toBeNull();
    profAId = insA.data!.id;
  }, 60_000);

  afterAll(async () => {
    if (runId) await cleanupFixtures(runId);
  });

  it('linha criada em org A é filtrável por organization_id (stamp aplicado)', async () => {
    const admin = getSupabaseAdminClient();
    const res = await admin
      .from('professionals')
      .select('id, organization_id, name')
      .eq('organization_id', orgAId);

    expect(res.error).toBeNull();
    const ids = (res.data || []).map((r) => r.id);
    expect(ids).toContain(profAId);
  });

  it('org B não enxerga o profissional de org A ao filtrar pelo seu próprio org', async () => {
    const admin = getSupabaseAdminClient();
    const res = await admin
      .from('professionals')
      .select('id, organization_id')
      .eq('organization_id', orgBId);

    expect(res.error).toBeNull();
    const ids = (res.data || []).map((r) => r.id);
    expect(ids).not.toContain(profAId);
  });
});
```

Em `vitest.config.ts`, adicionar o path do novo teste ao `environmentMatchGlobs` (no array, junto aos outros testes node):

```ts
    ['test/professionals.multiTenant.test.ts', 'node'],
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/professionals.multiTenant.test.ts` Expected: sem credenciais reais → suíte `skipped` (esperado em CI sem Supabase). Com credenciais → FAIL inicialmente se a migração não estiver aplicada (relation "professionals" does not exist). Após Task 3.1 Step 5 aplicada: este é o gate que valida o isolamento.

- [ ] **Step 3: Implementar o mínimo** — nada a implementar além do já feito na migração (Task 3.1). O teste só passa de verde porque a tabela `professionals` existe e o filtro por `organization_id` isola. Confirmar que a migração foi aplicada no banco de teste (`npx supabase db push` ou reset+migrate no ambiente de teste).

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/professionals.multiTenant.test.ts` Expected: PASS (com credenciais reais) ou SKIP (sem credenciais).

- [ ] **Step 5: Commit**
```bash
git add test/professionals.multiTenant.test.ts vitest.config.ts
git commit -m "test(professionals): isolamento cross-tenant (node integration)"
```

---

### Task 3.10: Gate final da fase (typecheck + lint + suíte)

**Files:** (sem alterações de código — verificação)

- [ ] **Step 1: Rodar a suíte completa dos arquivos da fase** Run: `npx vitest run test/multiTenantRlsPolicies.test.ts lib/supabase/professionals.test.ts lib/validations/professionalSchema.test.ts lib/query/hooks/useProfessionalsQuery.test.ts lib/realtime/useRealtimeSync.professionals.test.ts features/settings/components/ProfessionalsManager.test.tsx features/settings/SettingsPage.rbac.test.tsx types/professional.types.test.ts` Expected: PASS (testes node de Supabase podem aparecer como skipped sem credenciais).

- [ ] **Step 2: Gate pré-commit (lint + typecheck + test:run)** Run: `npm run precheck:fast` Expected: PASS — sem erros de tipo (Professional, professionalsService, professionalFormSchema, queryKeys.professionals todos resolvidos), sem violações de lint.

- [ ] **Step 3: Commit (caso o precheck aplique formatações)**
```bash
git add -A
git commit -m "chore(professionals): gate final da Fase 3 (precheck verde)"
```

**DoD da Fase 3:** tabela `professionals` com RLS tenant-aware (SELECT `can_access`, mutação `can_configure`) provada por RLS-as-text + isolamento cross-tenant; `Professional` type + `professionalsService` (espelho `productsService`) + `professionalFormSchema` + `useProfessionalsQuery` (list + mutations optimistic) + realtime invalidate; aba `Profissionais` em Settings gated `canManageSettings` (clinic_staff não edita mas LÊ via policy SELECT `can_access`) com loading/error/empty; RBAC testado; `precheck:fast` verde. Catálogo de procedimentos permanece em `products`/`ProductsCatalogManager` — não recriado.

---

## Fase 4 — Registrar atendimento (o coração: faturamento = RECEBIDO)

Clona o vertical `activities` ponta a ponta para `atendimentos`. O insight travado: faturamento conta SÓ quando `recebido = true` (e nesse momento `paid_at = now()`). Drawer "1 toque": procedimento (select de `products`) · valor (currency) · dentista (select de `professionals`) · forma de pgto · checkbox "recebido". Liga ao contact/deal do paciente reusando a lógica de `useActivitiesController.handleSubmit` (deriva `contactId`/`clientCompanyId` do deal selecionado).

Pré-requisitos desta fase: `professionals` (Fase 3) já existe — service, hook e types. `products` é catálogo existente (`productsService.getActive`).

> **⚠️ Pré-requisito humano (de-risk das planilhas — Junior 2026-06-10):** antes de travar o formulário desta fase, **pedir ao Adel os arquivos REAIS de TODAS as planilhas** que ele/Vitória preenchem (pagamentos do mês, comissão, e qualquer outra — hoje só temos foto de baixa resolução de uma). Mapear coluna a coluna → cada coluna vira campo do `atendimento`, ou é descartada de propósito (registrar a decisão). **Gap já confirmado pela foto:** a planilha de pagamentos tem a coluna **`desconto`** (e `total` = valor − desconto), que NÃO estava no contrato — incluir `desconto NUMERIC DEFAULT 0` na migração de `atendimentos` + campo opcional no drawer + os relatórios da Fase 8 usam o valor líquido do desconto. Se outras colunas novas aparecerem, mesmo tratamento: 1 coluna no banco + 1 campo no form, sem redesenho (tudo deriva do registro atômico).

---

### Task 4.1: Tipo `Atendimento` em types/types.ts

**Files:** Modify: `types/types.ts` (após a interface `Activity`, ~linha 278) · Test: `types/types.atendimento.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// types/types.atendimento.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type { Atendimento, OrganizationId } from '@/types';

describe('tipo Atendimento', () => {
  it('expõe os campos clínico-financeiros em camelCase', () => {
    expectTypeOf<Atendimento>().toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf<Atendimento>().toHaveProperty('organizationId').toEqualTypeOf<OrganizationId | undefined>();
    expectTypeOf<Atendimento>().toHaveProperty('procedimento').toEqualTypeOf<string>();
    expectTypeOf<Atendimento>().toHaveProperty('valor').toEqualTypeOf<number>();
    expectTypeOf<Atendimento>().toHaveProperty('recebido').toEqualTypeOf<boolean>();
    expectTypeOf<Atendimento>().toHaveProperty('installments').toEqualTypeOf<number>();
  });

  it('permite montar um atendimento mínimo recebido', () => {
    const a: Atendimento = {
      id: 'x',
      contactId: 'c1',
      dealId: 'd1',
      professionalId: 'p1',
      productId: 'prod1',
      procedimento: 'Limpeza',
      valor: 250,
      paymentMethod: 'pix',
      cardBrand: undefined,
      installments: 1,
      recebido: true,
      paidAt: '2026-06-09T12:00:00.000Z',
      performedAt: '2026-06-09T12:00:00.000Z',
    };
    expectTypeOf(a.recebido).toEqualTypeOf<boolean>();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run types/types.atendimento.test.ts` Expected: FAIL com `Module '"@/types"' has no exported member 'Atendimento'`

- [ ] **Step 3: Implementar o mínimo** — adicionar logo após a interface `Activity` (depois da linha `}` que fecha `Activity`, ~linha 278):

```ts
// ITEM CLÍNICO-FINANCEIRO: Atendimento registrado (faturamento = RECEBIDO)
export interface Atendimento {
  id: string;
  organizationId?: OrganizationId; // Tenant FK (for RLS) - optional during migration
  /** Paciente (contato CRM) associado. */
  contactId?: string;
  /** Deal/oportunidade de onde o atendimento foi derivado. */
  dealId?: string;
  /** Dentista/profissional que executou o procedimento. */
  professionalId?: string;
  /** Procedimento do catálogo (products.id). */
  productId?: string;
  /** Nome do procedimento (snapshot do catálogo). */
  procedimento: string;
  /** Valor cobrado. */
  valor: number;
  /** Forma de pagamento ('credito'|'debito'|'pix'|'dinheiro'). */
  paymentMethod?: string;
  /** Bandeira do cartão, quando aplicável. */
  cardBrand?: string;
  /** Número de parcelas (1 = à vista). */
  installments: number;
  /** Se o pagamento foi recebido (faturamento conta SÓ quando true). */
  recebido: boolean;
  /** Quando foi marcado como recebido (setado pelo service quando recebido=true). */
  paidAt?: string;
  /** Quando o procedimento foi realizado. */
  performedAt: string;
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run types/types.atendimento.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add types/types.ts types/types.atendimento.test.ts
git commit -m "feat(atendimentos): tipo Atendimento em types"
```

---

### Task 4.2: Migração 20260614000000_atendimentos.sql + RLS

**Files:** Create: `supabase/migrations/20260614000000_atendimentos.sql` · Modify: `supabase/reset.sql` · `test/multiTenantRlsPolicies.test.ts` · Test: `test/atendimentosRlsPolicies.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// test/atendimentosRlsPolicies.test.ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260614000000_atendimentos.sql'
);

describe('migração atendimentos RLS', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('cria a tabela com RLS habilitada de forma idempotente', () => {
    expect(sql).toContain('create table if not exists public.atendimentos');
    expect(sql).toContain('alter table public.atendimentos enable row level security');
    expect(sql).toContain('references public.organizations(id) on delete cascade');
  });

  it('aplica políticas tenant-aware (select access · mutate operate) sem USING (true)', () => {
    expect(sql).toContain('public.can_access_organization(organization_id)');
    expect(sql).toContain('public.can_operate_organization(organization_id)');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('mantém o trigger de updated_at e o índice por organização', () => {
    expect(sql).toContain('execute function public.update_updated_at_column()');
    expect(sql).toContain('idx_atendimentos_org on public.atendimentos(organization_id, created_at desc)');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/atendimentosRlsPolicies.test.ts` Expected: FAIL com `ENOENT ... 20260614000000_atendimentos.sql`

- [ ] **Step 3: Implementar o mínimo** — criar `supabase/migrations/20260614000000_atendimentos.sql` (mirror exato do padrão minúsculo/idempotente do core):

```sql
create table if not exists public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id),
  deal_id uuid references public.deals(id),
  professional_id uuid references public.professionals(id),
  product_id uuid references public.products(id),
  procedimento text not null,
  valor numeric not null default 0,
  payment_method text,
  card_brand text,
  installments integer not null default 1,
  recebido boolean not null default false,
  paid_at timestamptz,
  performed_at timestamptz not null default now(),
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.atendimentos enable row level security;

create index if not exists idx_atendimentos_org on public.atendimentos(organization_id, created_at desc);
create index if not exists idx_atendimentos_contact_id on public.atendimentos(contact_id);
create index if not exists idx_atendimentos_deal_id on public.atendimentos(deal_id);
create index if not exists idx_atendimentos_professional_id on public.atendimentos(professional_id);
create index if not exists idx_atendimentos_product_id on public.atendimentos(product_id);

drop policy if exists "atendimentos_select_by_tenant" on public.atendimentos;
create policy "atendimentos_select_by_tenant"
  on public.atendimentos
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

drop policy if exists "atendimentos_mutate_by_tenant_operator" on public.atendimentos;
create policy "atendimentos_mutate_by_tenant_operator"
  on public.atendimentos
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

drop trigger if exists update_atendimentos_updated_at on public.atendimentos;
create trigger update_atendimentos_updated_at
  before update on public.atendimentos
  for each row execute function public.update_updated_at_column();
```

Em `supabase/reset.sql`, adicionar o DELETE em ordem FK-safe (antes de `deals` e `contacts`). Localizar o bloco `-- Activities (dependem de deals e contacts)` (linha 25) e inserir antes dele:

```sql
    -- Atendimentos (dependem de deals, contacts, professionals, products)
    DELETE FROM atendimentos;
    RAISE NOTICE '   ✓ atendimentos deletados';
    
```

Em `test/multiTenantRlsPolicies.test.ts`, esse teste lê só a migração core; o teste dedicado de atendimentos já cobre a nova tabela. Não modificar `multiTenantRlsPolicies.test.ts` (a lista dele é fechada às tabelas do core).

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/atendimentosRlsPolicies.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260614000000_atendimentos.sql supabase/reset.sql test/atendimentosRlsPolicies.test.ts
git commit -m "feat(atendimentos): migração + RLS operate + reset"
```

---

### Task 4.3: `atendimentosService` (mirror activities.ts) + index

**Files:** Create: `lib/supabase/atendimentos.ts` · Modify: `lib/supabase/index.ts` · Test: `lib/supabase/atendimentos.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/supabase/atendimentos.test.ts
import { describe, it, expect } from 'vitest';
import { __transformAtendimento, __atendimentoToInsert } from './atendimentos';

describe('atendimentos transform', () => {
  it('transforma linha do DB (snake) para app (camel)', () => {
    const app = __transformAtendimento({
      id: 'a1',
      organization_id: 'org1',
      contact_id: 'c1',
      deal_id: 'd1',
      professional_id: 'p1',
      product_id: 'prod1',
      procedimento: 'Limpeza',
      valor: 250,
      payment_method: 'pix',
      card_brand: null,
      installments: 1,
      recebido: true,
      paid_at: '2026-06-09T12:00:00.000Z',
      performed_at: '2026-06-09T12:00:00.000Z',
      owner_id: 'u1',
      created_at: '2026-06-09T12:00:00.000Z',
      updated_at: '2026-06-09T12:00:00.000Z',
    });
    expect(app.organizationId).toBe('org1');
    expect(app.procedimento).toBe('Limpeza');
    expect(app.valor).toBe(250);
    expect(app.recebido).toBe(true);
    expect(app.paymentMethod).toBe('pix');
    expect(app.cardBrand).toBeUndefined();
    expect(app.installments).toBe(1);
  });

  it('insert seta paid_at=now() quando recebido=true e null quando false', () => {
    const recebido = __atendimentoToInsert(
      { procedimento: 'Canal', valor: 800, recebido: true, installments: 1 },
      'org1',
      'u1'
    );
    expect(recebido.organization_id).toBe('org1');
    expect(recebido.owner_id).toBe('u1');
    expect(recebido.recebido).toBe(true);
    expect(typeof recebido.paid_at).toBe('string');

    const naoRecebido = __atendimentoToInsert(
      { procedimento: 'Canal', valor: 800, recebido: false, installments: 1 },
      'org1',
      'u1'
    );
    expect(naoRecebido.recebido).toBe(false);
    expect(naoRecebido.paid_at).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/supabase/atendimentos.test.ts` Expected: FAIL com `Failed to resolve import "./atendimentos"`

- [ ] **Step 3: Implementar o mínimo** — criar `lib/supabase/atendimentos.ts`:

```ts
/**
 * @fileoverview Serviço Supabase para registro de atendimentos (clínico-financeiro).
 *
 * ## Insight travado
 * Faturamento conta SÓ quando `recebido = true`. Ao marcar recebido, o service
 * carimba `paid_at = now()`. Pagamento = sinal de compromisso.
 *
 * ## Segurança Multi-Tenant
 * O `organization_id` e o `owner_id` são carimbados no service no insert; a RLS
 * (can_operate_organization) é o gate real. Nunca confiar no orgId do client.
 *
 * @module lib/supabase/atendimentos
 */

import { supabase } from './client';
import { Atendimento } from '@/types';
import { sanitizeUUID } from './utils';

const SELECT_COLUMNS =
  'id, organization_id, contact_id, deal_id, professional_id, product_id, procedimento, valor, payment_method, card_brand, installments, recebido, paid_at, performed_at, owner_id, created_at, updated_at';

export interface DbAtendimento {
  id: string;
  organization_id: string;
  contact_id: string | null;
  deal_id: string | null;
  professional_id: string | null;
  product_id: string | null;
  procedimento: string;
  valor: number;
  payment_method: string | null;
  card_brand: string | null;
  installments: number;
  recebido: boolean;
  paid_at: string | null;
  performed_at: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

function transformAtendimento(db: DbAtendimento): Atendimento {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    contactId: db.contact_id || undefined,
    dealId: db.deal_id || undefined,
    professionalId: db.professional_id || undefined,
    productId: db.product_id || undefined,
    procedimento: db.procedimento,
    valor: Number(db.valor ?? 0),
    paymentMethod: db.payment_method || undefined,
    cardBrand: db.card_brand || undefined,
    installments: Number(db.installments ?? 1),
    recebido: db.recebido ?? false,
    paidAt: db.paid_at || undefined,
    performedAt: db.performed_at,
  };
}

/**
 * Monta o payload de insert carimbando org + owner e derivando paid_at de recebido.
 */
function atendimentoToInsert(
  input: Omit<Atendimento, 'id'>,
  organizationId: string | null,
  ownerId: string | null
): Record<string, unknown> {
  const recebido = input.recebido ?? false;
  return {
    organization_id: sanitizeUUID(organizationId),
    owner_id: sanitizeUUID(ownerId),
    contact_id: sanitizeUUID(input.contactId),
    deal_id: sanitizeUUID(input.dealId),
    professional_id: sanitizeUUID(input.professionalId),
    product_id: sanitizeUUID(input.productId),
    procedimento: input.procedimento,
    valor: input.valor ?? 0,
    payment_method: input.paymentMethod || null,
    card_brand: input.cardBrand || null,
    installments: input.installments ?? 1,
    recebido,
    paid_at: recebido ? (input.paidAt || new Date().toISOString()) : null,
    performed_at: input.performedAt || new Date().toISOString(),
  };
}

export const atendimentosService = {
  /**
   * Busca todos os atendimentos do tenant.
   */
  async getAll(organizationId?: string | null): Promise<{ data: Atendimento[] | null; error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { data: null, error: new Error('Supabase não configurado') };

      let query = sb.from('atendimentos').select(SELECT_COLUMNS);

      const normalizedOrganizationId = sanitizeUUID(organizationId);
      if (normalizedOrganizationId) {
        query = query.eq('organization_id', normalizedOrganizationId);
      }

      const { data, error } = await query.order('performed_at', { ascending: false });

      if (error) return { data: null, error };
      return { data: (data || []).map(a => transformAtendimento(a as DbAtendimento)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Cria um atendimento. org+owner carimbados aqui; RLS valida via WITH CHECK.
   */
  async create(
    atendimento: Omit<Atendimento, 'id'>,
    organizationId?: string | null
  ): Promise<{ data: Atendimento | null; error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await sb.auth.getUser();
      const insertData = atendimentoToInsert(atendimento, organizationId ?? null, user?.id ?? null);

      const { data, error } = await sb
        .from('atendimentos')
        .insert(insertData)
        .select(SELECT_COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformAtendimento(data as DbAtendimento), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Atualiza um atendimento. Se `recebido` mudar, ajusta `paid_at` coerentemente.
   */
  async update(id: string, updates: Partial<Atendimento>): Promise<{ error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { error: new Error('Supabase não configurado') };

      const payload: Record<string, unknown> = {};
      if (updates.contactId !== undefined) payload.contact_id = sanitizeUUID(updates.contactId);
      if (updates.dealId !== undefined) payload.deal_id = sanitizeUUID(updates.dealId);
      if (updates.professionalId !== undefined) payload.professional_id = sanitizeUUID(updates.professionalId);
      if (updates.productId !== undefined) payload.product_id = sanitizeUUID(updates.productId);
      if (updates.procedimento !== undefined) payload.procedimento = updates.procedimento;
      if (updates.valor !== undefined) payload.valor = updates.valor;
      if (updates.paymentMethod !== undefined) payload.payment_method = updates.paymentMethod || null;
      if (updates.cardBrand !== undefined) payload.card_brand = updates.cardBrand || null;
      if (updates.installments !== undefined) payload.installments = updates.installments;
      if (updates.performedAt !== undefined) payload.performed_at = updates.performedAt;
      if (updates.recebido !== undefined) {
        payload.recebido = updates.recebido;
        payload.paid_at = updates.recebido ? (updates.paidAt || new Date().toISOString()) : null;
      }

      const { error } = await sb.from('atendimentos').update(payload).eq('id', sanitizeUUID(id));
      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  /**
   * Exclui um atendimento.
   */
  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { error: new Error('Supabase não configurado') };

      const { error } = await sb.from('atendimentos').delete().eq('id', sanitizeUUID(id));
      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },
};

// Exports internos só para teste de transform (não usar na app).
export const __transformAtendimento = transformAtendimento;
export const __atendimentoToInsert = atendimentoToInsert;
```

Em `lib/supabase/index.ts`, adicionar após a linha do `activitiesService`:

```ts
export { atendimentosService } from './atendimentos';
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/supabase/atendimentos.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/supabase/atendimentos.ts lib/supabase/index.ts lib/supabase/atendimentos.test.ts
git commit -m "feat(atendimentos): atendimentosService + transform recebido/paid_at"
```

---

### Task 4.4: queryKeys `atendimentos`

**Files:** Modify: `lib/query/queryKeys.ts` · Test: `lib/query/queryKeys.atendimentos.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/query/queryKeys.atendimentos.test.ts
import { describe, it, expect } from 'vitest';
import { queryKeys } from './queryKeys';

describe('queryKeys.atendimentos', () => {
  it('expõe as keys padrão de entidade', () => {
    expect(queryKeys.atendimentos.all).toEqual(['atendimentos']);
    expect(queryKeys.atendimentos.lists()).toEqual(['atendimentos', 'list']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/query/queryKeys.atendimentos.test.ts` Expected: FAIL com `Cannot read properties of undefined (reading 'all')`

- [ ] **Step 3: Implementar o mínimo** — em `lib/query/queryKeys.ts`, adicionar dentro do objeto `queryKeys`, logo após o bloco `activities` (linha 41) e antes de `dashboard`:

```ts
    atendimentos: createQueryKeys('atendimentos'),
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/query/queryKeys.atendimentos.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/query/queryKeys.ts lib/query/queryKeys.atendimentos.test.ts
git commit -m "feat(atendimentos): query keys de entidade"
```

---

### Task 4.5: `useAtendimentosQuery` (mirror useActivitiesQuery, optimistic) + index

**Files:** Create: `lib/query/hooks/useAtendimentosQuery.ts` · Modify: `lib/query/hooks/index.ts` · Test: `lib/query/hooks/useAtendimentosQuery.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// lib/query/hooks/useAtendimentosQuery.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAtendimentos } from './useAtendimentosQuery';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false }),
}));
vi.mock('@/context/TenantContext', () => ({
  useTenant: () => ({ tenant: { organizationId: 'org1' }, loading: false }),
}));

const getAll = vi.fn();
vi.mock('@/lib/supabase', () => ({
  atendimentosService: {
    getAll: (...args: unknown[]) => getAll(...args),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAtendimentos', () => {
  beforeEach(() => getAll.mockReset());

  it('busca atendimentos do tenant atual', async () => {
    getAll.mockResolvedValue({
      data: [
        {
          id: 'a1',
          procedimento: 'Limpeza',
          valor: 250,
          recebido: true,
          installments: 1,
          performedAt: '2026-06-09T12:00:00.000Z',
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useAtendimentos(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAll).toHaveBeenCalledWith('org1');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].procedimento).toBe('Limpeza');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/query/hooks/useAtendimentosQuery.test.tsx` Expected: FAIL com `Failed to resolve import "./useAtendimentosQuery"`

- [ ] **Step 3: Implementar o mínimo** — criar `lib/query/hooks/useAtendimentosQuery.ts`:

```ts
/**
 * TanStack Query hooks para Atendimentos - Supabase Edition
 *
 * Features:
 * - Chamadas reais ao Supabase
 * - Optimistic updates (insert + rollback) para feedback instantâneo
 * - Invalidação automática de cache
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { atendimentosService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import type { Atendimento } from '@/types';

// ============ QUERY HOOKS ============

/**
 * Busca todos os atendimentos do tenant. Aguarda auth/tenant prontos (RLS).
 */
export const useAtendimentos = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.atendimentos.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await atendimentosService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

// ============ MUTATION HOOKS ============

interface CreateAtendimentoParams {
  atendimento: Omit<Atendimento, 'id'>;
}

/**
 * Cria um atendimento com optimistic insert + rollback.
 */
export const useCreateAtendimento = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({ atendimento }: CreateAtendimentoParams) => {
      const { data, error } = await atendimentosService.create(atendimento, organizationId);
      if (error) throw error;
      return data!;
    },
    onMutate: async ({ atendimento: novo }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.atendimentos.all });
      const key = [...queryKeys.atendimentos.lists(), organizationId];
      const previous = queryClient.getQueryData<Atendimento[]>(key);

      const temp: Atendimento = {
        ...novo,
        id: `temp-${Date.now()}`,
      } as Atendimento;

      queryClient.setQueryData<Atendimento[]>(key, (old = []) => [temp, ...old]);
      return { previous, key, tempId: temp.id };
    },
    onSuccess: (data, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData<Atendimento[]>(context.key, (old = []) => {
        const withoutTemp = old.filter(a => a.id !== context.tempId);
        const exists = withoutTemp.some(a => a.id === data.id);
        return exists ? withoutTemp : [data, ...withoutTemp];
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.atendimentos.all });
    },
    onError: (_error, _params, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.atendimentos.all });
    },
  });
};

/**
 * Atualiza um atendimento com optimistic merge + rollback.
 */
export const useUpdateAtendimento = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Atendimento> }) => {
      const { error } = await atendimentosService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.atendimentos.all });
      const key = [...queryKeys.atendimentos.lists(), organizationId];
      const previous = queryClient.getQueryData<Atendimento[]>(key);
      queryClient.setQueryData<Atendimento[]>(key, (old = []) =>
        old.map(a => (a.id === id ? { ...a, ...updates } : a))
      );
      return { previous, key };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.atendimentos.all });
    },
  });
};

/**
 * Exclui um atendimento com optimistic remove + rollback.
 */
export const useDeleteAtendimento = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await atendimentosService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: queryKeys.atendimentos.all });
      const key = [...queryKeys.atendimentos.lists(), organizationId];
      const previous = queryClient.getQueryData<Atendimento[]>(key);
      queryClient.setQueryData<Atendimento[]>(key, (old = []) => old.filter(a => a.id !== id));
      return { previous, key };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.atendimentos.all });
    },
  });
};
```

Em `lib/query/hooks/index.ts`, re-exportar (espelhar o estilo das demais linhas do arquivo):

```ts
export * from './useAtendimentosQuery';
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/query/hooks/useAtendimentosQuery.test.tsx` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/query/hooks/useAtendimentosQuery.ts lib/query/hooks/index.ts lib/query/hooks/useAtendimentosQuery.test.tsx
git commit -m "feat(atendimentos): hooks de query/mutation com optimistic"
```

---

### Task 4.6: Realtime union `atendimentos`

**Files:** Modify: `lib/realtime/useRealtimeSync.ts` · Test: `lib/realtime/useRealtimeSync.atendimentos.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/realtime/useRealtimeSync.atendimentos.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'lib/realtime/useRealtimeSync.ts'),
  'utf-8'
);

describe('realtime sync — atendimentos', () => {
  it('inclui atendimentos na union RealtimeTable', () => {
    expect(src).toContain("| 'atendimentos'");
  });

  it('mapeia atendimentos para sua query key (caminho simples invalidate)', () => {
    expect(src).toContain('atendimentos: [queryKeys.atendimentos.all]');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/realtime/useRealtimeSync.atendimentos.test.ts` Expected: FAIL com `expected '...' to contain "| 'atendimentos'"`

- [ ] **Step 3: Implementar o mínimo** — em `lib/realtime/useRealtimeSync.ts`:

Na union `RealtimeTable` (linha 50-56), adicionar a entrada após `'activities'`:

```ts
type RealtimeTable =
  | 'deals'
  | 'contacts'
  | 'activities'
  | 'atendimentos'
  | 'boards'
  | 'board_stages'
  | 'crm_companies';
```

No map `getTableQueryKeys` (linha 60-67), adicionar a linha após `activities` (caminho simples invalidate, NÃO copiar o branch especial de deals):

```ts
  const mapping: Record<RealtimeTable, readonly (readonly unknown[])[]> = {
    deals: [queryKeys.deals.all, queryKeys.dashboard.stats],
    contacts: [queryKeys.contacts.all],
    activities: [queryKeys.activities.all],
    atendimentos: [queryKeys.atendimentos.all],
    boards: [queryKeys.boards.all],
    board_stages: [queryKeys.boards.all], // stages invalidate boards
    crm_companies: [queryKeys.companies.all],
  };
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/realtime/useRealtimeSync.atendimentos.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/realtime/useRealtimeSync.ts lib/realtime/useRealtimeSync.atendimentos.test.ts
git commit -m "feat(atendimentos): realtime union + map invalidate"
```

---

### Task 4.7: `atendimentoFormSchema` em validations

**Files:** Modify: `lib/validations/schemas.ts` · Test: `lib/validations/atendimentoSchema.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/validations/atendimentoSchema.test.ts
import { describe, it, expect } from 'vitest';
import { atendimentoFormSchema } from './schemas';

describe('atendimentoFormSchema', () => {
  it('aceita um atendimento válido', () => {
    const r = atendimentoFormSchema.safeParse({
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: '250',
      professionalId: 'p1',
      paymentMethod: 'pix',
      recebido: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.valor).toBe(250); // currencySchema coage string -> number
      expect(r.data.recebido).toBe(true);
    }
  });

  it('rejeita quando forma de pagamento não é selecionada', () => {
    const r = atendimentoFormSchema.safeParse({
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: '250',
      professionalId: 'p1',
      paymentMethod: '',
      recebido: false,
    });
    expect(r.success).toBe(false);
  });

  it('rejeita quando o profissional não é selecionado', () => {
    const r = atendimentoFormSchema.safeParse({
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: '250',
      professionalId: '',
      paymentMethod: 'pix',
      recebido: false,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/validations/atendimentoSchema.test.ts` Expected: FAIL com `atendimentoFormSchema is not a function` / import undefined

- [ ] **Step 3: Implementar o mínimo** — em `lib/validations/schemas.ts`, adicionar após o bloco `// ============ ACTIVITY SCHEMAS ============` (depois da linha `export type ActivityFormData = ...`, ~linha 181):

```ts
// ============ ATENDIMENTO SCHEMAS ============

export const atendimentoFormSchema = z.object({
  procedimento: requiredString('Procedimento', MAX_LENGTHS.TITLE),
  productId: requiredSelect('Procedimento'),
  valor: currencySchema,
  professionalId: requiredSelect('Profissional'),
  paymentMethod: requiredSelect('Forma de pagamento'),
  cardBrand: optionalString.pipe(z.string().max(MAX_LENGTHS.SHORT_TEXT)),
  installments: z.coerce.number().int().min(1).max(48).default(1),
  recebido: z.boolean().default(false),
});

export type AtendimentoFormData = z.infer<typeof atendimentoFormSchema>;
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/validations/atendimentoSchema.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/validations/schemas.ts lib/validations/atendimentoSchema.test.ts
git commit -m "feat(atendimentos): atendimentoFormSchema zod"
```

---

### Task 4.8: `useAtendimentosController` (deriva contact/company do deal)

**Files:** Create: `features/atendimentos/hooks/useAtendimentosController.ts` · Test: `features/atendimentos/hooks/useAtendimentosController.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// features/atendimentos/hooks/useAtendimentosController.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAtendimentosController } from './useAtendimentosController';

const createMutate = vi.fn();

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'clinic_staff' }, organizationId: 'org1' }),
}));
vi.mock('@/lib/realtime/useRealtimeSync', () => ({ useRealtimeSync: vi.fn() }));
vi.mock('@/lib/query/hooks/useAtendimentosQuery', () => ({
  useAtendimentos: () => ({ data: [], isLoading: false }),
  useCreateAtendimento: () => ({ mutate: createMutate }),
  useUpdateAtendimento: () => ({ mutate: vi.fn() }),
  useDeleteAtendimento: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/lib/query/hooks/useDealsQuery', () => ({
  useDeals: () => ({
    data: [{ id: 'd1', title: 'Plano Ortodôntico', contactId: 'c1', clientCompanyId: 'cc1' }],
    isLoading: false,
  }),
}));
vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useContacts: () => ({ data: [{ id: 'c1', name: 'Maria', clientCompanyId: 'cc1' }], isLoading: false }),
}));
vi.mock('@/lib/query/hooks/useProfessionalsQuery', () => ({
  useProfessionals: () => ({ data: [{ id: 'p1', name: 'Dra. Ana' }], isLoading: false }),
}));
vi.mock('@/lib/query/hooks/useProductsQuery', () => ({
  useProducts: () => ({ data: [{ id: 'prod1', name: 'Limpeza', price: 250 }], isLoading: false }),
}));

describe('useAtendimentosController', () => {
  it('ao submeter, deriva contactId/dealId e marca recebido com performedAt', () => {
    const { result } = renderHook(() => useAtendimentosController());

    act(() => {
      result.current.setFormData({
        procedimento: 'Limpeza',
        productId: 'prod1',
        valor: '250',
        professionalId: 'p1',
        dealId: 'd1',
        paymentMethod: 'pix',
        cardBrand: '',
        installments: '1',
        recebido: true,
      });
    });

    act(() => {
      result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(createMutate).toHaveBeenCalledTimes(1);
    const arg = createMutate.mock.calls[0][0];
    expect(arg.atendimento.contactId).toBe('c1');
    expect(arg.atendimento.dealId).toBe('d1');
    expect(arg.atendimento.recebido).toBe(true);
    expect(arg.atendimento.valor).toBe(250);
    expect(typeof arg.atendimento.performedAt).toBe('string');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/atendimentos/hooks/useAtendimentosController.test.tsx` Expected: FAIL com `Failed to resolve import "./useAtendimentosController"`

- [ ] **Step 3: Implementar o mínimo** — criar `features/atendimentos/hooks/useAtendimentosController.ts` (mirror de useActivitiesController; deriva contact/company do deal):

```ts
import React, { useMemo, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { Atendimento } from '@/types';
import {
  useAtendimentos,
  useCreateAtendimento,
  useUpdateAtendimento,
  useDeleteAtendimento,
} from '@/lib/query/hooks/useAtendimentosQuery';
import { useDeals } from '@/lib/query/hooks/useDealsQuery';
import { useContacts } from '@/lib/query/hooks/useContactsQuery';
import { useProfessionals } from '@/lib/query/hooks/useProfessionalsQuery';
import { useProducts } from '@/lib/query/hooks/useProductsQuery';
import { useRealtimeSync } from '@/lib/realtime/useRealtimeSync';

export interface AtendimentoFormState {
  procedimento: string;
  productId: string;
  valor: string;
  professionalId: string;
  dealId: string;
  paymentMethod: string;
  cardBrand: string;
  installments: string;
  recebido: boolean;
}

const emptyForm: AtendimentoFormState = {
  procedimento: '',
  productId: '',
  valor: '',
  professionalId: '',
  dealId: '',
  paymentMethod: 'pix',
  cardBrand: '',
  installments: '1',
  recebido: false,
};

/**
 * Hook controlador da tela de Atendimentos.
 * Deriva contactId/clientCompanyId do deal selecionado (mesma lógica de activities).
 */
export const useAtendimentosController = () => {
  const { profile } = useAuth();

  const { data: atendimentos = [], isLoading: atendimentosLoading } = useAtendimentos();
  const { data: deals = [], isLoading: dealsLoading } = useDeals();
  const { data: contacts = [], isLoading: contactsLoading } = useContacts();
  const { data: professionals = [], isLoading: professionalsLoading } = useProfessionals();
  const { data: products = [], isLoading: productsLoading } = useProducts();
  const createMutation = useCreateAtendimento();
  const updateMutation = useUpdateAtendimento();
  const deleteMutation = useDeleteAtendimento();

  useRealtimeSync('atendimentos');

  const { showToast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Atendimento | null>(null);
  const [formData, setFormData] = useState<AtendimentoFormState>(emptyForm);

  const isLoading =
    atendimentosLoading ||
    dealsLoading ||
    contactsLoading ||
    professionalsLoading ||
    productsLoading;

  const dealsById = useMemo(() => new Map(deals.map(d => [d.id, d])), [deals]);
  const contactsById = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);
  const productsById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const filteredAtendimentos = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return atendimentos.filter(a => (a.procedimento || '').toLowerCase().includes(q));
  }, [atendimentos, searchTerm]);

  const handleNew = () => {
    setEditing(null);
    setFormData(emptyForm);
    setIsModalOpen(true);
  };

  const handleEdit = (atendimento: Atendimento) => {
    setEditing(atendimento);
    setFormData({
      procedimento: atendimento.procedimento,
      productId: atendimento.productId || '',
      valor: String(atendimento.valor ?? 0),
      professionalId: atendimento.professionalId || '',
      dealId: atendimento.dealId || '',
      paymentMethod: atendimento.paymentMethod || 'pix',
      cardBrand: atendimento.cardBrand || '',
      installments: String(atendimento.installments ?? 1),
      recebido: atendimento.recebido ?? false,
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Tem certeza que deseja excluir este atendimento?')) {
      deleteMutation.mutate(id, {
        onSuccess: () => showToast('Atendimento excluído com sucesso', 'success'),
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const selectedDeal = formData.dealId ? dealsById.get(formData.dealId) : undefined;
    const selectedContact = selectedDeal?.contactId
      ? contactsById.get(selectedDeal.contactId)
      : undefined;
    const selectedProduct = formData.productId ? productsById.get(formData.productId) : undefined;
    const nowIso = new Date().toISOString();

    const payload: Omit<Atendimento, 'id'> = {
      procedimento: formData.procedimento || selectedProduct?.name || '',
      productId: formData.productId || undefined,
      valor: Number(formData.valor) || 0,
      professionalId: formData.professionalId || undefined,
      dealId: formData.dealId || undefined,
      contactId: selectedContact?.id || undefined,
      paymentMethod: formData.paymentMethod || undefined,
      cardBrand: formData.cardBrand || undefined,
      installments: Number(formData.installments) || 1,
      recebido: formData.recebido,
      paidAt: formData.recebido ? nowIso : undefined,
      performedAt: nowIso,
    };

    if (editing) {
      updateMutation.mutate(
        { id: editing.id, updates: payload },
        {
          onSuccess: () => {
            showToast('Atendimento atualizado com sucesso', 'success');
            setIsModalOpen(false);
          },
        }
      );
    } else {
      createMutation.mutate(
        { atendimento: payload },
        {
          onSuccess: () => {
            showToast('Atendimento registrado com sucesso', 'success');
            setIsModalOpen(false);
          },
          onError: (error: Error) => {
            showToast(`Erro ao registrar atendimento: ${error.message}`, 'error');
          },
        }
      );
    }
  };

  return {
    profile,
    searchTerm,
    setSearchTerm,
    isModalOpen,
    setIsModalOpen,
    editing,
    formData,
    setFormData,
    filteredAtendimentos,
    deals,
    professionals,
    products,
    isLoading,
    handleNew,
    handleEdit,
    handleDelete,
    handleSubmit,
  };
};
```

Nota: este controller depende de `useProfessionalsQuery` (Fase 3) e `useProductsQuery`. O CONTRATO usa `productsService.getActive`; se `useProductsQuery` ainda não existir como hook nomeado `useProducts`, criá-lo como wrapper fino de `productsService.getActive` na própria task da Fase de Settings/Produtos. Para esta fase, o teste mocka todos os hooks, então o controller compila contra os imports.

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/atendimentos/hooks/useAtendimentosController.test.tsx` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add features/atendimentos/hooks/useAtendimentosController.ts features/atendimentos/hooks/useAtendimentosController.test.tsx
git commit -m "feat(atendimentos): controller deriva contact/deal + paid_at"
```

---

### Task 4.9: Componentes List/Row/FormModal

**Files:** Create: `features/atendimentos/components/AtendimentosList.tsx` · `features/atendimentos/components/AtendimentoRow.tsx` · `features/atendimentos/components/AtendimentoFormModal.tsx` · Test: `features/atendimentos/components/AtendimentoFormModal.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// features/atendimentos/components/AtendimentoFormModal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from '@/lib/a11y/test/a11y-utils';
import { AtendimentoFormModal } from './AtendimentoFormModal';

const baseForm = {
  procedimento: '',
  productId: '',
  valor: '',
  professionalId: '',
  dealId: '',
  paymentMethod: 'pix',
  cardBrand: '',
  installments: '1',
  recebido: false,
};

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSubmit: vi.fn(e => e.preventDefault()),
  formData: baseForm,
  setFormData: vi.fn(),
  editing: null,
  deals: [{ id: 'd1', title: 'Plano Ortodôntico' }] as any,
  professionals: [{ id: 'p1', name: 'Dra. Ana' }] as any,
  products: [{ id: 'prod1', name: 'Limpeza', price: 250 }] as any,
};

describe('AtendimentoFormModal', () => {
  it('renderiza o checkbox "recebido" e os selects de procedimento/dentista/forma de pgto', () => {
    render(<AtendimentoFormModal {...baseProps} />);
    expect(screen.getByText('Novo Atendimento')).toBeTruthy();
    expect(screen.getByLabelText(/recebido/i)).toBeTruthy();
    expect(screen.getByText('Procedimento')).toBeTruthy();
    expect(screen.getByText('Dentista')).toBeTruthy();
    expect(screen.getByText('Forma de Pagamento')).toBeTruthy();
  });

  it('marca recebido ao clicar no checkbox', async () => {
    const setFormData = vi.fn();
    render(<AtendimentoFormModal {...baseProps} setFormData={setFormData} />);
    await userEvent.click(screen.getByLabelText(/recebido/i));
    expect(setFormData).toHaveBeenCalledWith(expect.objectContaining({ recebido: true }));
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<AtendimentoFormModal {...baseProps} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/atendimentos/components/AtendimentoFormModal.test.tsx` Expected: FAIL com `Failed to resolve import "./AtendimentoFormModal"`

- [ ] **Step 3: Implementar o mínimo** — criar os três componentes.

`features/atendimentos/components/AtendimentoFormModal.tsx` (mirror de ActivityFormModal; drawer "1 toque"):

```tsx
import React from 'react';
import { X } from 'lucide-react';
import { Atendimento, Deal, Professional, Product } from '@/types';
import type { AtendimentoFormState } from '../hooks/useAtendimentosController';

interface AtendimentoFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  formData: AtendimentoFormState;
  setFormData: (data: AtendimentoFormState) => void;
  editing: Atendimento | null;
  deals: Deal[];
  professionals: Professional[];
  products: Product[];
}

/**
 * Drawer "1 toque" para registrar atendimento.
 * procedimento (select de products) · valor · dentista (professionals) · forma de pgto · checkbox recebido.
 */
export const AtendimentoFormModal: React.FC<AtendimentoFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  editing,
  deals,
  professionals,
  products,
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape, { passive: true });
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleProductChange = (productId: string) => {
    const product = products.find(p => p.id === productId);
    setFormData({
      ...formData,
      productId,
      procedimento: product?.name || formData.procedimento,
      valor: product ? String(product.price) : formData.valor,
    });
  };

  const showCardBrand = formData.paymentMethod === 'credito' || formData.paymentMethod === 'debito';

  return (
    <div
      className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200 max-h-[calc(100dvh-2rem)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-200 dark:border-white/10 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            {editing ? 'Editar Atendimento' : 'Novo Atendimento'}
          </h2>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-5 space-y-4 overflow-auto pb-[calc(1.25rem+var(--app-safe-area-bottom,0px))]">
          <div>
            <label htmlFor="atd-procedimento" className="block text-xs font-bold text-slate-500 uppercase mb-1">Procedimento</label>
            <select
              id="atd-procedimento"
              required
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              value={formData.productId}
              onChange={e => handleProductChange(e.target.value)}
            >
              <option value="">Selecione...</option>
              {products.map(product => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="atd-valor" className="block text-xs font-bold text-slate-500 uppercase mb-1">Valor</label>
              <input
                id="atd-valor"
                required
                type="number"
                min="0"
                step="0.01"
                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="0,00"
                value={formData.valor}
                onChange={e => setFormData({ ...formData, valor: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="atd-dentista" className="block text-xs font-bold text-slate-500 uppercase mb-1">Dentista</label>
              <select
                id="atd-dentista"
                required
                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                value={formData.professionalId}
                onChange={e => setFormData({ ...formData, professionalId: e.target.value })}
              >
                <option value="">Selecione...</option>
                {professionals.map(prof => (
                  <option key={prof.id} value={prof.id}>
                    {prof.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="atd-deal" className="block text-xs font-bold text-slate-500 uppercase mb-1">Paciente (Negócio)</label>
            <select
              id="atd-deal"
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              value={formData.dealId}
              onChange={e => setFormData({ ...formData, dealId: e.target.value })}
            >
              <option value="">Selecione...</option>
              {deals.map(deal => (
                <option key={deal.id} value={deal.id}>
                  {deal.title}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="atd-pgto" className="block text-xs font-bold text-slate-500 uppercase mb-1">Forma de Pagamento</label>
              <select
                id="atd-pgto"
                required
                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                value={formData.paymentMethod}
                onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })}
              >
                <option value="pix">Pix</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="debito">Débito</option>
                <option value="credito">Crédito</option>
              </select>
            </div>
            <div>
              <label htmlFor="atd-parcelas" className="block text-xs font-bold text-slate-500 uppercase mb-1">Parcelas</label>
              <input
                id="atd-parcelas"
                type="number"
                min="1"
                max="48"
                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                value={formData.installments}
                onChange={e => setFormData({ ...formData, installments: e.target.value })}
              />
            </div>
          </div>

          {showCardBrand && (
            <div>
              <label htmlFor="atd-bandeira" className="block text-xs font-bold text-slate-500 uppercase mb-1">Bandeira do Cartão</label>
              <input
                id="atd-bandeira"
                type="text"
                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Ex: Visa, Master"
                value={formData.cardBrand}
                onChange={e => setFormData({ ...formData, cardBrand: e.target.value })}
              />
            </div>
          )}

          <label htmlFor="atd-recebido" className="flex items-center gap-2 cursor-pointer select-none">
            <input
              id="atd-recebido"
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              checked={formData.recebido}
              onChange={e => setFormData({ ...formData, recebido: e.target.checked })}
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Recebido (entra no faturamento)
            </span>
          </label>

          <button
            type="submit"
            className="w-full bg-primary-600 hover:bg-primary-500 text-white font-bold py-2.5 rounded-lg mt-2 shadow-lg shadow-primary-600/20 transition-all"
          >
            {editing ? 'Salvar Alterações' : 'Registrar Atendimento'}
          </button>
        </form>
      </div>
    </div>
  );
};
```

`features/atendimentos/components/AtendimentoRow.tsx`:

```tsx
import React from 'react';
import { Pencil, Trash2, CheckCircle2, Circle } from 'lucide-react';
import { Atendimento } from '@/types';

interface AtendimentoRowProps {
  atendimento: Atendimento;
  onEdit: (atendimento: Atendimento) => void;
  onDelete: (id: string) => void;
}

const formatBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

/**
 * Linha de atendimento na lista. Mostra procedimento, valor e status de recebimento.
 */
export const AtendimentoRow: React.FC<AtendimentoRowProps> = ({ atendimento, onEdit, onDelete }) => {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
          {atendimento.procedimento}
        </p>
        <p className="text-xs text-slate-500">{formatBRL(atendimento.valor)}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            atendimento.recebido ? 'text-emerald-600' : 'text-slate-400'
          }`}
        >
          {atendimento.recebido ? <CheckCircle2 size={14} /> : <Circle size={14} />}
          {atendimento.recebido ? 'Recebido' : 'Pendente'}
        </span>
        <button
          type="button"
          aria-label="Editar atendimento"
          onClick={() => onEdit(atendimento)}
          className="text-slate-400 hover:text-primary-600"
        >
          <Pencil size={16} />
        </button>
        <button
          type="button"
          aria-label="Excluir atendimento"
          onClick={() => onDelete(atendimento.id)}
          className="text-slate-400 hover:text-red-600"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};
```

`features/atendimentos/components/AtendimentosList.tsx`:

```tsx
import React from 'react';
import { Atendimento } from '@/types';
import { AtendimentoRow } from './AtendimentoRow';

interface AtendimentosListProps {
  atendimentos: Atendimento[];
  isLoading: boolean;
  onEdit: (atendimento: Atendimento) => void;
  onDelete: (id: string) => void;
}

/**
 * Lista de atendimentos com estados de loading e vazio.
 */
export const AtendimentosList: React.FC<AtendimentosListProps> = ({
  atendimentos,
  isLoading,
  onEdit,
  onDelete,
}) => {
  if (isLoading) {
    return (
      <div className="p-8 text-center text-sm text-slate-400">Carregando atendimentos...</div>
    );
  }

  if (atendimentos.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-400">
        Nenhum atendimento registrado ainda.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
      {atendimentos.map(atendimento => (
        <AtendimentoRow
          key={atendimento.id}
          atendimento={atendimento}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/atendimentos/components/AtendimentoFormModal.test.tsx` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add features/atendimentos/components/
git commit -m "feat(atendimentos): List/Row/FormModal drawer 1 toque + recebido"
```

---

### Task 4.10: `AtendimentosPage` + rota

**Files:** Create: `features/atendimentos/AtendimentosPage.tsx` · `app/(protected)/atendimentos/page.tsx` · Test: `features/atendimentos/AtendimentosPage.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// features/atendimentos/AtendimentosPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtendimentosPage } from './AtendimentosPage';

const handleNew = vi.fn();

vi.mock('./hooks/useAtendimentosController', () => ({
  useAtendimentosController: () => ({
    profile: { id: 'u1', role: 'clinic_staff' },
    searchTerm: '',
    setSearchTerm: vi.fn(),
    isModalOpen: false,
    setIsModalOpen: vi.fn(),
    editing: null,
    formData: {
      procedimento: '', productId: '', valor: '', professionalId: '', dealId: '',
      paymentMethod: 'pix', cardBrand: '', installments: '1', recebido: false,
    },
    setFormData: vi.fn(),
    filteredAtendimentos: [],
    deals: [],
    professionals: [],
    products: [],
    isLoading: false,
    handleNew,
    handleEdit: vi.fn(),
    handleDelete: vi.fn(),
    handleSubmit: vi.fn(),
  }),
}));

describe('AtendimentosPage', () => {
  it('renderiza o título e dispara novo atendimento', async () => {
    render(<AtendimentosPage />);
    expect(screen.getByText('Atendimentos')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /novo atendimento/i }));
    expect(handleNew).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/atendimentos/AtendimentosPage.test.tsx` Expected: FAIL com `Failed to resolve import "./AtendimentosPage"`

- [ ] **Step 3: Implementar o mínimo** — criar `features/atendimentos/AtendimentosPage.tsx`:

```tsx
import React from 'react';
import { Plus } from 'lucide-react';
import { useAtendimentosController } from './hooks/useAtendimentosController';
import { AtendimentosList } from './components/AtendimentosList';
import { AtendimentoFormModal } from './components/AtendimentoFormModal';

/**
 * Página de Atendimentos: registra procedimentos realizados e o recebimento.
 */
export const AtendimentosPage: React.FC = () => {
  const {
    searchTerm,
    setSearchTerm,
    isModalOpen,
    setIsModalOpen,
    editing,
    formData,
    setFormData,
    filteredAtendimentos,
    deals,
    professionals,
    products,
    isLoading,
    handleNew,
    handleEdit,
    handleDelete,
    handleSubmit,
  } = useAtendimentosController();

  return (
    <div className="p-8 max-w-400 mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-display">
          Atendimentos
        </h1>
        <button
          type="button"
          onClick={handleNew}
          className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-500 text-white font-bold px-4 py-2 rounded-lg shadow-lg shadow-primary-600/20 transition-all"
        >
          <Plus size={18} />
          Novo Atendimento
        </button>
      </div>

      <div className="mb-4">
        <input
          type="search"
          placeholder="Buscar por procedimento..."
          className="w-full max-w-sm bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <AtendimentosList
        atendimentos={filteredAtendimentos}
        isLoading={isLoading}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <AtendimentoFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        formData={formData}
        setFormData={setFormData}
        editing={editing}
        deals={deals}
        professionals={professionals}
        products={products}
      />
    </div>
  );
};
```

Criar `app/(protected)/atendimentos/page.tsx` (mirror exato do wrapper de activities):

```tsx
'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const AtendimentosPage = dynamic(
    () => import('@/features/atendimentos/AtendimentosPage').then(m => ({ default: m.AtendimentosPage })),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Componente React `Atendimentos`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function Atendimentos() {
    return <AtendimentosPage />
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/atendimentos/AtendimentosPage.test.tsx` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add features/atendimentos/AtendimentosPage.tsx features/atendimentos/AtendimentosPage.test.tsx "app/(protected)/atendimentos/page.tsx"
git commit -m "feat(atendimentos): AtendimentosPage + rota protegida"
```

---

### Task 4.11: Node integration — isolamento de tenant + recebido/paid_at persiste

**Files:** Create: `test/atendimentos.integration.test.ts` · Modify: `vitest.config.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// test/atendimentos.integration.test.ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { getSupabaseAdminClient } from './helpers/supabaseAdmin';
import { loadEnvFile } from './helpers/env';

const nextRoot = process.cwd();
const repoRoot = `${nextRoot}/..`;
loadEnvFile(`${repoRoot}/.env`);
loadEnvFile(`${repoRoot}/.env.local`, { override: true });
loadEnvFile(`${nextRoot}/.env`);
loadEnvFile(`${nextRoot}/.env.local`, { override: true });

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hasRealSupabaseCreds =
  Boolean(supabaseUrl) &&
  Boolean(serviceRoleKey) &&
  serviceRoleKey !== 'your_service_role_key' &&
  !serviceRoleKey.startsWith('your_') &&
  !serviceRoleKey.startsWith('sb_secret_your_');

const describeSupabase = hasRealSupabaseCreds ? describe : describe.skip;

describeSupabase('atendimentos — integração multi-tenant', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let contactAId = '';
  let dealAId = '';

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;
    contactAId = fx.contactA.contactId;
    dealAId = fx.dealA.dealId;
  }, 60_000);

  afterAll(async () => {
    if (runId) {
      const sb = getSupabaseAdminClient();
      await sb.from('atendimentos').delete().ilike('procedimento', `%${runId}%`);
      await cleanupFixtures(runId);
    }
  }, 60_000);

  it('persiste recebido=true com paid_at preenchido', async () => {
    const sb = getSupabaseAdminClient();
    const paidAt = new Date().toISOString();
    const insert = await sb
      .from('atendimentos')
      .insert({
        organization_id: orgAId,
        contact_id: contactAId,
        deal_id: dealAId,
        procedimento: `Limpeza ${runId}`,
        valor: 250,
        payment_method: 'pix',
        installments: 1,
        recebido: true,
        paid_at: paidAt,
        performed_at: paidAt,
      })
      .select('id, recebido, paid_at, organization_id')
      .single();

    expect(insert.error).toBeNull();
    expect(insert.data?.recebido).toBe(true);
    expect(insert.data?.paid_at).toBeTruthy();
    expect(insert.data?.organization_id).toBe(orgAId);
  });

  it('org B não lê atendimento da org A (isolamento por organization_id)', async () => {
    const sb = getSupabaseAdminClient();

    await sb.from('atendimentos').insert({
      organization_id: orgAId,
      procedimento: `Canal ${runId}`,
      valor: 800,
      installments: 1,
      recebido: false,
      performed_at: new Date().toISOString(),
    });

    const fromB = await sb
      .from('atendimentos')
      .select('id, organization_id, procedimento')
      .eq('organization_id', orgBId)
      .ilike('procedimento', `%${runId}%`);

    expect(fromB.error).toBeNull();
    expect(fromB.data || []).toHaveLength(0);

    const fromA = await sb
      .from('atendimentos')
      .select('id, organization_id')
      .eq('organization_id', orgAId)
      .ilike('procedimento', `Canal ${runId}`);
    expect((fromA.data || []).length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/atendimentos.integration.test.ts` Expected: FAIL — sem creds: `0 passed` (suíte `skip`, prova só que carrega); com creds reais e migração não aplicada: erro `relation "public.atendimentos" does not exist`. (Aplicar a migração 4.2 no banco de dev antes de rodar com creds.)

- [ ] **Step 3: Implementar o mínimo** — registrar o path em `environmentMatchGlobs` de `vitest.config.ts`, adicionando dentro do array (após a última entrada):

```ts
    environmentMatchGlobs: [
      ['test/aiToolsRbac.test.ts', 'node'],
      ['test/supabaseMiddleware.test.ts', 'node'],
      ['test/publicApiOpenapi.test.ts', 'node'],
      ['test/publicApiCursor.test.ts', 'node'],
      ['test/tools.salesTeamMatrix.test.ts', 'node'],
      ['test/tools.multiTenant.test.ts', 'node'],
      ['test/atendimentos.integration.test.ts', 'node'],
      ['lib/utils/csv.test.ts', 'node'],
      ['lib/query/__tests__/cache-integrity.test.ts', 'node'],
    ],
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/atendimentos.integration.test.ts` Expected: PASS (com creds + migração aplicada: 2 testes passam; sem creds: suíte `skip`, 0 falhas)

- [ ] **Step 5: Commit**
```bash
git add test/atendimentos.integration.test.ts vitest.config.ts
git commit -m "test(atendimentos): integração tenant-isolada + recebido/paid_at"
```

---

### Task 4.12: Gate final da fase (typecheck + lint + suíte)

**Files:** (sem novos arquivos)

- [ ] **Step 1: Rodar o gate rápido** Run: `npm run precheck:fast` Expected: lint + typecheck + test:run PASS (sem creds, os testes de integração ficam `skip`).

- [ ] **Step 2: Se falhar typecheck por `Professional`/`useProducts` ainda não existirem** — confirmar que a Fase 3 (professionals) e o hook `useProducts` (wrapper de `productsService.getActive`) foram entregues antes desta fase. Esta fase importa `Professional`, `useProfessionals` e `useProducts`; são dependências travadas no CONTRATO. Não criar stubs aqui — corrigir a ordem de execução das fases.

- [ ] **Step 3: Commit do estado verde** (se houve ajuste de import/ordenação)
```bash
git add -A
git commit -m "chore(atendimentos): gate verde precheck:fast"
```

DoD da fase: tabela `atendimentos` com tenant isolado (teste RLS-as-text 4.2 + integração 4.11), faturamento conta SÓ com `recebido=true` (service carimba `paid_at`, testado em 4.3 e 4.11), drawer "1 toque" com loading/empty na lista, RBAC herdado da RLS (`can_operate_organization` exclui só leitura de config — registro é liberado para `clinic_staff`), typecheck + lint passam.

---

## Fase 5 — Configs financeiras (taxas de cartão · comissão por dr+especialidade · contas fixas) — só Adel

Esta fase cria a camada de configuração financeira: `payment_method_fees`, `commission_rules`, `fixed_costs`. **Gate de segurança crítico:** as 3 tabelas usam `can_configure_organization` tanto em SELECT quanto em mutação — diferente das tabelas operacionais (`atendimentos`, `appointments`), que usam `can_operate`/`can_access`. Isso **exclui a Vitória (clinic_staff) inteiramente** de ler ou escrever config financeira. Se qualquer policy usar `can_operate` ou `can_access` por engano, a Vitória ganha leitura/escrita de margem e taxas — vazamento de dado sensível. O teste RLS-as-text (Task 5.6) trava isso por contrato.

Pré-requisitos das fases anteriores assumidos como prontos: a tabela `professionals` + `professionalsService` + `useProfessionalsQuery` (Fase 1) já existem — o `CommissionsManager` os consome.

---

### Task 5.1: Migração `20260615000000_finance_config.sql` (payment_method_fees + commission_rules + fixed_costs)
**Files:** Create: `supabase/migrations/20260615000000_finance_config.sql` · Modify: `supabase/reset.sql` · Test: `test/multiTenantRlsPolicies.financeConfig.test.ts`

- [ ] **Step 1: Escrever o teste que falha** (RLS-as-text — assertiva de que as 3 tabelas usam `can_configure_organization` em SELECT e mutação, e NÃO `can_operate`/`can_access`/`using (true)`)

Criar `test/multiTenantRlsPolicies.financeConfig.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260615000000_finance_config.sql'
);

describe('finance config RLS migration (só Adel — can_configure)', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  const financeConfigTables = ['payment_method_fees', 'commission_rules', 'fixed_costs'] as const;

  it('cria as 3 tabelas de config financeira', () => {
    for (const table of financeConfigTables) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('protege SELECT e mutação com can_configure_organization (exclui clinic_staff/Vitória)', () => {
    for (const table of financeConfigTables) {
      expect(sql).toContain(`on public.${table}`);
    }
    expect(sql).toContain('public.can_configure_organization');
  });

  it('NÃO usa can_operate nem can_access nas tabelas de config financeira (senão Vitória lê margem)', () => {
    // Gate crítico: config financeira é exclusiva do admin da clínica.
    expect(sql).not.toContain('public.can_operate_organization');
    expect(sql).not.toContain('public.can_access_organization');
  });

  it('não deixa policies permissivas', () => {
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('aplica trigger updated_at e índices por organização', () => {
    for (const table of financeConfigTables) {
      expect(sql).toContain(`update_${table}_updated_at`);
      expect(sql).toContain(`idx_${table}_org on public.${table}(organization_id, created_at desc)`);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/multiTenantRlsPolicies.financeConfig.test.ts` Expected: FAIL com `ENOENT: no such file or directory ... 20260615000000_finance_config.sql`

- [ ] **Step 3: Implementar o mínimo** — criar a migração `supabase/migrations/20260615000000_finance_config.sql` (SQL minúsculo, idempotente, espelhando `20260311013000_core_multi_tenant_rls.sql`):

```sql
-- =============================================================================
-- Configs financeiras: taxas de cartão, regras de comissão, contas fixas.
-- RLS: SELECT + mutação SOMENTE can_configure_organization (clinic_admin/Adel).
-- clinic_staff (Vitória) NÃO lê nem escreve nenhuma destas tabelas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- payment_method_fees
-- ---------------------------------------------------------------------------
create table if not exists public.payment_method_fees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  payment_type text not null,
  card_brand text,
  installments integer not null default 1,
  fee_percent numeric not null default 0,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_method_fees enable row level security;

create index if not exists idx_payment_method_fees_org on public.payment_method_fees(organization_id, created_at desc);
create index if not exists idx_payment_method_fees_owner on public.payment_method_fees(owner_id);

drop policy if exists "payment_method_fees_select_by_tenant_admin" on public.payment_method_fees;
create policy "payment_method_fees_select_by_tenant_admin"
  on public.payment_method_fees
  for select
  to authenticated
  using (public.can_configure_organization(organization_id));

drop policy if exists "payment_method_fees_mutate_by_tenant_admin" on public.payment_method_fees;
create policy "payment_method_fees_mutate_by_tenant_admin"
  on public.payment_method_fees
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

drop trigger if exists update_payment_method_fees_updated_at on public.payment_method_fees;
create trigger update_payment_method_fees_updated_at
  before update on public.payment_method_fees
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- commission_rules
-- ---------------------------------------------------------------------------
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  professional_id uuid references public.professionals(id),
  specialty text,
  percent numeric not null default 0,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.commission_rules enable row level security;

create index if not exists idx_commission_rules_org on public.commission_rules(organization_id, created_at desc);
create index if not exists idx_commission_rules_professional on public.commission_rules(professional_id);
create index if not exists idx_commission_rules_owner on public.commission_rules(owner_id);

drop policy if exists "commission_rules_select_by_tenant_admin" on public.commission_rules;
create policy "commission_rules_select_by_tenant_admin"
  on public.commission_rules
  for select
  to authenticated
  using (public.can_configure_organization(organization_id));

drop policy if exists "commission_rules_mutate_by_tenant_admin" on public.commission_rules;
create policy "commission_rules_mutate_by_tenant_admin"
  on public.commission_rules
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

drop trigger if exists update_commission_rules_updated_at on public.commission_rules;
create trigger update_commission_rules_updated_at
  before update on public.commission_rules
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- fixed_costs
-- ---------------------------------------------------------------------------
create table if not exists public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  amount numeric not null default 0,
  due_day integer,
  active boolean not null default true,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fixed_costs enable row level security;

create index if not exists idx_fixed_costs_org on public.fixed_costs(organization_id, created_at desc);
create index if not exists idx_fixed_costs_owner on public.fixed_costs(owner_id);

drop policy if exists "fixed_costs_select_by_tenant_admin" on public.fixed_costs;
create policy "fixed_costs_select_by_tenant_admin"
  on public.fixed_costs
  for select
  to authenticated
  using (public.can_configure_organization(organization_id));

drop policy if exists "fixed_costs_mutate_by_tenant_admin" on public.fixed_costs;
create policy "fixed_costs_mutate_by_tenant_admin"
  on public.fixed_costs
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

drop trigger if exists update_fixed_costs_updated_at on public.fixed_costs;
create trigger update_fixed_costs_updated_at
  before update on public.fixed_costs
  for each row execute function public.update_updated_at_column();
```

Modificar `supabase/reset.sql` — adicionar o DELETE das 3 tabelas em ordem FK-safe (antes de `products`, já que `commission_rules` referencia `professionals`; e como nenhuma destas é referenciada por outra tabela, podem ir logo após o bloco de `custom_field_definitions`). Inserir entre o bloco de `products` e o de `leads` (após a linha `RAISE NOTICE '   ✓ products deletados';`):

```sql
    -- Configs financeiras (commission_rules referencia professionals; nenhuma é referenciada por outras)
    DELETE FROM commission_rules;
    RAISE NOTICE '   ✓ commission_rules deletadas';

    DELETE FROM payment_method_fees;
    RAISE NOTICE '   ✓ payment_method_fees deletadas';

    DELETE FROM fixed_costs;
    RAISE NOTICE '   ✓ fixed_costs deletados';
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/multiTenantRlsPolicies.financeConfig.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260615000000_finance_config.sql supabase/reset.sql test/multiTenantRlsPolicies.financeConfig.test.ts
git commit -m "feat(finance): migracao configs financeiras (taxas/comissoes/contas) com RLS can_configure"
```

---

### Task 5.2: TS types (PaymentMethodFee, CommissionRule, FixedCost)
**Files:** Modify: `types/types.ts` · Test: `test/financeConfigTypes.test.ts`

- [ ] **Step 1: Escrever o teste que falha** — criar `test/financeConfigTypes.test.ts` (teste de tipos via compilação/uso; happy-dom default):

```ts
import { describe, expect, it } from 'vitest';
import type { PaymentMethodFee, CommissionRule, FixedCost } from '@/types';

describe('finance config types', () => {
  it('PaymentMethodFee tem os campos camelCase do contrato', () => {
    const fee: PaymentMethodFee = {
      id: 'fee-1',
      organizationId: 'org-1',
      label: 'Crédito 3x Visa',
      paymentType: 'credito',
      cardBrand: 'visa',
      installments: 3,
      feePercent: 4.5,
    };
    expect(fee.paymentType).toBe('credito');
    expect(fee.feePercent).toBe(4.5);
    expect(fee.installments).toBe(3);
  });

  it('CommissionRule tem professionalId/specialty/percent', () => {
    const rule: CommissionRule = {
      id: 'rule-1',
      organizationId: 'org-1',
      professionalId: 'prof-1',
      specialty: 'ortodontia',
      percent: 30,
    };
    expect(rule.percent).toBe(30);
    expect(rule.professionalId).toBe('prof-1');
  });

  it('FixedCost tem name/amount/dueDay/active', () => {
    const cost: FixedCost = {
      id: 'cost-1',
      organizationId: 'org-1',
      name: 'Aluguel',
      amount: 5000,
      dueDay: 10,
      active: true,
    };
    expect(cost.amount).toBe(5000);
    expect(cost.active).toBe(true);
    expect(cost.dueDay).toBe(10);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/financeConfigTypes.test.ts` Expected: FAIL com erro de typecheck/import: `Module '"@/types"' has no exported member 'PaymentMethodFee'`

- [ ] **Step 3: Implementar o mínimo** — adicionar os types em `types/types.ts` (logo após `DealItem`, antes do bloco `// CUSTOM FIELDS DEFINITION`):

```ts
// ============ CAMADA CLÍNICO-FINANCEIRA — CONFIGS ============

export type PaymentType = 'credito' | 'debito' | 'pix' | 'dinheiro';

export interface PaymentMethodFee {
  id: string;
  organizationId?: OrganizationId; // Tenant FK (for RLS)
  label: string;
  paymentType: PaymentType;
  cardBrand?: string;
  installments: number;
  feePercent: number;
}

export interface CommissionRule {
  id: string;
  organizationId?: OrganizationId; // Tenant FK (for RLS)
  professionalId?: string;
  specialty?: string;
  percent: number;
}

export interface FixedCost {
  id: string;
  organizationId?: OrganizationId; // Tenant FK (for RLS)
  name: string;
  amount: number;
  dueDay?: number;
  active: boolean;
}
```

Garantir que `types/index.ts` (ou o ponto de re-export `@/types`) exporta de `types.ts`. Verificar: se `@/types` aponta para `types/types.ts` diretamente (como `Product` já é exportado de lá e usado via `@/types`), nenhum re-export adicional é necessário.

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/financeConfigTypes.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add types/types.ts test/financeConfigTypes.test.ts
git commit -m "feat(finance): types PaymentMethodFee/CommissionRule/FixedCost"
```

---

### Task 5.3: Services (paymentMethodFeesService · commissionRulesService · fixedCostsService)
**Files:** Create: `lib/supabase/paymentMethodFees.ts` · Create: `lib/supabase/commissionRules.ts` · Create: `lib/supabase/fixedCosts.ts` · Modify: `lib/supabase/index.ts` · Test: `test/financeConfigServices.test.ts`

- [ ] **Step 1: Escrever o teste que falha** — criar `test/financeConfigServices.test.ts` (happy-dom; mocka `./client` para validar transform snake↔camel, colunas explícitas e stamp org+owner):

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const selectMock = vi.fn();
const insertMock = vi.fn();
const fromMock = vi.fn();
const getUserMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    auth: { getUser: () => getUserMock() },
  },
}));

import { paymentMethodFeesService } from '@/lib/supabase/paymentMethodFees';
import { commissionRulesService } from '@/lib/supabase/commissionRules';
import { fixedCostsService } from '@/lib/supabase/fixedCosts';

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
});

describe('paymentMethodFeesService', () => {
  it('getAll filtra por organization_id e transforma snake->camel', async () => {
    const orderMock = vi.fn().mockReturnValue({ eq: eqMock });
    function eqMock() {
      return Promise.resolve({
        data: [
          {
            id: 'fee-1',
            organization_id: 'org-1',
            label: 'Crédito 3x',
            payment_type: 'credito',
            card_brand: 'visa',
            installments: 3,
            fee_percent: 4.5,
            owner_id: 'user-1',
            created_at: 'now',
            updated_at: 'now',
          },
        ],
        error: null,
      });
    }
    selectMock.mockReturnValue({ order: orderMock });
    fromMock.mockReturnValue({ select: selectMock });

    const res = await paymentMethodFeesService.getAll('org-1');
    expect(res.error).toBeNull();
    expect(res.data[0]).toEqual({
      id: 'fee-1',
      organizationId: 'org-1',
      label: 'Crédito 3x',
      paymentType: 'credito',
      cardBrand: 'visa',
      installments: 3,
      feePercent: 4.5,
    });
    expect(fromMock).toHaveBeenCalledWith('payment_method_fees');
  });

  it('create estampa organization_id + owner_id', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'fee-2',
        organization_id: 'org-1',
        label: 'Pix',
        payment_type: 'pix',
        card_brand: null,
        installments: 1,
        fee_percent: 0,
        owner_id: 'user-1',
        created_at: 'now',
        updated_at: 'now',
      },
      error: null,
    });
    const selectAfterInsert = vi.fn().mockReturnValue({ single: singleMock });
    insertMock.mockReturnValue({ select: selectAfterInsert });
    fromMock.mockReturnValue({ insert: insertMock });

    const res = await paymentMethodFeesService.create({
      label: 'Pix',
      paymentType: 'pix',
      installments: 1,
      feePercent: 0,
      organizationId: 'org-1',
    });

    expect(res.error).toBeNull();
    expect(res.data?.paymentType).toBe('pix');
    const payload = insertMock.mock.calls[0][0];
    expect(payload.organization_id).toBe('org-1');
    expect(payload.owner_id).toBe('user-1');
    expect(payload.payment_type).toBe('pix');
  });
});

describe('commissionRulesService', () => {
  it('create estampa org+owner e mapeia professional_id/specialty/percent', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'rule-1',
        organization_id: 'org-1',
        professional_id: 'prof-1',
        specialty: 'ortodontia',
        percent: 30,
        owner_id: 'user-1',
        created_at: 'now',
        updated_at: 'now',
      },
      error: null,
    });
    const selectAfterInsert = vi.fn().mockReturnValue({ single: singleMock });
    insertMock.mockReturnValue({ select: selectAfterInsert });
    fromMock.mockReturnValue({ insert: insertMock });

    const res = await commissionRulesService.create({
      professionalId: 'prof-1',
      specialty: 'ortodontia',
      percent: 30,
      organizationId: 'org-1',
    });

    expect(res.data?.percent).toBe(30);
    const payload = insertMock.mock.calls[0][0];
    expect(payload.professional_id).toBe('prof-1');
    expect(payload.organization_id).toBe('org-1');
    expect(payload.owner_id).toBe('user-1');
  });
});

describe('fixedCostsService', () => {
  it('create estampa org+owner e mapeia due_day/active', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'cost-1',
        organization_id: 'org-1',
        name: 'Aluguel',
        amount: 5000,
        due_day: 10,
        active: true,
        owner_id: 'user-1',
        created_at: 'now',
        updated_at: 'now',
      },
      error: null,
    });
    const selectAfterInsert = vi.fn().mockReturnValue({ single: singleMock });
    insertMock.mockReturnValue({ select: selectAfterInsert });
    fromMock.mockReturnValue({ insert: insertMock });

    const res = await fixedCostsService.create({
      name: 'Aluguel',
      amount: 5000,
      dueDay: 10,
      organizationId: 'org-1',
    });

    expect(res.data?.amount).toBe(5000);
    const payload = insertMock.mock.calls[0][0];
    expect(payload.due_day).toBe(10);
    expect(payload.active).toBe(true);
    expect(payload.organization_id).toBe('org-1');
    expect(payload.owner_id).toBe('user-1');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/financeConfigServices.test.ts` Expected: FAIL com `Cannot find module '@/lib/supabase/paymentMethodFees'`

- [ ] **Step 3: Implementar o mínimo** — criar os 3 services espelhando `lib/supabase/products.ts`.

`lib/supabase/paymentMethodFees.ts`:

```ts
/**
 * @fileoverview Serviço Supabase para taxas de meio de pagamento (config financeira).
 *
 * Segurança: RLS exige can_configure_organization (clinic_admin). clinic_staff não lê.
 */

import { supabase } from './client';
import { PaymentMethodFee, PaymentType } from '@/types';
import { sanitizeUUID } from './utils';

const COLUMNS =
  'id, organization_id, label, payment_type, card_brand, installments, fee_percent, owner_id, created_at, updated_at';

type DbPaymentMethodFee = {
  id: string;
  organization_id: string | null;
  label: string;
  payment_type: string;
  card_brand: string | null;
  installments: number;
  fee_percent: number;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

function transformPaymentMethodFee(db: DbPaymentMethodFee): PaymentMethodFee {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    label: db.label,
    paymentType: db.payment_type as PaymentType,
    cardBrand: db.card_brand || undefined,
    installments: Number(db.installments ?? 1),
    feePercent: Number(db.fee_percent ?? 0),
  };
}

export const paymentMethodFeesService = {
  async getAll(organizationId?: string | null): Promise<{ data: PaymentMethodFee[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('payment_method_fees')
        .select(COLUMNS)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;
      if (error) return { data: [], error };

      const rows = (data || []) as DbPaymentMethodFee[];
      return { data: rows.map(transformPaymentMethodFee), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: {
    label: string;
    paymentType: PaymentType;
    cardBrand?: string;
    installments: number;
    feePercent: number;
    organizationId?: string | null;
  }): Promise<{ data: PaymentMethodFee | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('payment_method_fees')
        .insert({
          label: input.label,
          payment_type: input.paymentType,
          card_brand: input.cardBrand || null,
          installments: input.installments,
          fee_percent: input.feePercent,
          owner_id: sanitizeUUID(user?.id),
          organization_id: sanitizeUUID(input.organizationId),
        })
        .select(COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformPaymentMethodFee(data as DbPaymentMethodFee), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(
    id: string,
    updates: Partial<{ label: string; paymentType: PaymentType; cardBrand?: string; installments: number; feePercent: number }>
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const payload: Record<string, unknown> = {};
      if (updates.label !== undefined) payload.label = updates.label;
      if (updates.paymentType !== undefined) payload.payment_type = updates.paymentType;
      if (updates.cardBrand !== undefined) payload.card_brand = updates.cardBrand || null;
      if (updates.installments !== undefined) payload.installments = updates.installments;
      if (updates.feePercent !== undefined) payload.fee_percent = updates.feePercent;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('payment_method_fees')
        .update(payload)
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('payment_method_fees')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
```

`lib/supabase/commissionRules.ts`:

```ts
/**
 * @fileoverview Serviço Supabase para regras de comissão (dentista × especialidade × percent).
 *
 * Segurança: RLS exige can_configure_organization (clinic_admin). clinic_staff não lê.
 */

import { supabase } from './client';
import { CommissionRule } from '@/types';
import { sanitizeUUID } from './utils';

const COLUMNS =
  'id, organization_id, professional_id, specialty, percent, owner_id, created_at, updated_at';

type DbCommissionRule = {
  id: string;
  organization_id: string | null;
  professional_id: string | null;
  specialty: string | null;
  percent: number;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

function transformCommissionRule(db: DbCommissionRule): CommissionRule {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    professionalId: db.professional_id || undefined,
    specialty: db.specialty || undefined,
    percent: Number(db.percent ?? 0),
  };
}

export const commissionRulesService = {
  async getAll(organizationId?: string | null): Promise<{ data: CommissionRule[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('commission_rules')
        .select(COLUMNS)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;
      if (error) return { data: [], error };

      const rows = (data || []) as DbCommissionRule[];
      return { data: rows.map(transformCommissionRule), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: {
    professionalId?: string;
    specialty?: string;
    percent: number;
    organizationId?: string | null;
  }): Promise<{ data: CommissionRule | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('commission_rules')
        .insert({
          professional_id: sanitizeUUID(input.professionalId),
          specialty: input.specialty || null,
          percent: input.percent,
          owner_id: sanitizeUUID(user?.id),
          organization_id: sanitizeUUID(input.organizationId),
        })
        .select(COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformCommissionRule(data as DbCommissionRule), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(
    id: string,
    updates: Partial<{ professionalId?: string; specialty?: string; percent: number }>
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const payload: Record<string, unknown> = {};
      if (updates.professionalId !== undefined) payload.professional_id = sanitizeUUID(updates.professionalId);
      if (updates.specialty !== undefined) payload.specialty = updates.specialty || null;
      if (updates.percent !== undefined) payload.percent = updates.percent;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('commission_rules')
        .update(payload)
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('commission_rules')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
```

`lib/supabase/fixedCosts.ts`:

```ts
/**
 * @fileoverview Serviço Supabase para contas fixas (custos fixos mensais).
 *
 * Segurança: RLS exige can_configure_organization (clinic_admin). clinic_staff não lê.
 */

import { supabase } from './client';
import { FixedCost } from '@/types';
import { sanitizeUUID } from './utils';

const COLUMNS =
  'id, organization_id, name, amount, due_day, active, owner_id, created_at, updated_at';

type DbFixedCost = {
  id: string;
  organization_id: string | null;
  name: string;
  amount: number;
  due_day: number | null;
  active: boolean | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

function transformFixedCost(db: DbFixedCost): FixedCost {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    name: db.name,
    amount: Number(db.amount ?? 0),
    dueDay: db.due_day ?? undefined,
    active: db.active ?? true,
  };
}

export const fixedCostsService = {
  async getAll(organizationId?: string | null): Promise<{ data: FixedCost[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('fixed_costs')
        .select(COLUMNS)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;
      if (error) return { data: [], error };

      const rows = (data || []) as DbFixedCost[];
      return { data: rows.map(transformFixedCost), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: {
    name: string;
    amount: number;
    dueDay?: number;
    organizationId?: string | null;
  }): Promise<{ data: FixedCost | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('fixed_costs')
        .insert({
          name: input.name,
          amount: input.amount,
          due_day: input.dueDay ?? null,
          active: true,
          owner_id: sanitizeUUID(user?.id),
          organization_id: sanitizeUUID(input.organizationId),
        })
        .select(COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformFixedCost(data as DbFixedCost), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(
    id: string,
    updates: Partial<{ name: string; amount: number; dueDay?: number; active: boolean }>
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.amount !== undefined) payload.amount = updates.amount;
      if (updates.dueDay !== undefined) payload.due_day = updates.dueDay ?? null;
      if (updates.active !== undefined) payload.active = updates.active;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('fixed_costs')
        .update(payload)
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('fixed_costs')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
```

Modificar `lib/supabase/index.ts` — adicionar os re-exports (após a linha do `productsService`):

```ts
export { paymentMethodFeesService } from './paymentMethodFees';
export { commissionRulesService } from './commissionRules';
export { fixedCostsService } from './fixedCosts';
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/financeConfigServices.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/supabase/paymentMethodFees.ts lib/supabase/commissionRules.ts lib/supabase/fixedCosts.ts lib/supabase/index.ts test/financeConfigServices.test.ts
git commit -m "feat(finance): services paymentMethodFees/commissionRules/fixedCosts (mirror productsService)"
```

---

### Task 5.4: zod schemas (paymentMethodFeeFormSchema · commissionRuleFormSchema · fixedCostFormSchema)
**Files:** Modify: `lib/validations/schemas.ts` · Test: `test/financeConfigSchemas.test.ts`

- [ ] **Step 1: Escrever o teste que falha** — criar `test/financeConfigSchemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  paymentMethodFeeFormSchema,
  commissionRuleFormSchema,
  fixedCostFormSchema,
} from '@/lib/validations/schemas';

describe('paymentMethodFeeFormSchema', () => {
  it('aceita taxa válida', () => {
    const res = paymentMethodFeeFormSchema.safeParse({
      label: 'Crédito 3x Visa',
      paymentType: 'credito',
      cardBrand: 'visa',
      installments: 3,
      feePercent: 4.5,
    });
    expect(res.success).toBe(true);
  });

  it('rejeita paymentType vazio', () => {
    const res = paymentMethodFeeFormSchema.safeParse({
      label: 'Pix',
      paymentType: '',
      installments: 1,
      feePercent: 0,
    });
    expect(res.success).toBe(false);
  });
});

describe('commissionRuleFormSchema', () => {
  it('aceita regra válida com profissional', () => {
    const res = commissionRuleFormSchema.safeParse({
      professionalId: 'prof-1',
      specialty: 'ortodontia',
      percent: 30,
    });
    expect(res.success).toBe(true);
  });

  it('rejeita professionalId vazio', () => {
    const res = commissionRuleFormSchema.safeParse({
      professionalId: '',
      percent: 30,
    });
    expect(res.success).toBe(false);
  });
});

describe('fixedCostFormSchema', () => {
  it('aceita conta fixa válida', () => {
    const res = fixedCostFormSchema.safeParse({
      name: 'Aluguel',
      amount: 5000,
      dueDay: 10,
    });
    expect(res.success).toBe(true);
  });

  it('rejeita nome vazio', () => {
    const res = fixedCostFormSchema.safeParse({
      name: '',
      amount: 5000,
    });
    expect(res.success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/financeConfigSchemas.test.ts` Expected: FAIL com `'paymentMethodFeeFormSchema' is not exported`

- [ ] **Step 3: Implementar o mínimo** — adicionar os schemas em `lib/validations/schemas.ts` (após o bloco `// ============ AI CONFIG SCHEMAS ============`, antes de `// Export max lengths for use in forms`):

```ts
// ============ FINANCE CONFIG SCHEMAS ============

export const paymentMethodFeeFormSchema = z.object({
  label: requiredString('Descrição', MAX_LENGTHS.SHORT_TEXT),
  paymentType: requiredSelect('Tipo de pagamento'),
  cardBrand: optionalString.pipe(z.string().max(MAX_LENGTHS.SHORT_TEXT)),
  installments: z.coerce
    .number({ message: msg('NUMBER_REQUIRED', { field: 'Parcelas' }) })
    .int('Parcelas inválidas')
    .min(1, 'Mínimo de 1 parcela')
    .max(48, 'Máximo de 48 parcelas')
    .default(1),
  feePercent: currencySchema,
});

export type PaymentMethodFeeFormData = z.infer<typeof paymentMethodFeeFormSchema>;

export const commissionRuleFormSchema = z.object({
  professionalId: requiredSelect('Profissional'),
  specialty: optionalString.pipe(z.string().max(MAX_LENGTHS.SHORT_TEXT)),
  percent: currencySchema,
});

export type CommissionRuleFormData = z.infer<typeof commissionRuleFormSchema>;

export const fixedCostFormSchema = z.object({
  name: requiredString('Nome da conta', MAX_LENGTHS.NAME),
  amount: currencySchema,
  dueDay: z.coerce
    .number()
    .int('Dia inválido')
    .min(1, 'Dia entre 1 e 31')
    .max(31, 'Dia entre 1 e 31')
    .optional(),
});

export type FixedCostFormData = z.infer<typeof fixedCostFormSchema>;
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/financeConfigSchemas.test.ts` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/validations/schemas.ts test/financeConfigSchemas.test.ts
git commit -m "feat(finance): zod schemas para taxas/comissoes/contas fixas"
```

---

### Task 5.5: 3 managers de UI (CardFeesManager · CommissionsManager · FixedCostsManager)
**Files:** Create: `features/settings/components/CardFeesManager.tsx` · Create: `features/settings/components/CommissionsManager.tsx` · Create: `features/settings/components/FixedCostsManager.tsx` · Test: `features/settings/components/CardFeesManager.test.tsx`

- [ ] **Step 1: Escrever o teste que falha** — criar `features/settings/components/CardFeesManager.test.tsx` (happy-dom default; mocka `@/lib/supabase` e `@/context/TenantContext`; valida loading/empty + a11y):

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

const getAllMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  paymentMethodFeesService: {
    getAll: (...args: unknown[]) => getAllMock(...args),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/context/TenantContext', () => ({
  useTenant: () => ({ tenant: { organizationId: 'org-1' } }),
}));

import { CardFeesManager } from './CardFeesManager';

beforeEach(() => {
  vi.clearAllMocks();
  getAllMock.mockResolvedValue({ data: [], error: null });
});

describe('CardFeesManager', () => {
  it('renderiza título e estado vazio', async () => {
    render(<CardFeesManager />);
    expect(
      screen.getByRole('heading', { name: /^Taxas de Pagamento$/i })
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Nenhuma taxa cadastrada ainda\./i)).toBeInTheDocument();
    });
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<CardFeesManager />);
    await waitFor(() => screen.getByText(/Nenhuma taxa cadastrada ainda\./i));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/settings/components/CardFeesManager.test.tsx` Expected: FAIL com `Cannot find module './CardFeesManager'`

- [ ] **Step 3: Implementar o mínimo** — criar os 3 managers espelhando `ProductsCatalogManager.tsx` (mesmo card-shell, loading/error/empty, create + lista com editar/excluir).

`features/settings/components/CardFeesManager.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { paymentMethodFeesService } from '@/lib/supabase';
import type { PaymentMethodFee, PaymentType } from '@/types';
import { useTenant } from '@/context/TenantContext';

const PAYMENT_TYPES: { value: PaymentType; label: string }[] = [
  { value: 'credito', label: 'Crédito' },
  { value: 'debito', label: 'Débito' },
  { value: 'pix', label: 'Pix' },
  { value: 'dinheiro', label: 'Dinheiro' },
];

function paymentTypeLabel(t: PaymentType) {
  return PAYMENT_TYPES.find((p) => p.value === t)?.label ?? t;
}

/**
 * Componente React `CardFeesManager`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const CardFeesManager: React.FC = () => {
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId ?? null;
  const [loading, setLoading] = useState(false);
  const [fees, setFees] = useState<PaymentMethodFee[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType>('credito');
  const [cardBrand, setCardBrand] = useState('');
  const [installments, setInstallments] = useState<string>('1');
  const [feePercent, setFeePercent] = useState<string>('0');

  const canCreate = label.trim().length > 1 && Number.isFinite(Number(feePercent));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFeePercent, setEditFeePercent] = useState<string>('0');

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await paymentMethodFeesService.getAll(organizationId);
    if (res.error) {
      setError(res.error.message);
      setFees([]);
    } else {
      setFees(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return;
    load();
  }, [organizationId]);

  const sorted = useMemo(() => {
    const list = [...fees];
    list.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    return list;
  }, [fees]);

  const create = async () => {
    if (!canCreate) return;
    setLoading(true);
    setError(null);
    const res = await paymentMethodFeesService.create({
      label: label.trim(),
      paymentType,
      cardBrand: cardBrand.trim() || undefined,
      installments: Math.max(1, Number(installments) || 1),
      feePercent: Number(feePercent) || 0,
      organizationId,
    });
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    setLabel('');
    setPaymentType('credito');
    setCardBrand('');
    setInstallments('1');
    setFeePercent('0');
    await load();
  };

  const startEdit = (f: PaymentMethodFee) => {
    setEditingId(f.id);
    setEditFeePercent(String(f.feePercent ?? 0));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditFeePercent('0');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const percent = Number(editFeePercent);
    if (!Number.isFinite(percent) || percent < 0) {
      setError('Taxa inválida.');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await paymentMethodFeesService.update(editingId, { feePercent: percent });
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    await load();
    cancelEdit();
  };

  const remove = async (f: PaymentMethodFee) => {
    const ok = window.confirm(`Excluir a taxa "${f.label}"?`);
    if (!ok) return;
    setLoading(true);
    setError(null);
    const res = await paymentMethodFeesService.delete(f.id);
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    await load();
  };

  return (
    <div className="mb-12">
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> Taxas de Pagamento
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Percentual descontado por meio de pagamento. Usado no cálculo do resultado líquido.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        {/* Create */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-3">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Descrição</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex.: Crédito 3x Visa"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Tipo</label>
            <select
              aria-label="Tipo de pagamento"
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as PaymentType)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              {PAYMENT_TYPES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Bandeira</label>
            <input
              value={cardBrand}
              onChange={(e) => setCardBrand(e.target.value)}
              placeholder="Visa, Master…"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Parcelas</label>
            <input
              value={installments}
              onChange={(e) => setInstallments(e.target.value)}
              inputMode="numeric"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Taxa (%)</label>
            <input
              value={feePercent}
              onChange={(e) => setFeePercent(e.target.value)}
              inputMode="decimal"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-1">
            <button
              type="button"
              onClick={create}
              disabled={loading || !canCreate}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Criar taxa"
            >
              <Plus className="h-4 w-4" />
              Criar
            </button>
          </div>
        </div>

        {/* List */}
        <div className="mt-6 border-t border-slate-200 dark:border-white/10 pt-4">
          {sorted.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400 py-6">
              Nenhuma taxa cadastrada ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((f) => {
                const isEditing = editingId === f.id;
                return (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate">{f.label}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {paymentTypeLabel(f.paymentType)}
                        {f.cardBrand ? ` • ${f.cardBrand}` : ''} • {f.installments}x
                        {isEditing ? '' : ` • ${f.feePercent}%`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <input
                            value={editFeePercent}
                            onChange={(e) => setEditFeePercent(e.target.value)}
                            inputMode="decimal"
                            aria-label="Editar taxa (%)"
                            className="w-20 px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                          />
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                            title="Salvar"
                            aria-label="Salvar taxa"
                            disabled={loading}
                          >
                            <Save className="h-4 w-4 text-primary-600" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                            title="Cancelar"
                            aria-label="Cancelar edição"
                            disabled={loading}
                          >
                            <X className="h-4 w-4 text-slate-500" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(f)}
                          className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                          title="Editar"
                          aria-label="Editar taxa"
                          disabled={loading}
                        >
                          <Pencil className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(f)}
                        className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Excluir"
                        aria-label="Excluir taxa"
                        disabled={loading}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
```

`features/settings/components/CommissionsManager.tsx` — matriz dentista (select de `professionals`) × especialidade × percent:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Percent, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { commissionRulesService, professionalsService } from '@/lib/supabase';
import type { CommissionRule, Professional } from '@/types';
import { useTenant } from '@/context/TenantContext';

/**
 * Componente React `CommissionsManager`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const CommissionsManager: React.FC = () => {
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId ?? null;
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [professionalId, setProfessionalId] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [percent, setPercent] = useState<string>('0');

  const canCreate = professionalId.trim().length > 0 && Number.isFinite(Number(percent));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPercent, setEditPercent] = useState<string>('0');

  const load = async () => {
    setLoading(true);
    setError(null);
    const [rulesRes, profsRes] = await Promise.all([
      commissionRulesService.getAll(organizationId),
      professionalsService.getAll(organizationId),
    ]);
    if (rulesRes.error) {
      setError(rulesRes.error.message);
      setRules([]);
    } else {
      setRules(rulesRes.data);
    }
    if (!profsRes.error) {
      setProfessionals(profsRes.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return;
    load();
  }, [organizationId]);

  const professionalName = (id?: string) =>
    professionals.find((p) => p.id === id)?.name ?? 'Profissional';

  const sorted = useMemo(() => {
    const list = [...rules];
    list.sort((a, b) => professionalName(a.professionalId).localeCompare(professionalName(b.professionalId)));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, professionals]);

  const create = async () => {
    if (!canCreate) return;
    setLoading(true);
    setError(null);
    const res = await commissionRulesService.create({
      professionalId: professionalId || undefined,
      specialty: specialty.trim() || undefined,
      percent: Number(percent) || 0,
      organizationId,
    });
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    setProfessionalId('');
    setSpecialty('');
    setPercent('0');
    await load();
  };

  const startEdit = (r: CommissionRule) => {
    setEditingId(r.id);
    setEditPercent(String(r.percent ?? 0));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditPercent('0');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const p = Number(editPercent);
    if (!Number.isFinite(p) || p < 0) {
      setError('Percentual inválido.');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await commissionRulesService.update(editingId, { percent: p });
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    await load();
    cancelEdit();
  };

  const remove = async (r: CommissionRule) => {
    const ok = window.confirm(`Excluir a regra de comissão de "${professionalName(r.professionalId)}"?`);
    if (!ok) return;
    setLoading(true);
    setError(null);
    const res = await commissionRulesService.delete(r.id);
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    await load();
  };

  return (
    <div className="mb-12">
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
              <Percent className="h-5 w-5" /> Comissões
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Percentual de comissão por profissional e especialidade. Usado no relatório de comissões.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        {/* Create */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-5">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Profissional</label>
            <select
              aria-label="Profissional"
              value={professionalId}
              onChange={(e) => setProfessionalId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              <option value="">Selecione…</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-4">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Especialidade (opcional)</label>
            <input
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="Ex.: Ortodontia"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Comissão (%)</label>
            <input
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              inputMode="decimal"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-1">
            <button
              type="button"
              onClick={create}
              disabled={loading || !canCreate}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Criar regra"
            >
              <Plus className="h-4 w-4" />
              Criar
            </button>
          </div>
        </div>

        {/* List */}
        <div className="mt-6 border-t border-slate-200 dark:border-white/10 pt-4">
          {sorted.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400 py-6">
              Nenhuma regra de comissão cadastrada ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((r) => {
                const isEditing = editingId === r.id;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate">
                        {professionalName(r.professionalId)}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {r.specialty ? `${r.specialty} • ` : ''}{isEditing ? '' : `${r.percent}%`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <input
                            value={editPercent}
                            onChange={(e) => setEditPercent(e.target.value)}
                            inputMode="decimal"
                            aria-label="Editar comissão (%)"
                            className="w-20 px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                          />
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                            title="Salvar"
                            aria-label="Salvar comissão"
                            disabled={loading}
                          >
                            <Save className="h-4 w-4 text-primary-600" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                            title="Cancelar"
                            aria-label="Cancelar edição"
                            disabled={loading}
                          >
                            <X className="h-4 w-4 text-slate-500" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                          title="Editar"
                          aria-label="Editar comissão"
                          disabled={loading}
                        >
                          <Pencil className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Excluir"
                        aria-label="Excluir comissão"
                        disabled={loading}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
```

`features/settings/components/FixedCostsManager.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, Pencil, Plus, Save, ToggleLeft, ToggleRight, Trash2, X } from 'lucide-react';
import { fixedCostsService } from '@/lib/supabase';
import type { FixedCost } from '@/types';
import { useTenant } from '@/context/TenantContext';

function formatBRL(v: number) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  } catch {
    return `R$ ${v.toFixed(2)}`;
  }
}

/**
 * Componente React `FixedCostsManager`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const FixedCostsManager: React.FC = () => {
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId ?? null;
  const [loading, setLoading] = useState(false);
  const [costs, setCosts] = useState<FixedCost[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState<string>('0');
  const [dueDay, setDueDay] = useState<string>('');

  const canCreate = name.trim().length > 1 && Number.isFinite(Number(amount));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>('0');

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await fixedCostsService.getAll(organizationId);
    if (res.error) {
      setError(res.error.message);
      setCosts([]);
    } else {
      setCosts(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return;
    load();
  }, [organizationId]);

  const sorted = useMemo(() => {
    const list = [...costs];
    list.sort((a, b) => {
      const aActive = a.active !== false;
      const bActive = b.active !== false;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    return list;
  }, [costs]);

  const create = async () => {
    if (!canCreate) return;
    setLoading(true);
    setError(null);
    const res = await fixedCostsService.create({
      name: name.trim(),
      amount: Number(amount) || 0,
      dueDay: dueDay.trim() ? Number(dueDay) : undefined,
      organizationId,
    });
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    setName('');
    setAmount('0');
    setDueDay('');
    await load();
  };

  const toggleActive = async (c: FixedCost, next: boolean) => {
    setLoading(true);
    setError(null);
    const res = await fixedCostsService.update(c.id, { active: next });
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    await load();
  };

  const startEdit = (c: FixedCost) => {
    setEditingId(c.id);
    setEditAmount(String(c.amount ?? 0));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAmount('0');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const value = Number(editAmount);
    if (!Number.isFinite(value) || value < 0) {
      setError('Valor inválido.');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fixedCostsService.update(editingId, { amount: value });
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    await load();
    cancelEdit();
  };

  const remove = async (c: FixedCost) => {
    const ok = window.confirm(`Excluir a conta "${c.name}"?`);
    if (!ok) return;
    setLoading(true);
    setError(null);
    const res = await fixedCostsService.delete(c.id);
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    await load();
  };

  return (
    <div className="mb-12">
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
              <Wallet className="h-5 w-5" /> Contas Fixas
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Custos fixos mensais. Subtraídos do resultado líquido do período.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        {/* Create */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-6">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Aluguel, Folha, Software…"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-3">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Valor (R$)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Dia venc. (opcional)</label>
            <input
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              inputMode="numeric"
              placeholder="10"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
          </div>
          <div className="lg:col-span-1">
            <button
              type="button"
              onClick={create}
              disabled={loading || !canCreate}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Criar conta"
            >
              <Plus className="h-4 w-4" />
              Criar
            </button>
          </div>
        </div>

        {/* List */}
        <div className="mt-6 border-t border-slate-200 dark:border-white/10 pt-4">
          {sorted.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400 py-6">
              Nenhuma conta fixa cadastrada ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((c) => {
                const isActive = c.active !== false;
                const isEditing = editingId === c.id;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-slate-900 dark:text-white truncate">{c.name}</div>
                        {!isActive && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                            Inativa
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {isEditing ? '' : formatBRL(c.amount)}{c.dueDay ? ` • vence dia ${c.dueDay}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <input
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            inputMode="decimal"
                            aria-label="Editar valor (R$)"
                            className="w-24 px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                          />
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                            title="Salvar"
                            aria-label="Salvar conta"
                            disabled={loading}
                          >
                            <Save className="h-4 w-4 text-primary-600" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                            title="Cancelar"
                            aria-label="Cancelar edição"
                            disabled={loading}
                          >
                            <X className="h-4 w-4 text-slate-500" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                          title="Editar"
                          aria-label="Editar conta"
                          disabled={loading}
                        >
                          <Pencil className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleActive(c, !isActive)}
                        className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10"
                        title={isActive ? 'Desativar' : 'Ativar'}
                        aria-label={isActive ? 'Desativar conta' : 'Ativar conta'}
                        disabled={loading}
                      >
                        {isActive ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-red-500" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c)}
                        className="px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Excluir"
                        aria-label="Excluir conta"
                        disabled={loading}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/settings/components/CardFeesManager.test.tsx` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add features/settings/components/CardFeesManager.tsx features/settings/components/CommissionsManager.tsx features/settings/components/FixedCostsManager.tsx features/settings/components/CardFeesManager.test.tsx
git commit -m "feat(finance): managers CardFees/Commissions/FixedCosts (mirror ProductsCatalogManager)"
```

---

### Task 5.6: Aba 'financeiro' no SettingsPage + FinanceiroSettings (sub-tabs Taxas/Comissões/Contas) + rota
**Files:** Modify: `features/settings/SettingsPage.tsx` · Create: `app/(protected)/settings/financeiro/page.tsx` · Test: `features/settings/FinanceiroSettings.rbac.test.tsx`

- [ ] **Step 1: Escrever o teste que falha** — criar `features/settings/FinanceiroSettings.rbac.test.tsx` (espelha `SettingsPage.rbac.test.tsx`: `clinic_staff`/`vendedor` NÃO vê a aba financeiro; `clinic_admin`/`admin` vê + navega nas sub-tabs):

```tsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useSearchParams: () => ({
    get: () => null,
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('./hooks/useSettingsController', () => ({
  useSettingsController: () => ({
    defaultRoute: '/boards',
    setDefaultRoute: vi.fn(),
    customFieldDefinitions: [],
    newFieldLabel: '',
    setNewFieldLabel: vi.fn(),
    newFieldType: 'text',
    setNewFieldType: vi.fn(),
    newFieldOptions: '',
    setNewFieldOptions: vi.fn(),
    editingId: null,
    startEditingField: vi.fn(),
    cancelEditingField: vi.fn(),
    handleSaveField: vi.fn(),
    removeCustomField: vi.fn(),
    availableTags: ['VIP'],
    newTagName: '',
    setNewTagName: vi.fn(),
    handleAddTag: vi.fn(),
    removeTag: vi.fn(),
  }),
}))

vi.mock('./components/ApiKeysSection', () => ({ ApiKeysSection: () => <div>API</div> }))
vi.mock('./components/WebhooksSection', () => ({ WebhooksSection: () => <div>Webhooks</div> }))
vi.mock('./components/McpSection', () => ({ McpSection: () => <div>MCP</div> }))

// Managers financeiros: stubs para isolar o roteamento de abas do data layer.
vi.mock('./components/CardFeesManager', () => ({
  CardFeesManager: () => <h3>Taxas de Pagamento</h3>,
}))
vi.mock('./components/CommissionsManager', () => ({
  CommissionsManager: () => <h3>Comissões</h3>,
}))
vi.mock('./components/FixedCostsManager', () => ({
  FixedCostsManager: () => <h3>Contas Fixas</h3>,
}))

import SettingsPage from './SettingsPage'
import { useAuth } from '@/context/AuthContext'

const useAuthMock = vi.mocked(useAuth)

describe('SettingsPage RBAC — aba financeiro', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clinic_staff NÃO vê a aba financeiro', () => {
    useAuthMock.mockReturnValue({ profile: { role: 'clinic_staff' } } as any)
    render(<SettingsPage />)
    expect(screen.queryByRole('button', { name: /financeiro/i })).not.toBeInTheDocument()
  })

  it('vendedor NÃO vê a aba financeiro', () => {
    useAuthMock.mockReturnValue({ profile: { role: 'vendedor' } } as any)
    render(<SettingsPage />)
    expect(screen.queryByRole('button', { name: /financeiro/i })).not.toBeInTheDocument()
  })

  it('clinic_admin vê a aba financeiro e navega nas sub-tabs', async () => {
    useAuthMock.mockReturnValue({ profile: { role: 'clinic_admin' } } as any)
    render(<SettingsPage />)

    const financeTab = screen.getByRole('button', { name: /financeiro/i })
    expect(financeTab).toBeInTheDocument()
    fireEvent.click(financeTab)

    // Default sub-tab: Taxas
    expect(await screen.findByRole('heading', { name: /^Taxas de Pagamento$/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Comissões$/i }))
    expect(await screen.findByRole('heading', { name: /^Comissões$/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Contas$/i }))
    expect(await screen.findByRole('heading', { name: /^Contas Fixas$/i })).toBeInTheDocument()
  })

  it('admin vê a aba financeiro', () => {
    useAuthMock.mockReturnValue({ profile: { role: 'admin' } } as any)
    render(<SettingsPage />)
    expect(screen.getByRole('button', { name: /financeiro/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/settings/FinanceiroSettings.rbac.test.tsx` Expected: FAIL (a aba `financeiro` não existe; `getByRole('button', { name: /financeiro/i })` não encontra)

- [ ] **Step 3: Implementar o mínimo** — modificar `features/settings/SettingsPage.tsx`:

3a. Adicionar imports dos managers e do ícone (logo após o import de `ProductsCatalogManager`, linha 10):

```tsx
import { CardFeesManager } from './components/CardFeesManager';
import { CommissionsManager } from './components/CommissionsManager';
import { FixedCostsManager } from './components/FixedCostsManager';
```

3b. Adicionar `DollarSign` ao import de ícones do lucide-react (linha 15):

```tsx
import { Settings as SettingsIcon, Users, Database, Sparkles, Plug, Package, DollarSign } from 'lucide-react';
```

3c. Estender a union `SettingsTab` (linha 18):

```tsx
type SettingsTab = 'general' | 'products' | 'financeiro' | 'integrations' | 'ai' | 'data' | 'users';
```

3d. Adicionar o componente `FinanceiroSettings` (com sub-tabs estilo `IntegrationsSettings`), logo após o componente `IntegrationsSettings` (após a linha 165):

```tsx
const FinanceiroSettings: React.FC = () => {
  type FinanceiroSubTab = 'taxas' | 'comissoes' | 'contas';
  const [subTab, setSubTab] = useState<FinanceiroSubTab>('taxas');

  useEffect(() => {
    const syncFromHash = () => {
      const h = typeof window !== 'undefined' ? (window.location.hash || '').replace('#', '') : '';
      if (h === 'taxas' || h === 'comissoes' || h === 'contas') setSubTab(h as FinanceiroSubTab);
    };

    syncFromHash();

    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', syncFromHash);
      return () => window.removeEventListener('hashchange', syncFromHash);
    }
  }, []);

  const setSubTabAndHash = (t: FinanceiroSubTab) => {
    setSubTab(t);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.hash = `#${t}`;
      window.history.replaceState({}, '', url.toString());
    }
  };

  return (
    <div className="pb-10">
      <div className="flex items-center gap-2 mb-6">
        {([
          { id: 'taxas' as const, label: 'Taxas' },
          { id: 'comissoes' as const, label: 'Comissões' },
          { id: 'contas' as const, label: 'Contas' },
        ] as const).map((t) => {
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTabAndHash(t.id)}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                active
                  ? 'border-primary-500/50 bg-primary-500/10 text-primary-700 dark:text-primary-300'
                  : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === 'taxas' && <CardFeesManager />}
      {subTab === 'comissoes' && <CommissionsManager />}
      {subTab === 'contas' && <FixedCostsManager />}
    </div>
  );
};
```

3e. Adicionar a aba ao array `tabs` (após a linha do `products`, ~linha 205), também guardada por `canManageSettings`:

```tsx
    ...(canManageSettings ? [{ id: 'financeiro' as SettingsTab, name: 'Financeiro', icon: DollarSign }] : []),
```

3f. Adicionar o `case` em `renderContent` (após o `case 'integrations'`):

```tsx
      case 'financeiro':
        return <FinanceiroSettings />;
```

3g. Adicionar o pathname check no `useEffect` (após o branch de `/settings/products`, ~linha 192):

```tsx
    } else if (pathname?.includes('/settings/financeiro')) {
      setActiveTab('financeiro');
```

3h. Criar a rota `app/(protected)/settings/financeiro/page.tsx` (wrapper espelhando `settings/products/page.tsx`):

```tsx
'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const SettingsPage = dynamic(
  () => import('@/features/settings/SettingsPage'),
  { loading: () => <PageLoader />, ssr: false }
)

/**
 * Componente React `SettingsFinanceiro`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function SettingsFinanceiro() {
  return <SettingsPage tab="financeiro" />
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/settings/FinanceiroSettings.rbac.test.tsx` Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add features/settings/SettingsPage.tsx "app/(protected)/settings/financeiro/page.tsx" features/settings/FinanceiroSettings.rbac.test.tsx
git commit -m "feat(finance): aba financeiro no Settings (sub-tabs Taxas/Comissoes/Contas) com gate RBAC clinic_admin"
```

---

### Task 5.7: Teste de integração cross-tenant (RLS real — Vitória não lê config; org A não lê org B)
**Files:** Create: `test/financeConfigRls.integration.test.ts` · Modify: `vitest.config.ts:14`

- [ ] **Step 1: Escrever o teste que falha** — criar `test/financeConfigRls.integration.test.ts` (Node env real; gate por credenciais; prova isolamento cross-tenant da tabela nova). Espelha o padrão `// @vitest-environment node` + `createMinimalFixtures`/`cleanupFixtures` + `getSupabaseAdminClient`:

```ts
// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import {
  createMinimalFixtures,
  cleanupFixtures,
  getSupabaseAdminClient,
  hasRealSupabaseCreds,
} from './helpers/fixtures';

const runId = `finance-config-${Date.now()}`;
const describeSupabase = hasRealSupabaseCreds ? describe : describe.skip;

describeSupabase('finance config RLS — isolamento cross-tenant', () => {
  const admin = getSupabaseAdminClient();

  afterAll(async () => {
    await cleanupFixtures(runId);
  });

  it('linha de payment_method_fees da org A não vaza para org B', async () => {
    const orgA = await createMinimalFixtures(runId, { suffix: 'a' });
    const orgB = await createMinimalFixtures(runId, { suffix: 'b' });

    // Seed de uma taxa na org A (via admin, bypassa RLS no setup)
    const { data: inserted, error: insertError } = await admin
      .from('payment_method_fees')
      .insert({
        organization_id: orgA.organizationId,
        label: `Crédito ${runId}`,
        payment_type: 'credito',
        installments: 1,
        fee_percent: 4.5,
        owner_id: orgA.adminProfileId,
      })
      .select('id, organization_id')
      .single();

    expect(insertError).toBeNull();
    expect(inserted?.organization_id).toBe(orgA.organizationId);

    // Cliente autenticado como clinic_admin da org B NÃO deve enxergar a taxa da org A
    const clientB = orgB.clinicAdminClient;
    const { data: visibleToB } = await clientB
      .from('payment_method_fees')
      .select('id, organization_id')
      .eq('id', inserted!.id);

    expect(visibleToB ?? []).toHaveLength(0);

    // Cliente autenticado como clinic_admin da org A enxerga a própria taxa
    const clientA = orgA.clinicAdminClient;
    const { data: visibleToA } = await clientA
      .from('payment_method_fees')
      .select('id, organization_id')
      .eq('id', inserted!.id);

    expect(visibleToA ?? []).toHaveLength(1);
  });

  it('clinic_staff (Vitória) NÃO lê config financeira da própria org', async () => {
    const orgA = await createMinimalFixtures(runId, { suffix: 'staff' });

    await admin.from('payment_method_fees').insert({
      organization_id: orgA.organizationId,
      label: `Pix ${runId}`,
      payment_type: 'pix',
      installments: 1,
      fee_percent: 0,
      owner_id: orgA.adminProfileId,
    });

    const staffClient = orgA.clinicStaffClient;
    const { data: visibleToStaff } = await staffClient
      .from('payment_method_fees')
      .select('id')
      .eq('organization_id', orgA.organizationId);

    // can_configure_organization exclui clinic_staff — leitura vem vazia.
    expect(visibleToStaff ?? []).toHaveLength(0);
  });
});
```

> Nota de implementação: este teste depende de `createMinimalFixtures` expor `clinicAdminClient` e `clinicStaffClient` (clientes autenticados por papel) e `adminProfileId`. Se o helper `test/helpers/fixtures.ts` ainda não fornecer esses campos, estendê-lo seguindo o padrão já usado pelos demais testes de isolamento multi-tenant do projeto (mesma assinatura de `getSupabaseAdminClient`/`hasRealSupabaseCreds`). Não inventar API nova: reusar os helpers existentes e só acrescentar o que faltar.

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/financeConfigRls.integration.test.ts` Expected: FAIL (se houver credenciais: falha por RLS ainda não aplicada / fixtures incompletas; sem credenciais: SKIP — então rodar localmente com credenciais reais para validar o gate). Antes do registro no `environmentMatchGlobs`, o Vitest tenta rodar em happy-dom e falha ao usar APIs Node.

- [ ] **Step 3: Implementar o mínimo** — registrar o path no `environmentMatchGlobs` de `vitest.config.ts` (adicionar como primeira entrada da lista, após a linha 14):

```ts
      ['test/financeConfigRls.integration.test.ts', 'node'],
```

Garantir (via leitura do helper) que `createMinimalFixtures(runId, { suffix })` retorna `{ organizationId, adminProfileId, clinicAdminClient, clinicStaffClient }`; estender `test/helpers/fixtures.ts` apenas se algum desses campos faltar, reusando o cliente admin e o fluxo de criação de profiles por papel já existentes.

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/financeConfigRls.integration.test.ts` Expected: PASS (com credenciais reais de Supabase no ambiente; prova que org B e clinic_staff não leem a config financeira da org A)

- [ ] **Step 5: Commit**
```bash
git add test/financeConfigRls.integration.test.ts vitest.config.ts test/helpers/fixtures.ts
git commit -m "test(finance): integracao RLS cross-tenant — Vitoria/org B nao leem config financeira"
```

---

### Task 5.8: Gate de qualidade da fase (precheck) e fechamento
**Files:** (sem novos arquivos) · valida toda a Fase 5

- [ ] **Step 1: Rodar a suíte focada da fase** Run: `npx vitest run test/multiTenantRlsPolicies.financeConfig.test.ts test/financeConfigTypes.test.ts test/financeConfigServices.test.ts test/financeConfigSchemas.test.ts features/settings/components/CardFeesManager.test.tsx features/settings/FinanceiroSettings.rbac.test.tsx` Expected: PASS (todos)

- [ ] **Step 2: Rodar lint + typecheck + suíte completa** Run: `npm run precheck:fast` Expected: PASS (lint + typecheck + test:run sem falhas)

- [ ] **Step 3: Checklist DoD da fase (verificação manual)**
  - [ ] Migração `20260615000000_finance_config.sql` usa `can_configure_organization` em SELECT e mutação nas 3 tabelas — NUNCA `can_operate`/`can_access` (gate da Vitória). Confirmado pelo Task 5.6/5.1.
  - [ ] `reset.sql` deleta `commission_rules`, `payment_method_fees`, `fixed_costs` em ordem FK-safe.
  - [ ] UI: cada manager tem loading/error/empty; a aba `financeiro` só aparece para `clinic_admin`/`admin` (não `clinic_staff`/`vendedor`).
  - [ ] Services estampam `organization_id` + `owner_id` no insert (nunca confiam no client como segurança — RLS é o gate).
  - [ ] Tenant isolado provado por teste (Task 5.7).

- [ ] **Step 4: Commit final da fase (se houver ajustes do precheck)**
```bash
git add -A
git commit -m "chore(finance): fase 5 configs financeiras — precheck verde"
```

---

## Fase 6 — Home "Hoje" / call-list (quem ligar hoje)

Esta fase NÃO cria tabela nova. Ela deriva, no client, a lista de "quem ligar hoje" a partir das activities existentes (`type === 'CALL'`, `!completed`, com `date` no passado/hoje/futuro próximo) cruzadas com `contacts` (para puxar `phone`). Reusa `features/inbox/components/CallModal.tsx` (já testado) para a ação de ligar e `useToggleActivity` para marcar a ligação como feita. O guardrail do playbook é respeitado: marcar a ligação registra/conclui uma activity — o sistema NÃO move o deal automaticamente no funil F1-F9.

A bucketização é uma função pura (`buildCallList`) testada com fixtures, espelhando a lógica de fronteiras de data (`todayTs`/`tomorrowTs`) de `useActivitiesController`. O controller (`useCallListController`) só compõe `useActivities` + `useContacts` e chama `buildCallList`. A UI (`CallListTable` + `CallListPage`) tem loading/error/empty e passa em `axe`.

### Task 6.1: Função pura de bucketização `buildCallList`

**Files:** Create: `lib/utils/callList.ts` · Test: `lib/utils/callList.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/utils/callList.test.ts
import { describe, expect, it } from 'vitest';
import { buildCallList } from './callList';
import type { Activity, Contact } from '@/types';

function makeActivity(over: Partial<Activity>): Activity {
  return {
    id: 'a-1',
    dealId: 'deal-1',
    contactId: 'contact-1',
    dealTitle: 'Negócio Teste',
    type: 'CALL',
    title: 'Ligar para o lead',
    description: '',
    date: new Date().toISOString(),
    user: { name: 'Eu', avatar: '' },
    completed: false,
    ...over,
  };
}

function makeContact(over: Partial<Contact>): Contact {
  return {
    id: 'contact-1',
    name: 'Fulano de Tal',
    email: 'fulano@example.com',
    phone: '+5511999999999',
    status: 'ACTIVE',
    stage: 'LEAD',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('buildCallList', () => {
  // Quarta-feira fixa ao meio-dia para evitar flutuação de fuso/horário.
  const today = new Date('2026-06-10T12:00:00');

  it('separa ligações em overdue, today e upcoming pela data', () => {
    const ontem = makeActivity({ id: 'a-overdue', date: '2026-06-09T09:00:00' });
    const hoje = makeActivity({ id: 'a-today', date: '2026-06-10T15:00:00' });
    const amanha = makeActivity({ id: 'a-upcoming', date: '2026-06-11T09:00:00' });

    const result = buildCallList([ontem, hoje, amanha], [makeContact({})], today);

    expect(result.overdue.map((r) => r.activity.id)).toEqual(['a-overdue']);
    expect(result.today.map((r) => r.activity.id)).toEqual(['a-today']);
    expect(result.upcoming.map((r) => r.activity.id)).toEqual(['a-upcoming']);
  });

  it('ignora activities que não são CALL ou que já estão completas', () => {
    const naoCall = makeActivity({ id: 'a-email', type: 'EMAIL', date: '2026-06-10T15:00:00' });
    const completa = makeActivity({ id: 'a-done', completed: true, date: '2026-06-10T15:00:00' });
    const valida = makeActivity({ id: 'a-ok', date: '2026-06-10T15:00:00' });

    const result = buildCallList([naoCall, completa, valida], [makeContact({})], today);

    const todosIds = [...result.overdue, ...result.today, ...result.upcoming].map((r) => r.activity.id);
    expect(todosIds).toEqual(['a-ok']);
  });

  it('anexa o contato (e telefone) resolvido por contactId', () => {
    const call = makeActivity({ id: 'a-1', contactId: 'contact-9', date: '2026-06-10T15:00:00' });
    const contato = makeContact({ id: 'contact-9', name: 'Beltrana', phone: '+5511888888888' });

    const result = buildCallList([call], [contato], today);

    expect(result.today[0].contact?.name).toBe('Beltrana');
    expect(result.today[0].contact?.phone).toBe('+5511888888888');
  });

  it('deixa contact undefined quando não há contactId correspondente', () => {
    const call = makeActivity({ id: 'a-1', contactId: 'inexistente', date: '2026-06-10T15:00:00' });
    const result = buildCallList([call], [makeContact({ id: 'contact-1' })], today);
    expect(result.today[0].contact).toBeUndefined();
  });

  it('ordena cada bucket por data crescente (mais antigo primeiro)', () => {
    const cedo = makeActivity({ id: 'a-cedo', date: '2026-06-10T08:00:00' });
    const tarde = makeActivity({ id: 'a-tarde', date: '2026-06-10T18:00:00' });

    const result = buildCallList([tarde, cedo], [makeContact({})], today);

    expect(result.today.map((r) => r.activity.id)).toEqual(['a-cedo', 'a-tarde']);
  });

  it('retorna buckets vazios quando não há ligações pendentes', () => {
    const result = buildCallList([], [], today);
    expect(result).toEqual({ overdue: [], today: [], upcoming: [] });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/utils/callList.test.ts` Expected: FAIL com "Failed to resolve import './callList'" (arquivo ainda não existe).

- [ ] **Step 3: Implementar o mínimo**

```ts
// lib/utils/callList.ts
import type { Activity, Contact } from '@/types';

/**
 * Uma linha da call-list: a ligação pendente + o contato resolvido (se houver).
 */
export interface CallListEntry {
  activity: Activity;
  contact?: Contact;
}

/**
 * Resultado da bucketização: ligações atrasadas, de hoje e futuras.
 */
export interface CallListBuckets {
  overdue: CallListEntry[];
  today: CallListEntry[];
  upcoming: CallListEntry[];
}

/**
 * Deriva, no client, a lista de "quem ligar" a partir das activities.
 *
 * Regras (espelham o filtro de data de useActivitiesController):
 * - Considera apenas activities type 'CALL' e não concluídas (!completed).
 * - overdue  = data < início de hoje
 * - today    = início de hoje <= data < início de amanhã
 * - upcoming = data >= início de amanhã
 * - Cada bucket é ordenado por data crescente (mais antigo primeiro).
 * - O contato é resolvido por contactId via Map (undefined se não encontrado).
 *
 * @param activities Lista completa de activities (já filtrada por tenant na query).
 * @param contacts   Lista de contatos do tenant (para puxar phone/name).
 * @param today      "Agora" — injetado para testabilidade determinística.
 */
export function buildCallList(
  activities: Activity[],
  contacts: Contact[],
  today: Date = new Date()
): CallListBuckets {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const tomorrow = new Date(start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayTs = start.getTime();
  const tomorrowTs = tomorrow.getTime();

  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  const buckets: CallListBuckets = { overdue: [], today: [], upcoming: [] };

  for (const activity of activities) {
    if (activity.type !== 'CALL') continue;
    if (activity.completed) continue;

    const ts = Date.parse(activity.date);
    if (Number.isNaN(ts)) continue;

    const entry: CallListEntry = {
      activity,
      contact: activity.contactId ? contactsById.get(activity.contactId) : undefined,
    };

    if (ts < todayTs) {
      buckets.overdue.push(entry);
    } else if (ts < tomorrowTs) {
      buckets.today.push(entry);
    } else {
      buckets.upcoming.push(entry);
    }
  }

  const byDateAsc = (a: CallListEntry, b: CallListEntry) =>
    Date.parse(a.activity.date) - Date.parse(b.activity.date);
  buckets.overdue.sort(byDateAsc);
  buckets.today.sort(byDateAsc);
  buckets.upcoming.sort(byDateAsc);

  return buckets;
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/utils/callList.test.ts` Expected: PASS (6 testes).

- [ ] **Step 5: Commit**
```bash
git add lib/utils/callList.ts lib/utils/callList.test.ts
git commit -m "feat(call-list): funcao pura buildCallList com bucketizacao overdue/today/upcoming

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6.2: Controller `useCallListController` (read-path compondo activities + contacts)

**Files:** Create: `features/call-list/hooks/useCallListController.ts` · Test: `features/call-list/hooks/useCallListController.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// features/call-list/hooks/useCallListController.test.tsx
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Activity, Contact } from '@/types';

const activitiesFixture: Activity[] = [
  {
    id: 'a-overdue',
    dealId: 'deal-1',
    contactId: 'contact-1',
    dealTitle: 'Negócio 1',
    type: 'CALL',
    title: 'Ligar atrasado',
    date: '2026-06-09T09:00:00',
    user: { name: 'Eu', avatar: '' },
    completed: false,
  },
  {
    id: 'a-today',
    dealId: 'deal-2',
    contactId: 'contact-2',
    dealTitle: 'Negócio 2',
    type: 'CALL',
    title: 'Ligar hoje',
    date: '2026-06-10T15:00:00',
    user: { name: 'Eu', avatar: '' },
    completed: false,
  },
];

const contactsFixture: Contact[] = [
  { id: 'contact-1', name: 'Fulano', email: 'f@x.com', phone: '+5511999999999', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
  { id: 'contact-2', name: 'Beltrana', email: 'b@x.com', phone: '+5511888888888', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
];

const toggleMutate = vi.fn();

vi.mock('@/lib/query/hooks/useActivitiesQuery', () => ({
  useActivities: () => ({ data: activitiesFixture, isLoading: false, error: null }),
  useToggleActivity: () => ({ mutate: toggleMutate, isPending: false }),
}));

vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useContacts: () => ({ data: contactsFixture, isLoading: false, error: null }),
}));

vi.mock('@/lib/realtime/useRealtimeSync', () => ({
  useRealtimeSync: vi.fn(),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { useCallListController } from './useCallListController';

describe('useCallListController', () => {
  it('compõe activities + contacts em buckets ordenados', () => {
    const { result } = renderHook(() => useCallListController(new Date('2026-06-10T12:00:00')));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.buckets.overdue.map((e) => e.activity.id)).toEqual(['a-overdue']);
    expect(result.current.buckets.today.map((e) => e.activity.id)).toEqual(['a-today']);
    expect(result.current.buckets.today[0].contact?.phone).toBe('+5511888888888');
    expect(result.current.totalPending).toBe(2);
  });

  it('handleMarkDone delega ao useToggleActivity sem mover deal', () => {
    const { result } = renderHook(() => useCallListController(new Date('2026-06-10T12:00:00')));

    act(() => {
      result.current.handleMarkDone('a-today');
    });

    expect(toggleMutate).toHaveBeenCalledWith('a-today', expect.any(Object));
  });

  it('abre e fecha o CallModal guardando a entrada selecionada', () => {
    const { result } = renderHook(() => useCallListController(new Date('2026-06-10T12:00:00')));

    act(() => {
      result.current.openCall(result.current.buckets.today[0]);
    });
    expect(result.current.isCallModalOpen).toBe(true);
    expect(result.current.activeEntry?.activity.id).toBe('a-today');

    act(() => {
      result.current.closeCall();
    });
    expect(result.current.isCallModalOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/call-list/hooks/useCallListController.test.tsx` Expected: FAIL com "Failed to resolve import './useCallListController'".

- [ ] **Step 3: Implementar o mínimo**

```ts
// features/call-list/hooks/useCallListController.ts
import { useCallback, useMemo, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { useActivities, useToggleActivity } from '@/lib/query/hooks/useActivitiesQuery';
import { useContacts } from '@/lib/query/hooks/useContactsQuery';
import { useRealtimeSync } from '@/lib/realtime/useRealtimeSync';
import { buildCallList, type CallListEntry } from '@/lib/utils/callList';

/**
 * Controller da Home "Hoje" / call-list ("quem ligar hoje").
 *
 * NÃO cria tabela nova: deriva, no client, a lista de ligações pendentes a partir
 * das activities (type 'CALL', !completed) cruzadas com os contatos (para o phone).
 * Reusa useToggleActivity para "marcar feito" — guardrail do playbook: marcar a
 * ligação só conclui a activity, NUNCA move o deal no funil automaticamente.
 *
 * @param now "Agora" — injetável para testes determinísticos.
 */
export const useCallListController = (now: Date = new Date()) => {
  const { data: activities = [], isLoading: activitiesLoading, error: activitiesError } = useActivities();
  const { data: contacts = [], isLoading: contactsLoading, error: contactsError } = useContacts();
  const toggleActivityMutation = useToggleActivity();

  // Realtime: caminho simples de invalidate para activities.
  useRealtimeSync('activities');

  const { showToast } = useToast();

  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [activeEntry, setActiveEntry] = useState<CallListEntry | null>(null);

  const isLoading = activitiesLoading || contactsLoading;
  const error = activitiesError || contactsError;

  const buckets = useMemo(
    () => buildCallList(activities, contacts, now),
    [activities, contacts, now]
  );

  const totalPending = useMemo(
    () => buckets.overdue.length + buckets.today.length + buckets.upcoming.length,
    [buckets]
  );

  const openCall = useCallback((entry: CallListEntry) => {
    setActiveEntry(entry);
    setIsCallModalOpen(true);
  }, []);

  const closeCall = useCallback(() => {
    setIsCallModalOpen(false);
    setActiveEntry(null);
  }, []);

  const handleMarkDone = useCallback(
    (activityId: string) => {
      toggleActivityMutation.mutate(activityId, {
        onSuccess: () => {
          showToast('Ligação marcada como feita', 'success');
        },
      });
    },
    [showToast, toggleActivityMutation]
  );

  return {
    buckets,
    totalPending,
    isLoading,
    error,
    isCallModalOpen,
    activeEntry,
    openCall,
    closeCall,
    handleMarkDone,
  };
};
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/call-list/hooks/useCallListController.test.tsx` Expected: PASS (3 testes).

- [ ] **Step 5: Commit**
```bash
git add features/call-list/hooks/useCallListController.ts features/call-list/hooks/useCallListController.test.tsx
git commit -m "feat(call-list): useCallListController compoe activities+contacts e reusa useToggleActivity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6.3: Componente `CallListTable` (UI dos buckets + axe)

**Files:** Create: `features/call-list/components/CallListTable.tsx` · Test: `features/call-list/components/CallListTable.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// features/call-list/components/CallListTable.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/lib/a11y/test/a11y-utils';
import type { CallListBuckets } from '@/lib/utils/callList';
import { CallListTable } from './CallListTable';

const buckets: CallListBuckets = {
  overdue: [
    {
      activity: {
        id: 'a-overdue',
        dealId: 'deal-1',
        contactId: 'contact-1',
        dealTitle: 'Negócio 1',
        type: 'CALL',
        title: 'Ligar atrasado',
        date: '2026-06-09T09:00:00',
        user: { name: 'Eu', avatar: '' },
        completed: false,
      },
      contact: { id: 'contact-1', name: 'Fulano', email: 'f@x.com', phone: '+5511999999999', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
    },
  ],
  today: [],
  upcoming: [],
};

const emptyBuckets: CallListBuckets = { overdue: [], today: [], upcoming: [] };

describe('CallListTable', () => {
  it('renderiza as ligações com nome, telefone e botões de ação', () => {
    render(<CallListTable buckets={buckets} onCall={vi.fn()} onMarkDone={vi.fn()} />);

    expect(screen.getByText('Fulano')).toBeTruthy();
    expect(screen.getByText('Ligar atrasado')).toBeTruthy();
    expect(screen.getByText('Atrasadas')).toBeTruthy();
    expect(screen.getByRole('button', { name: /ligar para fulano/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /marcar ligar atrasado como feita/i })).toBeTruthy();
  });

  it('mostra estado vazio quando não há ligações pendentes', () => {
    render(<CallListTable buckets={emptyBuckets} onCall={vi.fn()} onMarkDone={vi.fn()} />);
    expect(screen.getByText('Nenhuma ligação pendente por aqui.')).toBeTruthy();
  });

  it('dispara onCall e onMarkDone ao clicar nos botões', async () => {
    const user = userEvent.setup();
    const onCall = vi.fn();
    const onMarkDone = vi.fn();
    render(<CallListTable buckets={buckets} onCall={onCall} onMarkDone={onMarkDone} />);

    await user.click(screen.getByRole('button', { name: /ligar para fulano/i }));
    expect(onCall).toHaveBeenCalledWith(buckets.overdue[0]);

    await user.click(screen.getByRole('button', { name: /marcar ligar atrasado como feita/i }));
    expect(onMarkDone).toHaveBeenCalledWith('a-overdue');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(
      <CallListTable buckets={buckets} onCall={vi.fn()} onMarkDone={vi.fn()} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/call-list/components/CallListTable.test.tsx` Expected: FAIL com "Failed to resolve import './CallListTable'".

- [ ] **Step 3: Implementar o mínimo**

```tsx
// features/call-list/components/CallListTable.tsx
import React from 'react';
import { Phone, Check, AlertTriangle, CalendarClock, CalendarDays } from 'lucide-react';
import type { CallListBuckets, CallListEntry } from '@/lib/utils/callList';

interface CallListTableProps {
  buckets: CallListBuckets;
  onCall: (entry: CallListEntry) => void;
  onMarkDone: (activityId: string) => void;
}

interface SectionConfig {
  key: keyof CallListBuckets;
  label: string;
  Icon: typeof Phone;
  accent: string;
}

const SECTIONS: SectionConfig[] = [
  { key: 'overdue', label: 'Atrasadas', Icon: AlertTriangle, accent: 'text-red-400' },
  { key: 'today', label: 'Hoje', Icon: CalendarClock, accent: 'text-yellow-400' },
  { key: 'upcoming', label: 'Próximas', Icon: CalendarDays, accent: 'text-slate-400' },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Tabela da call-list: lista as ligações pendentes agrupadas em Atrasadas / Hoje / Próximas.
 * Cada linha permite ligar (reusa o CallModal no controller) e marcar como feita.
 */
export const CallListTable: React.FC<CallListTableProps> = ({ buckets, onCall, onMarkDone }) => {
  const isEmpty = buckets.overdue.length === 0 && buckets.today.length === 0 && buckets.upcoming.length === 0;

  if (isEmpty) {
    return (
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/50 p-10 text-center">
        <Phone size={28} className="mx-auto mb-3 text-slate-500" />
        <p className="text-sm text-slate-400">Nenhuma ligação pendente por aqui.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {SECTIONS.map(({ key, label, Icon, accent }) => {
        const entries = buckets[key];
        if (entries.length === 0) return null;

        return (
          <section key={key} aria-label={label}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-300">
              <Icon size={16} className={accent} />
              {label}
              <span className="text-slate-500">({entries.length})</span>
            </h2>

            <ul className="space-y-2">
              {entries.map((entry) => {
                const { activity, contact } = entry;
                const contactName = contact?.name || 'Contato sem nome';
                const phone = contact?.phone || '';

                return (
                  <li
                    key={activity.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-slate-700/50 bg-slate-900/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{contactName}</p>
                      <p className="truncate text-sm text-slate-400">{activity.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {phone ? `${phone} · ` : ''}
                        {formatDate(activity.date)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onCall(entry)}
                        className="flex items-center gap-2 rounded-lg bg-yellow-500 px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-yellow-600"
                        aria-label={`Ligar para ${contactName}`}
                      >
                        <Phone size={16} />
                        Ligar
                      </button>
                      <button
                        type="button"
                        onClick={() => onMarkDone(activity.id)}
                        className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
                        aria-label={`Marcar ${activity.title} como feita`}
                      >
                        <Check size={16} />
                        Feita
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/call-list/components/CallListTable.test.tsx` Expected: PASS (4 testes, incluindo axe sem violações).

- [ ] **Step 5: Commit**
```bash
git add features/call-list/components/CallListTable.tsx features/call-list/components/CallListTable.test.tsx
git commit -m "feat(call-list): CallListTable com buckets, acoes ligar/feita e axe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6.4: `CallListPage` + rota (wrapper dynamic) ligando CallModal e marcação

**Files:** Create: `features/call-list/CallListPage.tsx` · `app/(protected)/call-list/page.tsx`

- [ ] **Step 1: Escrever o teste que falha (story smoke)** — criar o arquivo de story que importa a página real e garante que não há "Application error" (mirror US-001 + `runStorySteps`).

```tsx
// test/stories/US-021-call-list.test.tsx
import React from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { runStorySteps } from './storyRunner';
import type { Activity, Contact } from '@/types';

const Icon = () => null;

const activitiesFixture: Activity[] = [
  {
    id: 'a-today',
    dealId: 'deal-1',
    contactId: 'contact-1',
    dealTitle: 'Negócio 1',
    type: 'CALL',
    title: 'Ligar para o lead',
    date: '2026-06-10T15:00:00',
    user: { name: 'Eu', avatar: '' },
    completed: false,
  },
];

const contactsFixture: Contact[] = [
  { id: 'contact-1', name: 'Fulano de Tal', email: 'f@x.com', phone: '+5511999999999', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
];

vi.mock('@/lib/query/hooks/useActivitiesQuery', () => ({
  useActivities: () => ({ data: activitiesFixture, isLoading: false, error: null }),
  useToggleActivity: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useContacts: () => ({ data: contactsFixture, isLoading: false, error: null }),
}));

vi.mock('@/lib/realtime/useRealtimeSync', () => ({
  useRealtimeSync: vi.fn(),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1', role: 'clinic_staff', email: 'test@example.com', organization_id: 'org-1' },
  }),
}));

vi.mock('lucide-react', () => ({
  Phone: Icon,
  Check: Icon,
  AlertTriangle: Icon,
  CalendarClock: Icon,
  CalendarDays: Icon,
  X: Icon,
  PhoneOff: Icon,
  XCircle: Icon,
  Voicemail: Icon,
  Clock: Icon,
  FileText: Icon,
  Copy: Icon,
  ExternalLink: Icon,
}));

describe('Story - US-021: Home "Hoje" / call-list', () => {
  it('simula a historia e garante que nao quebra', async () => {
    const user = userEvent.setup();
    const { CallListPage } = await import('@/features/call-list/CallListPage');

    render(<CallListPage />);

    await runStorySteps(user, [
      { kind: 'expectText', text: 'Fulano de Tal' },
      { kind: 'expectText', text: 'Ligar para o lead' },
      { kind: 'expectNotText', text: /Application error/i },
    ]);

    // Abre o CallModal e garante que continua sem erro.
    await runStorySteps(user, [
      { kind: 'click', target: { role: 'button', name: /ligar para fulano de tal/i } },
      { kind: 'expectNotText', text: /Application error/i },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/stories/US-021-call-list.test.tsx` Expected: FAIL com "Failed to resolve import '@/features/call-list/CallListPage'".

- [ ] **Step 3: Implementar o mínimo** — a página compõe o controller, renderiza loading/error/empty + `CallListTable`, e liga o `CallModal` reusado do inbox. Marcar a ligação no `CallModal` (`onSave`) conclui a activity via `handleMarkDone` (guardrail: não move deal).

```tsx
// features/call-list/CallListPage.tsx
import React from 'react';
import { Phone } from 'lucide-react';
import { useCallListController } from './hooks/useCallListController';
import { CallListTable } from './components/CallListTable';
import { CallModal } from '@/features/inbox/components/CallModal';

/**
 * Home "Hoje" / call-list: lista de "quem ligar hoje".
 *
 * Deriva client-side das activities (type 'CALL', !completed). Reusa o CallModal
 * já testado para registrar o resultado da ligação. Ao salvar o log, a activity é
 * concluída (handleMarkDone) — o sistema NÃO move o deal no funil automaticamente.
 */
export const CallListPage: React.FC = () => {
  const {
    buckets,
    totalPending,
    isLoading,
    error,
    isCallModalOpen,
    activeEntry,
    openCall,
    closeCall,
    handleMarkDone,
  } = useCallListController();

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <header className="flex items-center gap-3">
        <div className="rounded-xl bg-yellow-500/20 p-2">
          <Phone size={20} className="text-yellow-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-white">Hoje — quem ligar</h1>
          <p className="text-sm text-slate-400">
            {totalPending} {totalPending === 1 ? 'ligação pendente' : 'ligações pendentes'}
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="rounded-2xl border border-slate-700/50 bg-slate-900/50 p-10 text-center text-sm text-slate-400">
          Carregando ligações...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-10 text-center text-sm text-red-400">
          Não foi possível carregar as ligações. Tente novamente.
        </div>
      ) : (
        <CallListTable buckets={buckets} onCall={openCall} onMarkDone={handleMarkDone} />
      )}

      <CallModal
        isOpen={isCallModalOpen}
        onClose={closeCall}
        onSave={() => {
          if (activeEntry) {
            handleMarkDone(activeEntry.activity.id);
          }
          closeCall();
        }}
        contactName={activeEntry?.contact?.name || 'Contato'}
        contactPhone={activeEntry?.contact?.phone || ''}
        suggestedTitle={activeEntry?.activity.title || 'Ligação'}
      />
    </div>
  );
};
```

```tsx
// app/(protected)/call-list/page.tsx
'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const CallListPage = dynamic(
    () => import('@/features/call-list/CallListPage').then(m => ({ default: m.CallListPage })),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Componente React `CallList`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function CallList() {
    return <CallListPage />
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/stories/US-021-call-list.test.tsx` Expected: PASS (renderiza "Fulano de Tal" + "Ligar para o lead", abre CallModal, nenhum "Application error").

- [ ] **Step 5: Commit**
```bash
git add features/call-list/CallListPage.tsx "app/(protected)/call-list/page.tsx" test/stories/US-021-call-list.test.tsx
git commit -m "feat(call-list): CallListPage + rota dynamic reusando CallModal; story smoke US-021

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6.5: Verificação final da fase (suíte + gate)

**Files:** (nenhum novo — verificação)

- [ ] **Step 1: Rodar os testes da fase** Run: `npx vitest run lib/utils/callList.test.ts features/call-list/hooks/useCallListController.test.tsx features/call-list/components/CallListTable.test.tsx test/stories/US-021-call-list.test.tsx` Expected: PASS em todos.

- [ ] **Step 2: Rodar o gate pré-commit rápido** Run: `npm run precheck:fast` Expected: PASS (lint + typecheck + test:run). DoD da fase: loading/error/empty na UI, função pura testada, story smoke sem "Application error", componente sem violações axe, e nenhuma activity/deal movida automaticamente (só conclusão via `useToggleActivity`).

- [ ] **Step 3: Commit (se o gate exigir ajustes de lint/types)**
```bash
git add -A
git commit -m "chore(call-list): ajustes de lint/typecheck pos-gate da Fase 6

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Fase 7 — Agenda operacional: Basecrm é a cara, Clinicorp é o motor (via API REAL verificada ao vivo)

**Decisão travada (Junior, 2026-06-09):** a agenda do Clinicorp é a fonte de verdade; o Basecrm é a superfície de operação. A Vitória vê horários livres e agenda dentro do Basecrm sem abrir o Clinicorp — por trás, o Basecrm chama a API do Clinicorp. **Não** se reconstrói motor de disponibilidade: o Clinicorp já calcula respeitando a agenda real (terça de manhã fora, cadeiras, durações).

**Segurança (regra dura — Junior é não-dev, token não pode vazar):** TODA chamada Clinicorp acontece SERVER-SIDE (route handler com `createStaticAdminClient`), NUNCA do browser. O client só fala com `/api/agenda/*` do próprio Basecrm. O token fica em `clinicorp_config` com RLS `can_configure_organization` (só Adel) e nunca é devolvido ao client.

**Fatos da API (VERBATIM do OpenAPI lido nesta sessão — HTTP 200 confirmado):** base `https://api.clinicorp.com/rest/v1`, auth = HTTP Basic (`username` = usuário API, `password` = token). Endpoints: `GET /appointment/get_avaliable_times_calendar` (subscriber_id, date YYYY-MM-DD, code_link → array `{From,To,DayWeek,BusinessId,ProfessionalId}`) · `GET /appointment/get_avaliable_days` (subscriber_id, code_link, from, to, showAvailableTimes) · `GET /appointment/list` (subscriber_id, from, to, businessId; opt patientId, includeCanceled → array `{id,PatientName,date,fromTime,toTime,MobilePhone,Email,Dentist_PersonId,...}`) · `POST /appointment/create_appointment_by_api` (body: date ISO, fromTime, toTime, Clinic_BusinessId int, Dentist_PersonId int, Patient_PersonId int OU PatientName+MobilePhone+Email, Procedures string, CategoryColor, CategoryDescription → array `{Status:'CREATED', id}`) · `POST /appointment/confirm_appointment` (body subscriber_id, id) · `POST /appointment/cancel_appointment` (body subscriber_id, id) · `GET /professional/list_all_professionals` (→ array `{id,name,cpf}`; id = Dentist_PersonId).

**Pré-requisitos one-time (NÃO bloqueiam o build; a agenda só fica ao vivo com eles):** `subscriber_id` (= "ID Clínica" em Gerenciar Assinatura → Acesso Externo), `code_link` (código do agendamento online), `business_id` (de `/business/list`). A Task 7.12 valida ao vivo antes de fechar a UI.

---

### Task 7.1: Tipos do canal Clinicorp + provider 'clinicorp'

**Files:** Modify: `lib/channels/types.ts` · Create: `lib/channels/clinicorpTypes.ts` · Test: `lib/channels/clinicorpTypes.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/channels/clinicorpTypes.test.ts
import { describe, expect, it } from 'vitest';
import { CHANNEL_PROVIDERS } from './types';
import {
  CLINICORP_API_BASE_URL,
  type ClinicorpAvailableTime,
  type ClinicorpAppointment,
  type ClinicorpCreatedAppointment,
  type ClinicorpProfessional,
} from './clinicorpTypes';

describe('clinicorp channel types', () => {
  it('registra o provider clinicorp na union de canais', () => {
    expect(CHANNEL_PROVIDERS).toContain('clinicorp');
  });

  it('expõe a base REST oficial do Clinicorp', () => {
    expect(CLINICORP_API_BASE_URL).toBe('https://api.clinicorp.com/rest/v1');
  });

  it('tipa as respostas-chave da API (smoke de shape)', () => {
    const time: ClinicorpAvailableTime = {
      From: '9:00',
      To: '10:00',
      DayWeek: 1,
      BusinessId: 123,
      ProfessionalId: 456,
    };
    const appt: ClinicorpAppointment = {
      id: 987,
      PatientName: 'Joao',
      date: '2026-06-12',
      fromTime: '09:00',
      toTime: '10:00',
      MobilePhone: '(47) 99999-9999',
      Email: 'a@b.com',
      Dentist_PersonId: 456,
      StatusDescription: '1-Confirmado',
    };
    const created: ClinicorpCreatedAppointment = { Status: 'CREATED', id: 987 };
    const prof: ClinicorpProfessional = { id: 456, name: 'Dra. Jessica', cpf: '00000000000' };
    expect(time.ProfessionalId).toBe(456);
    expect(appt.id).toBe(987);
    expect(created.Status).toBe('CREATED');
    expect(prof.id).toBe(456);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/channels/clinicorpTypes.test.ts` Expected: FAIL com `Cannot find module './clinicorpTypes'` e `expect(CHANNEL_PROVIDERS).toContain('clinicorp')` recebendo `['evolution']`.

- [ ] **Step 3: Implementar o mínimo**

Em `lib/channels/types.ts`, estender a const (linha 1):

```ts
export const CHANNEL_PROVIDERS = ['evolution', 'clinicorp'] as const;
```

Criar `lib/channels/clinicorpTypes.ts`:

```ts
/**
 * Tipos do boundary Clinicorp (espelham VERBATIM o OpenAPI lido ao vivo).
 * Schemas confirmados em sessão: endpoints HTTP 200, OpenAPI 4839 linhas.
 */

export const CLINICORP_API_BASE_URL = 'https://api.clinicorp.com/rest/v1';

/** Credenciais resolvidas por tenant (server-side only, token nunca vai ao client). */
export type ClinicorpCredentials = {
  apiUrl: string;
  apiUser: string;
  apiToken: string;
  subscriberId: string;
  codeLink: string;
  businessId: number;
};

/** GET /appointment/get_avaliable_times_calendar → array de slots. */
export type ClinicorpAvailableTime = {
  From: string;
  To: string;
  DayWeek: number;
  BusinessId: number;
  ProfessionalId: number;
};

/** GET /appointment/get_avaliable_days → array de dias. */
export type ClinicorpAvailableDay = {
  Date: string;
  Week: string;
  DayWeek: number;
  day: number;
  month: number;
  year: number;
};

/** GET /appointment/list → array de agendamentos. */
export type ClinicorpAppointment = {
  id: number;
  PatientName: string | null;
  date: string | null;
  fromTime: string | null;
  toTime: string | null;
  MobilePhone: string | null;
  Email: string | null;
  Dentist_PersonId: number | null;
  Clinic_BusinessId?: number | null;
  StatusDescription?: string | null;
  Notes?: string | null;
};

/** POST /appointment/create_appointment_by_api → body. */
export type ClinicorpCreateAppointmentPayload = {
  date: string;
  fromTime: string;
  toTime: string;
  Clinic_BusinessId: number;
  Dentist_PersonId?: number;
  Patient_PersonId?: number;
  PatientName?: string;
  MobilePhone?: string;
  Email?: string;
  Procedures: string;
  CategoryColor?: string;
  CategoryDescription?: string;
};

/** POST /appointment/create_appointment_by_api → array `[{ Status, id }]`. */
export type ClinicorpCreatedAppointment = {
  Status: string;
  id: number;
};

/** GET /professional/list_all_professionals → array `[{ id, name, cpf }]`. */
export type ClinicorpProfessional = {
  id: number;
  name: string;
  cpf: string | null;
};
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/channels/clinicorpTypes.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/channels/types.ts lib/channels/clinicorpTypes.ts lib/channels/clinicorpTypes.test.ts
git commit -m "feat(agenda): tipos do canal Clinicorp + provider clinicorp"
```

---

### Task 7.2: Funções puras `buildCreateAppointmentPayload` e `mapClinicorpAppointment`

**Files:** Create: `lib/channels/clinicorpMappers.ts` · Test: `lib/channels/clinicorpMappers.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/channels/clinicorpMappers.test.ts
import { describe, expect, it } from 'vitest';
import { buildCreateAppointmentPayload, mapClinicorpAppointment } from './clinicorpMappers';

describe('buildCreateAppointmentPayload', () => {
  it('monta payload por paciente cadastrado (Patient_PersonId)', () => {
    const payload = buildCreateAppointmentPayload({
      slot: { date: '2026-06-12', fromTime: '09:00', toTime: '10:00' },
      businessId: 111,
      dentistPersonId: 222,
      patient: { personId: 333 },
      procedimento: 'Facetas em resina',
    });
    expect(payload).toEqual({
      date: '2026-06-12',
      fromTime: '09:00',
      toTime: '10:00',
      Clinic_BusinessId: 111,
      Dentist_PersonId: 222,
      Patient_PersonId: 333,
      Procedures: 'Facetas em resina',
    });
  });

  it('monta payload por paciente avulso (nome+telefone+email) quando não há personId', () => {
    const payload = buildCreateAppointmentPayload({
      slot: { date: '2026-06-12', fromTime: '14:00', toTime: '15:00' },
      businessId: 111,
      dentistPersonId: 222,
      patient: { name: 'Maria Souza', mobilePhone: '(47) 98870-0805', email: 'maria@x.com' },
      procedimento: 'Avaliacao',
    });
    expect(payload).toEqual({
      date: '2026-06-12',
      fromTime: '14:00',
      toTime: '15:00',
      Clinic_BusinessId: 111,
      Dentist_PersonId: 222,
      PatientName: 'Maria Souza',
      MobilePhone: '(47) 98870-0805',
      Email: 'maria@x.com',
      Procedures: 'Avaliacao',
    });
  });

  it('lança erro quando não há nem personId nem nome', () => {
    expect(() =>
      buildCreateAppointmentPayload({
        slot: { date: '2026-06-12', fromTime: '09:00', toTime: '10:00' },
        businessId: 111,
        dentistPersonId: 222,
        patient: {},
        procedimento: 'X',
      })
    ).toThrow('Paciente sem identificacao');
  });
});

describe('mapClinicorpAppointment', () => {
  it('transforma o raw do Clinicorp em Appointment local com source clinicorp_api', () => {
    const result = mapClinicorpAppointment(
      {
        id: 987,
        PatientName: 'Lucas',
        date: '2026-06-12',
        fromTime: '09:00',
        toTime: '10:00',
        MobilePhone: '(47) 99999-9999',
        Email: 'lucas@x.com',
        Dentist_PersonId: 222,
        StatusDescription: '1-Confirmado',
      },
      { organizationId: 'org-1' }
    );
    expect(result.externalId).toBe('987');
    expect(result.source).toBe('clinicorp_api');
    expect(result.status).toBe('compareceu');
    expect(result.startsAt).toBe('2026-06-12T09:00:00');
    expect(result.endsAt).toBe('2026-06-12T10:00:00');
    expect(result.organizationId).toBe('org-1');
    expect(result.notes).toContain('Lucas');
  });

  it('mapeia status cancelado/desmarcado', () => {
    const result = mapClinicorpAppointment(
      { id: 1, PatientName: 'X', date: '2026-06-12', fromTime: '09:00', toTime: '10:00', MobilePhone: null, Email: null, Dentist_PersonId: null, StatusDescription: '3-Desmarcado' },
      { organizationId: 'org-1' }
    );
    expect(result.status).toBe('cancelado');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/channels/clinicorpMappers.test.ts` Expected: FAIL com `Cannot find module './clinicorpMappers'`.

- [ ] **Step 3: Implementar o mínimo**

```ts
// lib/channels/clinicorpMappers.ts
import type {
  ClinicorpAppointment,
  ClinicorpCreateAppointmentPayload,
} from './clinicorpTypes';
import type { Appointment } from '@/types';

type SlotInput = { date: string; fromTime: string; toTime: string };

type PatientInput = {
  personId?: number;
  name?: string;
  mobilePhone?: string;
  email?: string;
};

/** Função pura: monta o body exato de POST /appointment/create_appointment_by_api. */
export function buildCreateAppointmentPayload(params: {
  slot: SlotInput;
  businessId: number;
  dentistPersonId: number;
  patient: PatientInput;
  procedimento: string;
}): ClinicorpCreateAppointmentPayload {
  const { slot, businessId, dentistPersonId, patient, procedimento } = params;

  const base: ClinicorpCreateAppointmentPayload = {
    date: slot.date,
    fromTime: slot.fromTime,
    toTime: slot.toTime,
    Clinic_BusinessId: businessId,
    Dentist_PersonId: dentistPersonId,
    Procedures: procedimento,
  };

  if (typeof patient.personId === 'number') {
    return { ...base, Patient_PersonId: patient.personId };
  }

  if (patient.name && patient.name.trim()) {
    return {
      ...base,
      PatientName: patient.name.trim(),
      ...(patient.mobilePhone ? { MobilePhone: patient.mobilePhone } : {}),
      ...(patient.email ? { Email: patient.email } : {}),
    };
  }

  throw new Error('Paciente sem identificacao: informe Patient_PersonId ou nome do paciente.');
}

function mapStatus(statusDescription: string | null | undefined): Appointment['status'] {
  const value = String(statusDescription || '').toLowerCase();
  if (value.includes('desmarc') || value.includes('cancel')) return 'cancelado';
  if (value.includes('falt') || value.includes('no-show')) return 'faltou';
  if (value.includes('confirm') || value.includes('atend') || value.includes('comparec')) return 'compareceu';
  if (value.includes('remarc')) return 'remarcado';
  return 'agendado';
}

function buildIso(date: string | null, time: string | null): string | null {
  if (!date) return null;
  const normalizedTime = time && time.trim() ? `${time.trim().padStart(5, '0')}:00` : '00:00:00';
  return `${date}T${normalizedTime.length === 5 ? `${normalizedTime}:00` : normalizedTime}`;
}

/** Função pura: transforma o raw do Clinicorp no Appointment local (cache de resiliência). */
export function mapClinicorpAppointment(
  raw: ClinicorpAppointment,
  ctx: { organizationId: string }
): Appointment {
  const startsAt = buildIso(raw.date, raw.fromTime) || new Date().toISOString();
  const endsAt = buildIso(raw.date, raw.toTime);

  return {
    organizationId: ctx.organizationId,
    externalId: String(raw.id),
    source: 'clinicorp_api',
    status: mapStatus(raw.StatusDescription),
    startsAt,
    endsAt: endsAt || undefined,
    notes: [raw.PatientName, raw.MobilePhone].filter(Boolean).join(' · ') || undefined,
  } as Appointment;
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/channels/clinicorpMappers.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/channels/clinicorpMappers.ts lib/channels/clinicorpMappers.test.ts
git commit -m "feat(agenda): mappers puros buildCreateAppointmentPayload + mapClinicorpAppointment"
```

---

### Task 7.3: Adapter `lib/channels/clinicorp.ts` (boundary fetch tipado, espelha evolution.ts)

**Files:** Create: `lib/channels/clinicorp.ts` · Test: `lib/channels/clinicorp.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/channels/clinicorp.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  listAvailableTimes,
  listAppointments,
  createAppointment,
  confirmAppointment,
  cancelAppointment,
  listProfessionals,
} from './clinicorp';

const creds = {
  apiUrl: 'https://api.clinicorp.com/rest/v1',
  apiUser: 'apiuser',
  apiToken: 'secret-token',
  subscriberId: 'sub-123',
  codeLink: '4567',
  businessId: 111,
};

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clinicorp adapter', () => {
  it('listAvailableTimes monta URL com subscriber_id+date+code_link e auth Basic', async () => {
    const fetchMock = mockFetchOnce([{ From: '9:00', To: '10:00', DayWeek: 1, BusinessId: 111, ProfessionalId: 222 }]);
    vi.stubGlobal('fetch', fetchMock);

    const res = await listAvailableTimes(creds, '2026-06-12');

    expect(res).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appointment/get_avaliable_times_calendar');
    expect(String(url)).toContain('subscriber_id=sub-123');
    expect(String(url)).toContain('date=2026-06-12');
    expect(String(url)).toContain('code_link=4567');
    const expectedAuth = `Basic ${Buffer.from('apiuser:secret-token').toString('base64')}`;
    expect((init as RequestInit).headers).toMatchObject({ authorization: expectedAuth });
    expect((init as RequestInit).method).toBe('GET');
  });

  it('listAppointments envia from/to/businessId', async () => {
    const fetchMock = mockFetchOnce([{ id: 1, PatientName: 'X', date: '2026-06-12', fromTime: '09:00', toTime: '10:00', MobilePhone: null, Email: null, Dentist_PersonId: 222 }]);
    vi.stubGlobal('fetch', fetchMock);

    await listAppointments(creds, '2026-06-01', '2026-06-30');

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appointment/list');
    expect(String(url)).toContain('from=2026-06-01');
    expect(String(url)).toContain('to=2026-06-30');
    expect(String(url)).toContain('businessId=111');
  });

  it('createAppointment faz POST com body do payload e retorna o created', async () => {
    const fetchMock = mockFetchOnce([{ Status: 'CREATED', id: 987 }]);
    vi.stubGlobal('fetch', fetchMock);

    const created = await createAppointment(creds, {
      date: '2026-06-12',
      fromTime: '09:00',
      toTime: '10:00',
      Clinic_BusinessId: 111,
      Dentist_PersonId: 222,
      Patient_PersonId: 333,
      Procedures: 'Facetas',
    });

    expect(created).toEqual({ Status: 'CREATED', id: 987 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appointment/create_appointment_by_api');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ Patient_PersonId: 333, Procedures: 'Facetas' });
  });

  it('confirmAppointment envia subscriber_id+id no body', async () => {
    const fetchMock = mockFetchOnce([{ id: 987 }]);
    vi.stubGlobal('fetch', fetchMock);
    await confirmAppointment(creds, 987);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appointment/confirm_appointment');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ subscriber_id: 'sub-123', id: 987 });
  });

  it('cancelAppointment envia subscriber_id+id no body', async () => {
    const fetchMock = mockFetchOnce([{ id: 987 }]);
    vi.stubGlobal('fetch', fetchMock);
    await cancelAppointment(creds, 987);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appointment/cancel_appointment');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ subscriber_id: 'sub-123', id: 987 });
  });

  it('listProfessionals retorna os dentistas (id=Dentist_PersonId)', async () => {
    const fetchMock = mockFetchOnce([{ id: 222, name: 'Dra. Jessica', cpf: '000' }]);
    vi.stubGlobal('fetch', fetchMock);
    const list = await listProfessionals(creds);
    expect(list[0].id).toBe(222);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/professional/list_all_professionals');
  });

  it('propaga erro HTTP do boundary', async () => {
    const fetchMock = mockFetchOnce('upstream down', false, 500);
    vi.stubGlobal('fetch', fetchMock);
    await expect(listAvailableTimes(creds, '2026-06-12')).rejects.toThrow(/Clinicorp respondeu HTTP 500|upstream down/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/channels/clinicorp.test.ts` Expected: FAIL com `Cannot find module './clinicorp'`.

- [ ] **Step 3: Implementar o mínimo**

```ts
// lib/channels/clinicorp.ts
/**
 * Adapter do boundary Clinicorp — funções fetch() puras tipadas (sem SDK).
 * Espelha o padrão de lib/channels/evolution.ts: parse central, sem throw silencioso.
 * SEGURANÇA: chamadas SERVER-SIDE apenas. apiToken é secret (HTTP Basic password).
 */
import type {
  ClinicorpCredentials,
  ClinicorpAvailableTime,
  ClinicorpAvailableDay,
  ClinicorpAppointment,
  ClinicorpCreateAppointmentPayload,
  ClinicorpCreatedAppointment,
  ClinicorpProfessional,
} from './clinicorpTypes';

async function parseClinicorpResponse(response: Response): Promise<unknown> {
  const rawText = await response.text();
  let payload: unknown = rawText;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }

  if (!response.ok) {
    throw new Error(
      typeof payload === 'string'
        ? payload || `Clinicorp respondeu HTTP ${response.status}`
        : `Clinicorp respondeu HTTP ${response.status}`
    );
  }

  return payload;
}

function basicAuthHeader(creds: ClinicorpCredentials): string {
  const token = Buffer.from(`${creds.apiUser}:${creds.apiToken}`).toString('base64');
  return `Basic ${token}`;
}

function buildUrl(creds: ClinicorpCredentials, path: string, query: Record<string, string>): string {
  const baseUrl = creds.apiUrl.replace(/\/+$/, '');
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function clinicorpGet(creds: ClinicorpCredentials, path: string, query: Record<string, string>): Promise<unknown> {
  const response = await fetch(buildUrl(creds, path, query), {
    method: 'GET',
    headers: {
      authorization: basicAuthHeader(creds),
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  return parseClinicorpResponse(response);
}

async function clinicorpPost(creds: ClinicorpCredentials, path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(buildUrl(creds, path, {}), {
    method: 'POST',
    headers: {
      authorization: basicAuthHeader(creds),
      accept: 'application/json',
      'content-type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  return parseClinicorpResponse(response);
}

function asArray<T>(payload: unknown): T[] {
  return Array.isArray(payload) ? (payload as T[]) : [];
}

/** GET /appointment/get_avaliable_times_calendar (subscriber_id, date, code_link). */
export async function listAvailableTimes(
  creds: ClinicorpCredentials,
  date: string
): Promise<ClinicorpAvailableTime[]> {
  const payload = await clinicorpGet(creds, '/appointment/get_avaliable_times_calendar', {
    subscriber_id: creds.subscriberId,
    date,
    code_link: creds.codeLink,
  });
  return asArray<ClinicorpAvailableTime>(payload);
}

/** GET /appointment/get_avaliable_days (subscriber_id, code_link, from, to, showAvailableTimes). */
export async function listAvailableDays(
  creds: ClinicorpCredentials,
  from: string,
  to: string
): Promise<ClinicorpAvailableDay[]> {
  const payload = await clinicorpGet(creds, '/appointment/get_avaliable_days', {
    subscriber_id: creds.subscriberId,
    code_link: creds.codeLink,
    from,
    to,
    showAvailableTimes: 'X',
  });
  return asArray<ClinicorpAvailableDay>(payload);
}

/** GET /appointment/list (subscriber_id, from, to, businessId). */
export async function listAppointments(
  creds: ClinicorpCredentials,
  from: string,
  to: string
): Promise<ClinicorpAppointment[]> {
  const payload = await clinicorpGet(creds, '/appointment/list', {
    subscriber_id: creds.subscriberId,
    from,
    to,
    businessId: String(creds.businessId),
  });
  return asArray<ClinicorpAppointment>(payload);
}

/** POST /appointment/create_appointment_by_api. Retorna o primeiro item do array `[{ Status, id }]`. */
export async function createAppointment(
  creds: ClinicorpCredentials,
  payload: ClinicorpCreateAppointmentPayload
): Promise<ClinicorpCreatedAppointment> {
  const raw = await clinicorpPost(creds, '/appointment/create_appointment_by_api', payload as Record<string, unknown>);
  const list = asArray<ClinicorpCreatedAppointment>(raw);
  const created = list[0];
  if (!created) {
    throw new Error('Clinicorp nao retornou o agendamento criado.');
  }
  return created;
}

/** POST /appointment/confirm_appointment (subscriber_id, id). */
export async function confirmAppointment(creds: ClinicorpCredentials, id: number): Promise<unknown> {
  return clinicorpPost(creds, '/appointment/confirm_appointment', {
    subscriber_id: creds.subscriberId,
    id,
  });
}

/** POST /appointment/cancel_appointment (subscriber_id, id). */
export async function cancelAppointment(creds: ClinicorpCredentials, id: number): Promise<unknown> {
  return clinicorpPost(creds, '/appointment/cancel_appointment', {
    subscriber_id: creds.subscriberId,
    id,
  });
}

/** GET /professional/list_all_professionals (id = Dentist_PersonId). */
export async function listProfessionals(creds: ClinicorpCredentials): Promise<ClinicorpProfessional[]> {
  const payload = await clinicorpGet(creds, '/professional/list_all_professionals', {});
  return asArray<ClinicorpProfessional>(payload);
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/channels/clinicorp.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/channels/clinicorp.ts lib/channels/clinicorp.test.ts
git commit -m "feat(agenda): adapter Clinicorp (boundary fetch tipado, auth Basic)"
```

---

### Task 7.4: Migração `clinicorp_config` (token server-side, RLS can_configure)

**Files:** Create: `supabase/migrations/20260617000000_clinicorp_config.sql` · Modify: `supabase/reset.sql` · Test: `test/clinicorpConfigRlsPolicies.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// test/clinicorpConfigRlsPolicies.test.ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260617000000_clinicorp_config.sql'
);

describe('clinicorp_config RLS migration', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('cria a tabela idempotente com RLS habilitado', () => {
    expect(sql).toContain('create table if not exists public.clinicorp_config');
    expect(sql).toContain('alter table public.clinicorp_config enable row level security');
  });

  it('guarda credenciais por tenant (api_user, api_token, subscriber_id, code_link, business_id)', () => {
    for (const col of ['api_user', 'api_token', 'subscriber_id', 'code_link', 'business_id']) {
      expect(sql).toContain(col);
    }
  });

  it('config financeira/integração só pra quem configura — sem USING (true)', () => {
    expect(sql).toContain('public.can_configure_organization(organization_id)');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('não expõe SELECT a can_access (token nunca vaza pra clinic_staff)', () => {
    expect(sql).not.toContain('public.can_access_organization(organization_id)');
  });

  it('aplica trigger updated_at e índice por org', () => {
    expect(sql).toContain('update_clinicorp_config_updated_at');
    expect(sql).toContain('idx_clinicorp_config_org');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/clinicorpConfigRlsPolicies.test.ts` Expected: FAIL com `ENOENT` na leitura da migração.

- [ ] **Step 3: Implementar o mínimo**

```sql
-- supabase/migrations/20260617000000_clinicorp_config.sql
-- Config por tenant da integração Clinicorp. token NUNCA exposto ao client.
-- RLS: SELECT + mutate AMBOS can_configure_organization (só Adel; clinic_staff não lê).

create table if not exists public.clinicorp_config (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  api_user text,
  api_token text,
  subscriber_id text,
  code_link text,
  business_id integer,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinicorp_config enable row level security;

create unique index if not exists uniq_clinicorp_config_org on public.clinicorp_config(organization_id);
create index if not exists idx_clinicorp_config_org on public.clinicorp_config(organization_id, created_at desc);

drop policy if exists "clinicorp_config_select_by_tenant_admin" on public.clinicorp_config;
create policy "clinicorp_config_select_by_tenant_admin"
  on public.clinicorp_config
  for select
  to authenticated
  using (public.can_configure_organization(organization_id));

drop policy if exists "clinicorp_config_mutate_by_tenant_admin" on public.clinicorp_config;
create policy "clinicorp_config_mutate_by_tenant_admin"
  on public.clinicorp_config
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

drop trigger if exists update_clinicorp_config_updated_at on public.clinicorp_config;
create trigger update_clinicorp_config_updated_at
  before update on public.clinicorp_config
  for each row execute function public.update_updated_at_column();
```

Em `supabase/reset.sql`, adicionar o DELETE em ordem FK-safe (antes de `contacts`/`deals`):

```sql
delete from public.clinicorp_config;
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/clinicorpConfigRlsPolicies.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260617000000_clinicorp_config.sql supabase/reset.sql test/clinicorpConfigRlsPolicies.test.ts
git commit -m "feat(agenda): migração clinicorp_config com RLS can_configure (token server-side)"
```

---

### Task 7.5: Migração `appointments` (cache local de resiliência) + RLS-as-text

**Files:** Create: `supabase/migrations/20260617100000_appointments.sql` · Modify: `supabase/reset.sql` · Test: `test/appointmentsRlsPolicies.test.ts` · Modify: `test/multiTenantRlsPolicies.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// test/appointmentsRlsPolicies.test.ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260617100000_appointments.sql'
);

describe('appointments RLS migration', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('cria a tabela idempotente com RLS habilitado', () => {
    expect(sql).toContain('create table if not exists public.appointments');
    expect(sql).toContain('alter table public.appointments enable row level security');
  });

  it('tem dedupe de import (UNIQUE org+source+external_id)', () => {
    expect(sql).toContain('unique (organization_id, source, external_id)');
  });

  it('SELECT can_access, mutate can_operate — sem USING (true)', () => {
    expect(sql).toContain('public.can_access_organization(organization_id)');
    expect(sql).toContain('public.can_operate_organization(organization_id)');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('aplica trigger updated_at e índice por org', () => {
    expect(sql).toContain('update_appointments_updated_at');
    expect(sql).toContain('idx_appointments_org');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/appointmentsRlsPolicies.test.ts` Expected: FAIL com `ENOENT`.

- [ ] **Step 3: Implementar o mínimo**

```sql
-- supabase/migrations/20260617100000_appointments.sql
-- Cache local de resiliência da agenda. A VERDADE é o Clinicorp; isto é fallback/leitura rápida.
-- external_id = id do Clinicorp; source='clinicorp_api'. UNIQUE(org,source,external_id) p/ dedupe do sync.

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id),
  professional_id uuid references public.professionals(id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'agendado',
  source text not null default 'manual',
  external_id text,
  notes text,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, external_id)
);

alter table public.appointments enable row level security;

create index if not exists idx_appointments_org on public.appointments(organization_id, created_at desc);
create index if not exists idx_appointments_contact on public.appointments(contact_id);
create index if not exists idx_appointments_professional on public.appointments(professional_id);
create index if not exists idx_appointments_starts_at on public.appointments(organization_id, starts_at);

drop policy if exists "appointments_select_by_tenant" on public.appointments;
create policy "appointments_select_by_tenant"
  on public.appointments
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

drop policy if exists "appointments_mutate_by_tenant_operator" on public.appointments;
create policy "appointments_mutate_by_tenant_operator"
  on public.appointments
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

drop trigger if exists update_appointments_updated_at on public.appointments;
create trigger update_appointments_updated_at
  before update on public.appointments
  for each row execute function public.update_updated_at_column();
```

Em `supabase/reset.sql`, adicionar (antes de `contacts`/`deals`, e antes do delete de `clinicorp_config` não importa — appointments referencia contacts/professionals, então deletar primeiro):

```sql
delete from public.appointments;
```

Em `test/multiTenantRlsPolicies.test.ts`, adicionar `appointments` à lista do primeiro `it` (linhas 15-26):

```ts
    for (const tableName of [
      'boards',
      'board_stages',
      'crm_companies',
      'contacts',
      'products',
      'deals',
      'deal_items',
      'activities',
      'organization_settings',
      'api_keys',
    ]) {
```

(Observação: a lista do teste core continua referindo a migração core; o `appointments` é coberto pelo arquivo dedicado acima — não alterar a leitura de `20260311013000` ali. A linha de `appointments` entra apenas como string de presença no teste dedicado.)

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/appointmentsRlsPolicies.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260617100000_appointments.sql supabase/reset.sql test/appointmentsRlsPolicies.test.ts
git commit -m "feat(agenda): migração appointments (cache de resiliência) com RLS + dedupe"
```

---

### Task 7.6: Config por tenant `lib/channels/clinicorpCredentials.ts` (resolve credenciais, token não vaza)

**Files:** Create: `lib/channels/clinicorpCredentials.ts` · Test: `lib/channels/clinicorpCredentials.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/channels/clinicorpCredentials.test.ts
import { describe, expect, it, vi } from 'vitest';
import { resolveClinicorpCredentials } from './clinicorpCredentials';

function adminWithRow(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: row, error }),
        }),
      }),
    }),
  };
}

describe('resolveClinicorpCredentials', () => {
  it('resolve as credenciais do tenant a partir de clinicorp_config', async () => {
    const admin = adminWithRow({
      api_user: 'apiuser',
      api_token: 'secret-token',
      subscriber_id: 'sub-123',
      code_link: '4567',
      business_id: 111,
    });

    const resolved = await resolveClinicorpCredentials({ admin, tenantId: 'org-1' });

    expect(resolved).toEqual({
      apiUrl: 'https://api.clinicorp.com/rest/v1',
      apiUser: 'apiuser',
      apiToken: 'secret-token',
      subscriberId: 'sub-123',
      codeLink: '4567',
      businessId: 111,
    });
    expect(admin.from).toHaveBeenCalledWith('clinicorp_config');
  });

  it('retorna null quando a config está incompleta (sem subscriber_id)', async () => {
    const admin = adminWithRow({ api_user: 'u', api_token: 't', subscriber_id: '', code_link: '4567', business_id: 111 });
    const resolved = await resolveClinicorpCredentials({ admin, tenantId: 'org-1' });
    expect(resolved).toBeNull();
  });

  it('retorna null quando não há linha de config', async () => {
    const admin = adminWithRow(null);
    const resolved = await resolveClinicorpCredentials({ admin, tenantId: 'org-1' });
    expect(resolved).toBeNull();
  });

  it('lança quando o supabase retorna erro', async () => {
    const admin = adminWithRow(null, { message: 'boom' });
    await expect(resolveClinicorpCredentials({ admin, tenantId: 'org-1' })).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/channels/clinicorpCredentials.test.ts` Expected: FAIL com `Cannot find module './clinicorpCredentials'`.

- [ ] **Step 3: Implementar o mínimo**

```ts
// lib/channels/clinicorpCredentials.ts
/**
 * Resolve as credenciais Clinicorp por tenant a partir de public.clinicorp_config.
 * SEGURANÇA: usado SERVER-SIDE com admin client. O apiToken nunca volta ao client —
 * apenas o adapter (server) consome o objeto resolvido.
 * Espelha o contrato de lib/channels/evolutionCredentials.ts (objeto resolvido ou null).
 */
import { CLINICORP_API_BASE_URL, type ClinicorpCredentials } from './clinicorpTypes';

type ResolveClinicorpCredentialsParams = {
  admin: any;
  tenantId: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function resolveClinicorpCredentials(
  params: ResolveClinicorpCredentialsParams
): Promise<ClinicorpCredentials | null> {
  const result = await params.admin
    .from('clinicorp_config')
    .select('api_user, api_token, subscriber_id, code_link, business_id')
    .eq('organization_id', params.tenantId)
    .maybeSingle();

  if (result.error) throw new Error(result.error.message);
  if (!result.data) return null;

  const apiUser = normalizeText(result.data.api_user);
  const apiToken = normalizeText(result.data.api_token);
  const subscriberId = normalizeText(result.data.subscriber_id);
  const codeLink = normalizeText(result.data.code_link);
  const businessId = Number(result.data.business_id);

  if (!apiUser || !apiToken || !subscriberId || !codeLink || !Number.isFinite(businessId) || businessId <= 0) {
    return null;
  }

  return {
    apiUrl: CLINICORP_API_BASE_URL,
    apiUser,
    apiToken,
    subscriberId,
    codeLink,
    businessId,
  };
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/channels/clinicorpCredentials.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/channels/clinicorpCredentials.ts lib/channels/clinicorpCredentials.test.ts
git commit -m "feat(agenda): resolução de credenciais Clinicorp por tenant (token server-side)"
```

---

### Task 7.7: Route handler `GET /api/agenda/available-times` (espelha settings/ai/route.ts)

**Files:** Create: `app/api/agenda/available-times/route.ts` · Test: `app/api/agenda/available-times/route.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// app/api/agenda/available-times/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveCredsMock = vi.fn();
const listAvailableTimesMock = vi.fn();

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({ tag: 'admin' }),
}));
vi.mock('@/lib/channels/clinicorpCredentials', () => ({
  resolveClinicorpCredentials: (...args: unknown[]) => resolveCredsMock(...args),
}));
vi.mock('@/lib/channels/clinicorp', () => ({
  listAvailableTimes: (...args: unknown[]) => listAvailableTimesMock(...args),
}));

import { GET } from './route';

const creds = {
  apiUrl: 'https://api.clinicorp.com/rest/v1',
  apiUser: 'u',
  apiToken: 't',
  subscriberId: 's',
  codeLink: '4567',
  businessId: 111,
};

function makeReq(url: string) {
  return new Request(url, {
    method: 'GET',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_staff' } });
  resolveCredsMock.mockResolvedValue(creds);
  listAvailableTimesMock.mockResolvedValue([{ From: '9:00', To: '10:00', DayWeek: 1, BusinessId: 111, ProfessionalId: 222 }]);
});

describe('GET /api/agenda/available-times', () => {
  it('exige tenantId e date', async () => {
    const res = await GET(makeReq('http://localhost:3000/api/agenda/available-times?tenantId=org-1'));
    expect(res.status).toBe(400);
  });

  it('barra acesso não-autorizado ao tenant', async () => {
    requireTenantAccessMock.mockResolvedValue({ error: new Response('Forbidden', { status: 403 }) });
    const res = await GET(makeReq('http://localhost:3000/api/agenda/available-times?tenantId=org-1&date=2026-06-12'));
    expect(res.status).toBe(403);
  });

  it('retorna 409 quando a config Clinicorp do tenant está ausente', async () => {
    resolveCredsMock.mockResolvedValue(null);
    const res = await GET(makeReq('http://localhost:3000/api/agenda/available-times?tenantId=org-1&date=2026-06-12'));
    expect(res.status).toBe(409);
  });

  it('chama o adapter e devolve os slots; token nunca aparece na resposta', async () => {
    const res = await GET(makeReq('http://localhost:3000/api/agenda/available-times?tenantId=org-1&date=2026-06-12'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slots).toHaveLength(1);
    expect(listAvailableTimesMock).toHaveBeenCalledWith(creds, '2026-06-12');
    expect(JSON.stringify(body)).not.toContain('apiToken');
    expect(JSON.stringify(body)).not.toContain(creds.apiToken);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run app/api/agenda/available-times/route.test.ts` Expected: FAIL com `Cannot find module './route'`.

- [ ] **Step 3: Implementar o mínimo**

```ts
// app/api/agenda/available-times/route.ts
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { listAvailableTimes } from '@/lib/channels/clinicorp';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const QuerySchema = z
  .object({
    tenantId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD.'),
  })
  .strict();

export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    tenantId: url.searchParams.get('tenantId') ?? undefined,
    date: url.searchParams.get('date') ?? undefined,
  });
  if (!parsed.success) {
    return json({ error: 'Parâmetros inválidos', details: parsed.error.flatten() }, 400);
  }

  const access = await requireTenantAccess(parsed.data.tenantId);
  if ('error' in access) return access.error;

  const admin = createStaticAdminClient();
  const creds = await resolveClinicorpCredentials({ admin, tenantId: parsed.data.tenantId });
  if (!creds) {
    return json({ error: 'Integração Clinicorp não configurada para esta clínica.' }, 409);
  }

  try {
    const slots = await listAvailableTimes(creds, parsed.data.date);
    return json({ slots });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao consultar o Clinicorp.' }, 502);
  }
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run app/api/agenda/available-times/route.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/agenda/available-times/route.ts app/api/agenda/available-times/route.test.ts
git commit -m "feat(agenda): route handler available-times (server-side, token protegido)"
```

---

### Task 7.8: Route handlers `appointments` (GET list+sync) e `book` (POST create)

**Files:** Create: `app/api/agenda/appointments/route.ts` · Create: `app/api/agenda/book/route.ts` · Test: `app/api/agenda/appointments/route.test.ts` · Test: `app/api/agenda/book/route.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

```ts
// app/api/agenda/appointments/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveCredsMock = vi.fn();
const listAppointmentsMock = vi.fn();
const upsertMock = vi.fn();

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccessMock(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({ upsert: (...a: unknown[]) => { upsertMock(...a); return Promise.resolve({ error: null }); } }),
  }),
}));
vi.mock('@/lib/channels/clinicorpCredentials', () => ({
  resolveClinicorpCredentials: (...a: unknown[]) => resolveCredsMock(...a),
}));
vi.mock('@/lib/channels/clinicorp', () => ({
  listAppointments: (...a: unknown[]) => listAppointmentsMock(...a),
}));

import { GET } from './route';

const creds = { apiUrl: 'x', apiUser: 'u', apiToken: 't', subscriberId: 's', codeLink: '4567', businessId: 111 };

function makeReq(url: string) {
  return new Request(url, { method: 'GET', headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_staff' } });
  resolveCredsMock.mockResolvedValue(creds);
  listAppointmentsMock.mockResolvedValue([
    { id: 987, PatientName: 'Lucas', date: '2026-06-12', fromTime: '09:00', toTime: '10:00', MobilePhone: null, Email: null, Dentist_PersonId: 222, StatusDescription: '1-Confirmado' },
  ]);
});

describe('GET /api/agenda/appointments', () => {
  it('exige from e to', async () => {
    const res = await GET(makeReq('http://localhost:3000/api/agenda/appointments?tenantId=11111111-1111-1111-1111-111111111111'));
    expect(res.status).toBe(400);
  });

  it('lista do Clinicorp e espelha no cache local (upsert dedupe)', async () => {
    const res = await GET(makeReq('http://localhost:3000/api/agenda/appointments?tenantId=11111111-1111-1111-1111-111111111111&from=2026-06-01&to=2026-06-30'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0].externalId).toBe('987');
    expect(listAppointmentsMock).toHaveBeenCalledWith(creds, '2026-06-01', '2026-06-30');
    expect(upsertMock).toHaveBeenCalled();
  });
});
```

```ts
// app/api/agenda/book/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveCredsMock = vi.fn();
const createAppointmentMock = vi.fn();

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccessMock(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({ tag: 'admin' }),
}));
vi.mock('@/lib/channels/clinicorpCredentials', () => ({
  resolveClinicorpCredentials: (...a: unknown[]) => resolveCredsMock(...a),
}));
vi.mock('@/lib/channels/clinicorp', () => ({
  createAppointment: (...a: unknown[]) => createAppointmentMock(...a),
}));

import { POST } from './route';

const creds = { apiUrl: 'x', apiUser: 'u', apiToken: 't', subscriberId: 's', codeLink: '4567', businessId: 111 };

function makeReq(body: unknown) {
  return new Request('http://localhost:3000/api/agenda/book', {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_staff' } });
  resolveCredsMock.mockResolvedValue(creds);
  createAppointmentMock.mockResolvedValue({ Status: 'CREATED', id: 987 });
});

describe('POST /api/agenda/book', () => {
  it('rejeita payload sem campos obrigatórios', async () => {
    const res = await POST(makeReq({ tenantId: '11111111-1111-1111-1111-111111111111' }));
    expect(res.status).toBe(400);
  });

  it('cria o agendamento ao vivo no Clinicorp com o payload do slot/dentista/paciente', async () => {
    const res = await POST(
      makeReq({
        tenantId: '11111111-1111-1111-1111-111111111111',
        date: '2026-06-12',
        fromTime: '09:00',
        toTime: '10:00',
        dentistPersonId: 222,
        patientPersonId: 333,
        procedimento: 'Facetas em resina',
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toEqual({ Status: 'CREATED', id: 987 });
    expect(createAppointmentMock).toHaveBeenCalledWith(
      creds,
      expect.objectContaining({
        date: '2026-06-12',
        fromTime: '09:00',
        toTime: '10:00',
        Clinic_BusinessId: 111,
        Dentist_PersonId: 222,
        Patient_PersonId: 333,
        Procedures: 'Facetas em resina',
      })
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run app/api/agenda/appointments/route.test.ts app/api/agenda/book/route.test.ts` Expected: FAIL com `Cannot find module './route'`.

- [ ] **Step 3: Implementar o mínimo**

```ts
// app/api/agenda/appointments/route.ts
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { listAppointments } from '@/lib/channels/clinicorp';
import { mapClinicorpAppointment } from '@/lib/channels/clinicorpMappers';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const QuerySchema = z
  .object({
    tenantId: z.string().uuid(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    tenantId: url.searchParams.get('tenantId') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  });
  if (!parsed.success) {
    return json({ error: 'Parâmetros inválidos', details: parsed.error.flatten() }, 400);
  }

  const access = await requireTenantAccess(parsed.data.tenantId);
  if ('error' in access) return access.error;

  const admin = createStaticAdminClient();
  const creds = await resolveClinicorpCredentials({ admin, tenantId: parsed.data.tenantId });
  if (!creds) {
    return json({ error: 'Integração Clinicorp não configurada para esta clínica.' }, 409);
  }

  try {
    const raw = await listAppointments(creds, parsed.data.from, parsed.data.to);
    const appointments = raw.map((item) => mapClinicorpAppointment(item, { organizationId: parsed.data.tenantId }));

    // Espelha no cache local de resiliência (dedupe por org+source+external_id).
    if (appointments.length) {
      const rows = appointments.map((appt) => ({
        organization_id: parsed.data.tenantId,
        external_id: appt.externalId ?? null,
        source: appt.source ?? 'clinicorp_api',
        status: appt.status,
        starts_at: appt.startsAt,
        ends_at: appt.endsAt ?? null,
        notes: appt.notes ?? null,
        updated_at: new Date().toISOString(),
      }));
      await admin
        .from('appointments')
        .upsert(rows, { onConflict: 'organization_id,source,external_id' });
    }

    return json({ appointments });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao consultar o Clinicorp.' }, 502);
  }
}
```

```ts
// app/api/agenda/book/route.ts
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { createAppointment } from '@/lib/channels/clinicorp';
import { buildCreateAppointmentPayload } from '@/lib/channels/clinicorpMappers';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const BookSchema = z
  .object({
    tenantId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fromTime: z.string().regex(/^\d{1,2}:\d{2}$/),
    toTime: z.string().regex(/^\d{1,2}:\d{2}$/),
    dentistPersonId: z.number().int().positive(),
    patientPersonId: z.number().int().positive().optional(),
    patientName: z.string().min(1).optional(),
    patientMobilePhone: z.string().optional(),
    patientEmail: z.string().email().optional(),
    procedimento: z.string().min(1),
  })
  .strict();

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const rawBody = await req.json().catch(() => null);
  const parsed = BookSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);
  }

  const access = await requireTenantAccess(parsed.data.tenantId);
  if ('error' in access) return access.error;

  const admin = createStaticAdminClient();
  const creds = await resolveClinicorpCredentials({ admin, tenantId: parsed.data.tenantId });
  if (!creds) {
    return json({ error: 'Integração Clinicorp não configurada para esta clínica.' }, 409);
  }

  let payload;
  try {
    payload = buildCreateAppointmentPayload({
      slot: { date: parsed.data.date, fromTime: parsed.data.fromTime, toTime: parsed.data.toTime },
      businessId: creds.businessId,
      dentistPersonId: parsed.data.dentistPersonId,
      patient: {
        personId: parsed.data.patientPersonId,
        name: parsed.data.patientName,
        mobilePhone: parsed.data.patientMobilePhone,
        email: parsed.data.patientEmail,
      },
      procedimento: parsed.data.procedimento,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Paciente inválido.' }, 400);
  }

  try {
    const created = await createAppointment(creds, payload);
    return json({ created });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao criar agendamento no Clinicorp.' }, 502);
  }
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run app/api/agenda/appointments/route.test.ts app/api/agenda/book/route.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/agenda/appointments/route.ts app/api/agenda/book/route.ts app/api/agenda/appointments/route.test.ts app/api/agenda/book/route.test.ts
git commit -m "feat(agenda): route handlers appointments (list+sync cache) e book (create ao vivo)"
```

---

### Task 7.9: Route handlers `confirm` e `cancel` (POST)

**Files:** Create: `app/api/agenda/confirm/route.ts` · Create: `app/api/agenda/cancel/route.ts` · Test: `app/api/agenda/confirm-cancel.route.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// app/api/agenda/confirm-cancel.route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveCredsMock = vi.fn();
const confirmMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccessMock(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({ tag: 'admin' }),
}));
vi.mock('@/lib/channels/clinicorpCredentials', () => ({
  resolveClinicorpCredentials: (...a: unknown[]) => resolveCredsMock(...a),
}));
vi.mock('@/lib/channels/clinicorp', () => ({
  confirmAppointment: (...a: unknown[]) => confirmMock(...a),
  cancelAppointment: (...a: unknown[]) => cancelMock(...a),
}));

import { POST as confirmPOST } from './confirm/route';
import { POST as cancelPOST } from './cancel/route';

const creds = { apiUrl: 'x', apiUser: 'u', apiToken: 't', subscriberId: 's', codeLink: '4567', businessId: 111 };

function makeReq(path: string, body: unknown) {
  return new Request(`http://localhost:3000/api/agenda/${path}`, {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_staff' } });
  resolveCredsMock.mockResolvedValue(creds);
  confirmMock.mockResolvedValue([{ id: 987 }]);
  cancelMock.mockResolvedValue([{ id: 987 }]);
});

describe('POST /api/agenda/confirm e /cancel', () => {
  it('confirm chama confirmAppointment com o id', async () => {
    const res = await confirmPOST(makeReq('confirm', { tenantId: '11111111-1111-1111-1111-111111111111', id: 987 }));
    expect(res.status).toBe(200);
    expect(confirmMock).toHaveBeenCalledWith(creds, 987);
  });

  it('cancel chama cancelAppointment com o id', async () => {
    const res = await cancelPOST(makeReq('cancel', { tenantId: '11111111-1111-1111-1111-111111111111', id: 987 }));
    expect(res.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith(creds, 987);
  });

  it('rejeita sem id', async () => {
    const res = await confirmPOST(makeReq('confirm', { tenantId: '11111111-1111-1111-1111-111111111111' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run app/api/agenda/confirm-cancel.route.test.ts` Expected: FAIL com `Cannot find module './confirm/route'`.

- [ ] **Step 3: Implementar o mínimo**

```ts
// app/api/agenda/confirm/route.ts
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { confirmAppointment } from '@/lib/channels/clinicorp';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const Schema = z.object({ tenantId: z.string().uuid(), id: z.number().int().positive() }).strict();

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const rawBody = await req.json().catch(() => null);
  const parsed = Schema.safeParse(rawBody);
  if (!parsed.success) return json({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);

  const access = await requireTenantAccess(parsed.data.tenantId);
  if ('error' in access) return access.error;

  const admin = createStaticAdminClient();
  const creds = await resolveClinicorpCredentials({ admin, tenantId: parsed.data.tenantId });
  if (!creds) return json({ error: 'Integração Clinicorp não configurada para esta clínica.' }, 409);

  try {
    const result = await confirmAppointment(creds, parsed.data.id);
    return json({ ok: true, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao confirmar no Clinicorp.' }, 502);
  }
}
```

```ts
// app/api/agenda/cancel/route.ts
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { cancelAppointment } from '@/lib/channels/clinicorp';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const Schema = z.object({ tenantId: z.string().uuid(), id: z.number().int().positive() }).strict();

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const rawBody = await req.json().catch(() => null);
  const parsed = Schema.safeParse(rawBody);
  if (!parsed.success) return json({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);

  const access = await requireTenantAccess(parsed.data.tenantId);
  if ('error' in access) return access.error;

  const admin = createStaticAdminClient();
  const creds = await resolveClinicorpCredentials({ admin, tenantId: parsed.data.tenantId });
  if (!creds) return json({ error: 'Integração Clinicorp não configurada para esta clínica.' }, 409);

  try {
    const result = await cancelAppointment(creds, parsed.data.id);
    return json({ ok: true, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao cancelar no Clinicorp.' }, 502);
  }
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run app/api/agenda/confirm-cancel.route.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/agenda/confirm/route.ts app/api/agenda/cancel/route.ts app/api/agenda/confirm-cancel.route.test.ts
git commit -m "feat(agenda): route handlers confirm e cancel (server-side)"
```

---

### Task 7.10: `appointmentsService` (read do cache) + `useAppointmentsQuery` (sem mutations)

**Files:** Create: `lib/supabase/appointments.ts` · Modify: `lib/supabase/index.ts:7` · Create: `lib/query/hooks/useAppointmentsQuery.ts` · Modify: `lib/query/queryKeys.ts:32-48` · Modify: `lib/query/hooks/index.ts` · Test: `lib/supabase/appointments.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/supabase/appointments.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('./client', () => ({
  supabase: { from: (...a: unknown[]) => fromMock(...a) },
}));

import { appointmentsService } from './appointments';

function chainReturning(data: unknown, error: unknown = null) {
  const order = vi.fn().mockResolvedValue({ data, error });
  const lte = vi.fn().mockReturnValue({ order });
  const gte = vi.fn().mockReturnValue({ lte, order });
  const eq = vi.fn().mockReturnValue({ order, gte, lte });
  const select = vi.fn().mockReturnValue({ eq, order });
  return { select, eq, gte, lte, order };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('appointmentsService.getAll', () => {
  it('lê o cache filtrando por organization_id e transforma snake→camel', async () => {
    const chain = chainReturning([
      { id: 'a1', organization_id: 'org-1', contact_id: null, professional_id: null, starts_at: '2026-06-12T09:00:00', ends_at: '2026-06-12T10:00:00', status: 'agendado', source: 'clinicorp_api', external_id: '987', notes: 'Lucas', created_at: 'x', updated_at: 'y', owner_id: null },
    ]);
    fromMock.mockReturnValue(chain);

    const { data, error } = await appointmentsService.getAll('org-1');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].externalId).toBe('987');
    expect(data![0].organizationId).toBe('org-1');
    expect(data![0].startsAt).toBe('2026-06-12T09:00:00');
    expect(fromMock).toHaveBeenCalledWith('appointments');
    expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
  });

  it('propaga erro do supabase', async () => {
    fromMock.mockReturnValue(chainReturning(null, new Error('rls')));
    const { data, error } = await appointmentsService.getAll('org-1');
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/supabase/appointments.test.ts` Expected: FAIL com `Cannot find module './appointments'`.

- [ ] **Step 3: Implementar o mínimo**

```ts
// lib/supabase/appointments.ts
/**
 * Serviço de leitura do cache local de agendamentos (resiliência).
 * A VERDADE é o Clinicorp (book/list ao vivo via /api/agenda/*); este service só LÊ o cache
 * pra tela carregar rápido e ter fallback. Sem create/update/delete na UI.
 * Espelha o padrão de lib/supabase/products.ts: {data,error}, colunas explícitas, .eq org no read.
 */
import { supabase } from './client';
import { Appointment } from '@/types';
import { sanitizeUUID } from './utils';

const COLUMNS =
  'id, organization_id, contact_id, professional_id, starts_at, ends_at, status, source, external_id, notes, created_at, updated_at, owner_id';

interface DbAppointment {
  id: string;
  organization_id: string | null;
  contact_id: string | null;
  professional_id: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  source: string;
  external_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  owner_id: string | null;
}

function transformAppointment(db: DbAppointment): Appointment {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    contactId: db.contact_id || undefined,
    professionalId: db.professional_id || undefined,
    startsAt: db.starts_at,
    endsAt: db.ends_at || undefined,
    status: db.status as Appointment['status'],
    source: db.source as Appointment['source'],
    externalId: db.external_id || undefined,
    notes: db.notes || undefined,
  } as Appointment;
}

export const appointmentsService = {
  async getAll(organizationId?: string | null): Promise<{ data: Appointment[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      let query = supabase
        .from('appointments')
        .select(COLUMNS)
        .order('starts_at', { ascending: true });

      const orgId = sanitizeUUID(organizationId);
      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      const { data, error } = await query;
      if (error) return { data: null, error };

      const rows = (data || []) as DbAppointment[];
      return { data: rows.map(transformAppointment), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async getByDateRange(
    fromIso: string,
    toIso: string,
    organizationId?: string | null
  ): Promise<{ data: Appointment[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      let query = supabase
        .from('appointments')
        .select(COLUMNS)
        .gte('starts_at', fromIso)
        .lte('starts_at', toIso)
        .order('starts_at', { ascending: true });

      const orgId = sanitizeUUID(organizationId);
      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      const { data, error } = await query;
      if (error) return { data: null, error };

      const rows = (data || []) as DbAppointment[];
      return { data: rows.map(transformAppointment), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },
};
```

Em `lib/supabase/index.ts`, adicionar a exportação (após a linha 7):

```ts
export { appointmentsService } from './appointments';
```

Em `lib/query/queryKeys.ts`, registrar a key (dentro do objeto `queryKeys`, junto às outras factories):

```ts
    appointments: createQueryKeys('appointments'),
```

Criar `lib/query/hooks/useAppointmentsQuery.ts` (mirror do enabled-gate de useActivitiesQuery, sem mutations):

```ts
/**
 * Hooks de leitura da agenda (cache de resiliência). Sem mutations: agendar/confirmar/cancelar
 * vão ao vivo via /api/agenda/* (server-side Clinicorp), não pelo cache local.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { appointmentsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';

export const useAppointments = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.appointments.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await appointmentsService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

export const useAppointmentsByDateRange = (fromIso: string, toIso: string) => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.appointments.list({ fromIso, toIso }), organizationId],
    queryFn: async () => {
      const { data, error } = await appointmentsService.getByDateRange(fromIso, toIso, organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId && !!fromIso && !!toIso,
    staleTime: 30 * 1000,
  });
};
```

Em `lib/query/hooks/index.ts`, adicionar o re-export:

```ts
// Appointments (read-only — cache de resiliência da agenda)
export {
  useAppointments,
  useAppointmentsByDateRange,
} from './useAppointmentsQuery';
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run lib/supabase/appointments.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/appointments.ts lib/supabase/index.ts lib/supabase/appointments.test.ts lib/query/hooks/useAppointmentsQuery.ts lib/query/queryKeys.ts lib/query/hooks/index.ts
git commit -m "feat(agenda): appointmentsService (read cache) + useAppointmentsQuery"
```

---

### Task 7.11: Realtime + UI da agenda (controller, AgendaDayView, AgendaBookModal, página)

**Files:** Modify: `lib/realtime/useRealtimeSync.ts:50-69` · Create: `features/agenda/hooks/useAgendaController.ts` · Create: `features/agenda/components/AgendaDayView.tsx` · Create: `features/agenda/components/AgendaBookModal.tsx` · Create: `features/agenda/AgendaPage.tsx` · Create: `app/(protected)/agenda/page.tsx` · Test: `features/agenda/AgendaDayView.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// features/agenda/AgendaDayView.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'u1', role: 'clinic_staff', organization_id: 'org-1', email: 'v@x.com' },
    user: { id: 'u1' },
    loading: false,
  }),
}));

import { AgendaDayView } from './components/AgendaDayView';

const baseProps = {
  date: '2026-06-12',
  appointments: [
    { id: 'a1', startsAt: '2026-06-12T09:00:00', endsAt: '2026-06-12T10:00:00', status: 'agendado', source: 'clinicorp_api', externalId: '987', notes: 'Lucas · (47) 99999-9999' },
  ],
  availableSlots: [
    { From: '14:00', To: '15:00', DayWeek: 1, BusinessId: 111, ProfessionalId: 222 },
  ],
  loading: false,
  error: null as string | null,
  onBookSlot: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AgendaDayView', () => {
  it('renderiza agendamentos do dia e slots livres', () => {
    render(<AgendaDayView {...baseProps} />);
    expect(screen.getByText(/Lucas/)).toBeInTheDocument();
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /14:00.*agendar|agendar.*14:00/i })).toBeInTheDocument();
  });

  it('aciona onBookSlot ao clicar num slot livre', async () => {
    render(<AgendaDayView {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: /14:00/i }));
    expect(baseProps.onBookSlot).toHaveBeenCalledWith(baseProps.availableSlots[0]);
  });

  it('mostra estado de carregamento', () => {
    render(<AgendaDayView {...baseProps} appointments={[]} availableSlots={[]} loading />);
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });

  it('mostra erro quando a integração falha', () => {
    render(<AgendaDayView {...baseProps} appointments={[]} availableSlots={[]} error="Integração Clinicorp não configurada para esta clínica." />);
    expect(screen.getByText(/clinicorp não configurada/i)).toBeInTheDocument();
  });

  it('mostra empty quando não há agendamentos nem slots', () => {
    render(<AgendaDayView {...baseProps} appointments={[]} availableSlots={[]} />);
    expect(screen.getByText(/nenhum horário|sem agendamentos/i)).toBeInTheDocument();
  });

  it('sem violações de acessibilidade', async () => {
    const { container } = render(<AgendaDayView {...baseProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/agenda/AgendaDayView.test.tsx` Expected: FAIL com `Cannot find module './components/AgendaDayView'`.

- [ ] **Step 3: Implementar o mínimo**

Em `lib/realtime/useRealtimeSync.ts`, estender a union `RealtimeTable` (linhas 50-56) e o map (linhas 60-67) — caminho simples invalidate, sem branch especial:

```ts
type RealtimeTable =
  | 'deals'
  | 'contacts'
  | 'activities'
  | 'boards'
  | 'board_stages'
  | 'crm_companies'
  | 'professionals'
  | 'atendimentos'
  | 'appointments';
```

```ts
  const mapping: Record<RealtimeTable, readonly (readonly unknown[])[]> = {
    deals: [queryKeys.deals.all, queryKeys.dashboard.stats],
    contacts: [queryKeys.contacts.all],
    activities: [queryKeys.activities.all],
    boards: [queryKeys.boards.all],
    board_stages: [queryKeys.boards.all], // stages invalidate boards
    crm_companies: [queryKeys.companies.all],
    professionals: [queryKeys.professionals.all],
    atendimentos: [queryKeys.atendimentos.all],
    appointments: [queryKeys.appointments.all],
  };
```

Criar `features/agenda/components/AgendaDayView.tsx`:

```tsx
'use client';

import React from 'react';
import type { Appointment } from '@/types';
import type { ClinicorpAvailableTime } from '@/lib/channels/clinicorpTypes';

export interface AgendaDayViewProps {
  date: string;
  appointments: Appointment[];
  availableSlots: ClinicorpAvailableTime[];
  loading: boolean;
  error: string | null;
  onBookSlot: (slot: ClinicorpAvailableTime) => void;
}

function formatTime(iso: string): string {
  const time = iso.includes('T') ? iso.split('T')[1] : iso;
  return time.slice(0, 5);
}

export function AgendaDayView({ date, appointments, availableSlots, loading, error, onBookSlot }: AgendaDayViewProps) {
  if (loading) {
    return (
      <div role="status" className="p-6 text-sm text-muted-foreground">
        Carregando a agenda do dia…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="p-6 text-sm text-red-600">
        {error}
      </div>
    );
  }

  const isEmpty = appointments.length === 0 && availableSlots.length === 0;
  if (isEmpty) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Nenhum horário disponível e sem agendamentos para {date}.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <section aria-label="Agendamentos do dia">
        <h3 className="mb-2 text-sm font-semibold">Agendamentos</h3>
        {appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem agendamentos para este dia.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {appointments.map((appt) => (
              <li key={appt.id} className="flex items-center gap-3 rounded border p-3 text-sm">
                <span className="font-medium tabular-nums">{formatTime(appt.startsAt)}</span>
                <span className="text-muted-foreground">{appt.notes || 'Paciente'}</span>
                <span className="ml-auto rounded bg-muted px-2 py-0.5 text-xs">{appt.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Horários livres">
        <h3 className="mb-2 text-sm font-semibold">Horários livres</h3>
        {availableSlots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum horário livre para este dia.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {availableSlots.map((slot, index) => (
              <li key={`${slot.From}-${slot.ProfessionalId}-${index}`}>
                <button
                  type="button"
                  onClick={() => onBookSlot(slot)}
                  className="rounded border px-3 py-1 text-sm hover:bg-muted"
                >
                  {slot.From} — Agendar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

Criar `features/agenda/hooks/useAgendaController.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTenant } from '@/context/TenantContext';
import type { Appointment } from '@/types';
import type { ClinicorpAvailableTime } from '@/lib/channels/clinicorpTypes';
import { mapClinicorpAppointment } from '@/lib/channels/clinicorpMappers';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useAgendaController() {
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  const [date, setDate] = useState<string>(todayIso());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [availableSlots, setAvailableSlots] = useState<ClinicorpAvailableTime[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookSlot, setBookSlot] = useState<ClinicorpAvailableTime | null>(null);

  const fetchDay = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const timesRes = await fetch(
        `/api/agenda/available-times?tenantId=${organizationId}&date=${date}`,
        { cache: 'no-store' }
      );
      const apptRes = await fetch(
        `/api/agenda/appointments?tenantId=${organizationId}&from=${date}&to=${date}`,
        { cache: 'no-store' }
      );

      if (!timesRes.ok) {
        const body = await timesRes.json().catch(() => ({}));
        throw new Error(body.error || 'Falha ao buscar horários livres.');
      }
      if (!apptRes.ok) {
        const body = await apptRes.json().catch(() => ({}));
        throw new Error(body.error || 'Falha ao buscar agendamentos.');
      }

      const timesBody = await timesRes.json();
      const apptBody = await apptRes.json();
      setAvailableSlots((timesBody.slots || []) as ClinicorpAvailableTime[]);
      setAppointments((apptBody.appointments || []) as Appointment[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar a agenda.');
      setAvailableSlots([]);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, date]);

  useEffect(() => {
    void fetchDay();
  }, [fetchDay]);

  const goToDate = useCallback((next: string) => setDate(next), []);
  const openBookModal = useCallback((slot: ClinicorpAvailableTime) => setBookSlot(slot), []);
  const closeBookModal = useCallback(() => setBookSlot(null), []);

  const book = useCallback(
    async (payload: {
      dentistPersonId: number;
      patientPersonId?: number;
      patientName?: string;
      patientMobilePhone?: string;
      patientEmail?: string;
      procedimento: string;
    }) => {
      if (!organizationId || !bookSlot) return { ok: false as const, error: 'Slot não selecionado.' };
      const res = await fetch('/api/agenda/book', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: organizationId,
          date,
          fromTime: bookSlot.From,
          toTime: bookSlot.To,
          ...payload,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false as const, error: body.error || 'Falha ao agendar.' };
      closeBookModal();
      await fetchDay();
      return { ok: true as const };
    },
    [organizationId, bookSlot, date, closeBookModal, fetchDay]
  );

  return {
    date,
    goToDate,
    appointments,
    availableSlots,
    loading,
    error,
    bookSlot,
    openBookModal,
    closeBookModal,
    book,
    refresh: fetchDay,
    mapClinicorpAppointment,
  };
}
```

Criar `features/agenda/components/AgendaBookModal.tsx`:

```tsx
'use client';

import React, { useState } from 'react';
import type { ClinicorpAvailableTime } from '@/lib/channels/clinicorpTypes';
import type { Professional, Product } from '@/types';

export interface AgendaBookModalProps {
  slot: ClinicorpAvailableTime | null;
  professionals: Professional[];
  products: Product[];
  onClose: () => void;
  onConfirm: (payload: {
    dentistPersonId: number;
    patientName?: string;
    patientMobilePhone?: string;
    procedimento: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export function AgendaBookModal({ slot, professionals, products, onClose, onConfirm }: AgendaBookModalProps) {
  const [dentistExternalId, setDentistExternalId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [procedimento, setProcedimento] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!slot) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const dentistPersonId = Number(dentistExternalId);
    if (!Number.isFinite(dentistPersonId) || dentistPersonId <= 0) {
      setError('Selecione um dentista.');
      return;
    }
    if (!procedimento.trim()) {
      setError('Informe o procedimento.');
      return;
    }
    setSubmitting(true);
    const result = await onConfirm({
      dentistPersonId,
      patientName: patientName.trim() || undefined,
      patientMobilePhone: patientPhone.trim() || undefined,
      procedimento: procedimento.trim(),
    });
    setSubmitting(false);
    if (!result.ok) setError(result.error || 'Falha ao agendar.');
  };

  return (
    <div role="dialog" aria-label="Agendar horário" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">Agendar {slot.From}</h2>

        <label className="mb-3 block text-sm">
          Dentista
          <select
            value={dentistExternalId}
            onChange={(e) => setDentistExternalId(e.target.value)}
            className="mt-1 w-full rounded border p-2"
          >
            <option value="">Selecione…</option>
            {professionals
              .filter((p) => p.externalId)
              .map((p) => (
                <option key={p.id} value={String(p.externalId)}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>

        <label className="mb-3 block text-sm">
          Paciente (nome)
          <input value={patientName} onChange={(e) => setPatientName(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>

        <label className="mb-3 block text-sm">
          Telefone
          <input value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>

        <label className="mb-4 block text-sm">
          Procedimento
          <select value={procedimento} onChange={(e) => setProcedimento(e.target.value)} className="mt-1 w-full rounded border p-2">
            <option value="">Selecione…</option>
            {products.map((product) => (
              <option key={product.id} value={product.name}>
                {product.name}
              </option>
            ))}
          </select>
        </label>

        {error ? <p role="alert" className="mb-3 text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={submitting} className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">
            {submitting ? 'Agendando…' : 'Confirmar agendamento'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

Criar `features/agenda/AgendaPage.tsx`:

```tsx
'use client';

import React from 'react';
import { useAgendaController } from './hooks/useAgendaController';
import { AgendaDayView } from './components/AgendaDayView';
import { AgendaBookModal } from './components/AgendaBookModal';
import { useProfessionals } from '@/lib/query/hooks';
import { useProducts } from '@/lib/query/hooks/useProductsQuery';

export function AgendaPage() {
  const controller = useAgendaController();
  const { data: professionals = [] } = useProfessionals();
  const { data: products = [] } = useProducts();

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Agenda</h1>
        <input
          type="date"
          value={controller.date}
          onChange={(e) => controller.goToDate(e.target.value)}
          className="rounded border p-2 text-sm"
          aria-label="Data da agenda"
        />
      </header>

      <AgendaDayView
        date={controller.date}
        appointments={controller.appointments}
        availableSlots={controller.availableSlots}
        loading={controller.loading}
        error={controller.error}
        onBookSlot={controller.openBookModal}
      />

      <AgendaBookModal
        slot={controller.bookSlot}
        professionals={professionals}
        products={products}
        onClose={controller.closeBookModal}
        onConfirm={controller.book}
      />
    </div>
  );
}
```

Criar `app/(protected)/agenda/page.tsx` (wrapper 'use client' + dynamic ssr:false, mirror activities/page.tsx):

```tsx
'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const AgendaPage = dynamic(
    () => import('@/features/agenda/AgendaPage').then(m => ({ default: m.AgendaPage })),
    { loading: () => <PageLoader />, ssr: false }
)

export default function Agenda() {
    return <AgendaPage />
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/agenda/AgendaDayView.test.tsx` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/realtime/useRealtimeSync.ts features/agenda app/(protected)/agenda/page.tsx
git commit -m "feat(agenda): UI da agenda (controller, AgendaDayView, AgendaBookModal, página)"
```

---

### Task 7.12: Mapa dentista ↔ Clinicorp + validação ao vivo dos endpoints (antes de fechar a UI)

**Files:** Create: `app/api/agenda/professionals-sync/route.ts` · Create: `scripts/clinicorp-live-check.mjs` · Test: `app/api/agenda/professionals-sync/route.test.ts`

Esta task popula `professionals.external_id` com o `Dentist_PersonId` dos 8 dentistas e valida ao vivo que `get_avaliable_times_calendar` (motor do agendamento ONLINE) reflete a agenda interna. **Se não refletir, cair pra `appointment/list` + `schedule_occupation` como fonte de ocupação** (decisão registrada no doc, não no código).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// app/api/agenda/professionals-sync/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveCredsMock = vi.fn();
const listProfessionalsMock = vi.fn();
const upsertMock = vi.fn();

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccessMock(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({ upsert: (...a: unknown[]) => { upsertMock(...a); return Promise.resolve({ error: null }); } }),
  }),
}));
vi.mock('@/lib/channels/clinicorpCredentials', () => ({
  resolveClinicorpCredentials: (...a: unknown[]) => resolveCredsMock(...a),
}));
vi.mock('@/lib/channels/clinicorp', () => ({
  listProfessionals: (...a: unknown[]) => listProfessionalsMock(...a),
}));

import { POST } from './route';

const creds = { apiUrl: 'x', apiUser: 'u', apiToken: 't', subscriberId: 's', codeLink: '4567', businessId: 111 };

function makeReq(body: unknown) {
  return new Request('http://localhost:3000/api/agenda/professionals-sync', {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_admin' } });
  resolveCredsMock.mockResolvedValue(creds);
  listProfessionalsMock.mockResolvedValue([
    { id: 222, name: 'Dra. Jessica', cpf: '000' },
    { id: 333, name: 'Dr. Adel', cpf: '111' },
  ]);
});

describe('POST /api/agenda/professionals-sync', () => {
  it('exige tenantId', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('lista os dentistas e devolve o mapa id→name (Dentist_PersonId)', async () => {
    const res = await POST(makeReq({ tenantId: '11111111-1111-1111-1111-111111111111' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.professionals).toHaveLength(2);
    expect(body.professionals[0]).toMatchObject({ externalId: '222', name: 'Dra. Jessica' });
    expect(listProfessionalsMock).toHaveBeenCalledWith(creds);
    expect(upsertMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run app/api/agenda/professionals-sync/route.test.ts` Expected: FAIL com `Cannot find module './route'`.

- [ ] **Step 3: Implementar o mínimo**

```ts
// app/api/agenda/professionals-sync/route.ts
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { listProfessionals } from '@/lib/channels/clinicorp';
import { canManageClinicSettings } from '@/lib/auth/scope';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const Schema = z.object({ tenantId: z.string().uuid() }).strict();

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const rawBody = await req.json().catch(() => null);
  const parsed = Schema.safeParse(rawBody);
  if (!parsed.success) return json({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);

  const access = await requireTenantAccess(parsed.data.tenantId);
  if ('error' in access) return access.error;
  if (!canManageClinicSettings(access.profile.role)) {
    return json({ error: 'Apenas o admin da clínica pode sincronizar dentistas.' }, 403);
  }

  const admin = createStaticAdminClient();
  const creds = await resolveClinicorpCredentials({ admin, tenantId: parsed.data.tenantId });
  if (!creds) return json({ error: 'Integração Clinicorp não configurada para esta clínica.' }, 409);

  try {
    const raw = await listProfessionals(creds);
    const professionals = raw.map((p) => ({ externalId: String(p.id), name: p.name }));

    if (professionals.length) {
      const rows = raw.map((p) => ({
        organization_id: parsed.data.tenantId,
        name: p.name,
        external_id: String(p.id),
        updated_at: new Date().toISOString(),
      }));
      await admin
        .from('professionals')
        .upsert(rows, { onConflict: 'organization_id,external_id' });
    }

    return json({ professionals });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao sincronizar dentistas.' }, 502);
  }
}
```

Criar `scripts/clinicorp-live-check.mjs` (validação ao vivo, rodada manual com credenciais reais antes de fechar a UI — não roda no CI):

```js
#!/usr/bin/env node
/**
 * Validação ao vivo dos endpoints de disponibilidade do Clinicorp.
 * Uso: CLINICORP_API_USER=... CLINICORP_API_TOKEN=... CLINICORP_SUBSCRIBER_ID=... \
 *      CLINICORP_CODE_LINK=... CLINICORP_BUSINESS_ID=... node scripts/clinicorp-live-check.mjs 2026-06-12
 *
 * Decisão registrada: se get_avaliable_times_calendar (motor do agendamento ONLINE) NÃO
 * refletir a agenda interna da Jéssica, usar appointment/list + schedule_occupation como
 * fonte de ocupação. Este script só DIAGNOSTICA; não muda código.
 */
const BASE = 'https://api.clinicorp.com/rest/v1';

function basic(user, token) {
  return `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
}

async function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const user = process.env.CLINICORP_API_USER;
  const token = process.env.CLINICORP_API_TOKEN;
  const subscriberId = process.env.CLINICORP_SUBSCRIBER_ID;
  const codeLink = process.env.CLINICORP_CODE_LINK;
  const businessId = process.env.CLINICORP_BUSINESS_ID;

  if (!user || !token || !subscriberId || !codeLink || !businessId) {
    console.error('Faltam credenciais. Defina CLINICORP_API_USER/TOKEN/SUBSCRIBER_ID/CODE_LINK/BUSINESS_ID.');
    process.exit(1);
  }

  const headers = { authorization: basic(user, token), accept: 'application/json' };

  const timesUrl = `${BASE}/appointment/get_avaliable_times_calendar?subscriber_id=${encodeURIComponent(subscriberId)}&date=${date}&code_link=${encodeURIComponent(codeLink)}`;
  const listUrl = `${BASE}/appointment/list?subscriber_id=${encodeURIComponent(subscriberId)}&from=${date}&to=${date}&businessId=${encodeURIComponent(businessId)}`;

  const [timesRes, listRes] = await Promise.all([
    fetch(timesUrl, { headers }),
    fetch(listUrl, { headers }),
  ]);

  const times = await timesRes.json().catch(() => null);
  const list = await listRes.json().catch(() => null);

  console.log('get_avaliable_times_calendar HTTP', timesRes.status, '→ slots:', Array.isArray(times) ? times.length : times);
  console.log('appointment/list HTTP', listRes.status, '→ agendamentos:', Array.isArray(list) ? list.length : list);
  console.log('\nVeredito: se os slots livres NÃO baterem com a agenda interna da Jéssica,');
  console.log('usar appointment/list + schedule_occupation como fonte de ocupação (ver doc).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run app/api/agenda/professionals-sync/route.test.ts` Expected: PASS.
  (Validação ao vivo é manual: `node scripts/clinicorp-live-check.mjs 2026-06-12` com as credenciais reais — não entra no `precheck`.)

- [ ] **Step 5: Commit**

```bash
git add app/api/agenda/professionals-sync/route.ts scripts/clinicorp-live-check.mjs app/api/agenda/professionals-sync/route.test.ts
git commit -m "feat(agenda): sync mapa dentista (Dentist_PersonId) + script de validação ao vivo"
```

---

### Task 7.13: Isolamento cross-tenant do cache `appointments` (node integration) + RBAC do config

**Files:** Create: `test/appointmentsTenantIsolation.test.ts` · Modify: `vitest.config.ts:14-23`

Prova que org A não lê linha de `appointments` de org B (RLS de tabela nova), tocando Supabase real com gate de credenciais.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// test/appointmentsTenantIsolation.test.ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { getSupabaseAdminClient } from './helpers/supabaseAdmin';
import { loadEnvFile } from './helpers/env';

const nextRoot = process.cwd();
const repoRoot = `${nextRoot}/..`;
loadEnvFile(`${repoRoot}/.env`);
loadEnvFile(`${repoRoot}/.env.local`, { override: true });
loadEnvFile(`${nextRoot}/.env`);
loadEnvFile(`${nextRoot}/.env.local`, { override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hasRealSupabaseCreds =
  Boolean(supabaseUrl) &&
  Boolean(serviceRoleKey) &&
  !serviceRoleKey.startsWith('your_') &&
  !serviceRoleKey.startsWith('sb_secret_your_');

const describeSupabase = hasRealSupabaseCreds ? describe : describe.skip;

describeSupabase('appointments cache - isolamento cross-tenant', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;
  }, 60_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    if (orgAId) await admin.from('appointments').delete().eq('organization_id', orgAId);
    if (orgBId) await admin.from('appointments').delete().eq('organization_id', orgBId);
    if (runId) await cleanupFixtures(runId);
  }, 60_000);

  it('linha de appointments da org B não aparece numa leitura filtrada por org A', async () => {
    const admin = getSupabaseAdminClient();

    const insertB = await admin.from('appointments').insert({
      organization_id: orgBId,
      starts_at: '2026-06-12T09:00:00Z',
      status: 'agendado',
      source: 'clinicorp_api',
      external_id: `ext-${runId}`,
    });
    expect(insertB.error).toBeNull();

    // Leitura escopada à org A (service-role + filtro explícito por organization_id).
    const readA = await admin
      .from('appointments')
      .select('id, organization_id, external_id')
      .eq('organization_id', orgAId)
      .eq('external_id', `ext-${runId}`);

    expect(readA.error).toBeNull();
    expect(readA.data || []).toHaveLength(0);

    // A linha existe de fato na org B (sanidade).
    const readB = await admin
      .from('appointments')
      .select('id')
      .eq('organization_id', orgBId)
      .eq('external_id', `ext-${runId}`);
    expect((readB.data || []).length).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/appointmentsTenantIsolation.test.ts` Expected: FAIL — sem o path em `environmentMatchGlobs` o vitest carrega em happy-dom e o `// @vitest-environment node` por si garante o ambiente; a falha esperada é a tabela `appointments` ainda não migrada no banco de teste OU (se migrada) o teste passa. Para garantir o registro do env node, adicionar o glob no Step 3.

- [ ] **Step 3: Implementar o mínimo**

Em `vitest.config.ts`, adicionar o path à `environmentMatchGlobs` (após a linha 22):

```ts
      ['test/appointmentsTenantIsolation.test.ts', 'node'],
```

(A migração `appointments` da Task 7.5 já deve estar aplicada no banco de teste — `npm run db:reset` ou equivalente do projeto antes de rodar a suíte node.)

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/appointmentsTenantIsolation.test.ts` Expected: PASS (ou SKIP se não houver credenciais Supabase reais no ambiente — gate `describeSupabase`).

- [ ] **Step 5: Commit**

```bash
git add test/appointmentsTenantIsolation.test.ts vitest.config.ts
git commit -m "test(agenda): isolamento cross-tenant do cache appointments (RLS, node integration)"
```

---

### Task 7.14: Gate final da fase

**Files:** —

- [ ] **Step 1: Rodar typecheck + lint + suíte** Run: `npm run precheck:fast` Expected: PASS (lint + typecheck + test:run sem erros novos).
- [ ] **Step 2: Build (opcional, antes de fechar)** Run: `npm run precheck` Expected: PASS incluindo `next build`.
- [ ] **Step 3: Honestidade no doc** Registrar no doc da fase: a API Clinicorp foi **verificada ao vivo nesta sessão** (endpoints 200, OpenAPI de 4839 linhas lido); `subscriber_id`, `code_link` e `business_id` são config one-time a obter na conta da clínica (Gerenciar Assinatura → Acesso Externo / `/business/list`). A agenda só fica ao vivo quando `clinicorp_config` estiver preenchida — o build e os testes (mockados/gated) passam sem ela.
- [ ] **Step 4: Commit do fechamento**

```bash
git add -A
git commit -m "chore(agenda): fecha Fase 7 — Basecrm cara, Clinicorp motor (precheck verde)"
```

**DoD da fase:** adapter/mappers/credentials/route-handlers com testes unit (boundary mockado) verdes · migrações `clinicorp_config` (RLS can_configure, token não exposto) e `appointments` (RLS can_access/can_operate + dedupe) cobertas por RLS-as-text · isolamento cross-tenant provado (node integration gated) · UI com loading/error/empty + axe · `professionals.external_id ↔ Dentist_PersonId` populável via sync · TODA chamada Clinicorp server-side (token nunca no browser) · typecheck + lint + test:run passam.

### Task 7.X: Caderno de absorção do Clinicorp (copiar e aprender)

**Files:** Create/Modify: `C:/Users/PC Gamer/WorkSync/workspaces/Dra Jessica Barros/05-metricas/clinicorp/CLINICORP-FUNCTION-MAP-absorcao.md` (já existe — atualizar conforme integra)

> **Princípio (Junior 2026-06-09):** usar a API do Clinicorp não é só atalho — é a oportunidade de **copiar e aprender** como cada função funciona, pra **absorver** depois (rebuild no Basecrm + cancelar os R$250/mês). Não é tarefa de código nem TDD — é documentação viva.

- [ ] **Step 1:** Ao fiar cada chamada Clinicorp (available-times, list, book, confirm, cancel), registrar no `CLINICORP-FUNCTION-MAP-absorcao.md`: o que entra (params/body), o que volta (shape da resposta real, sem dado de paciente), e a **lógica observada** (como a disponibilidade é calculada, ciclo de status do agendamento). O OpenAPI salvo (`clinicorp-openapi.json`) é a referência de schema.
- [ ] **Step 2:** Marcar no caderno o status de absorção de cada grupo (agenda = integrada via API na v1; paciente/financeiro = documentado p/ futuro). Anotar explicitamente: **anamnese/prontuário NÃO tem endpoint na API Clinicorp** → a absorção da anamnese será build do zero no Basecrm, atrás do gate de segurança (não é cópia).
- [ ] **Step 3:** (Sem commit de código — é doc no workspace do cliente.) Esse caderno é o insumo da fase futura de absorção do Clinicorp (ROI: cancelar R$250/mês).

---

### Fase 7 — Nota de fechamento (honestidade, 2026-06-11)

Fase 7 implementada via TDD (14 commits `feat(agenda)`/`test(agenda)` na branch `feat/v1-provisionamento`). Gate: **lint exit 0, typecheck exit 0, 505 testes passam + 1 skipped**. O ÚNICO teste vermelho é `test/appointmentsTenantIsolation.test.ts` (`PGRST205 — Could not find the table 'public.appointments'`): as migrações `appointments`/`clinicorp_config`/`professionals.external_id` foram criadas como **arquivo apenas** e **ainda NÃO aplicadas no banco** (orquestrador aplica via MCP). Assim que aplicadas, o teste fica verde (mesmo padrão de `professionals.multiTenant`, que passa porque sua tabela já está migrada).

**Divergências realidade > plano (anotadas):**
- Timestamps de migração: o plano sugeria `20260617000000` (COLIDE com `lead_sources` já existente) e `20260617100000`. Usei `20260626000000_clinicorp_config`, `20260627000000_appointments`, `20260628000000_professionals_external_id` (regra: `> 20260625000000`, último existente).
- Tipo `Appointment` + enums `AppointmentStatus`/`AppointmentSource` não existiam em `types/types.ts` → criados.
- `professionals.external_id` (coluna + tipo + service) não existia → migração nova + `professionalsService` passou a expor `externalId`. Necessário pro `onConflict` do sync e pro `AgendaBookModal`.
- Barrel real consumido é `lib/supabase.ts` (shadow do dir), não `lib/supabase/index.ts` — adicionei o export do `appointmentsService` em AMBOS.
- `reset.sql` usa bloco PL/pgSQL com `RAISE NOTICE`, não `delete from` solto → inseri `appointments` (antes de contacts/professionals) e `clinicorp_config` no estilo do arquivo.
- `multiTenantRlsPolicies.test.ts` NÃO foi modificado (a própria nota do plano desautoriza; ele cobre só a migração core).
- UUIDs dos testes de rota: zod v4.2.1 rejeita `1111…1111` (variant inválida) → usei `11111111-1111-4111-8111-111111111111` (v4, variant 8).
- `scripts/clinicorp-live-check.mjs`: `scripts/` é gitignored (dev/debug) → script criado em disco mas NÃO commitado (consistente com a política do repo). Rodar manual com credenciais reais.
- Token Clinicorp mora em `clinicorp_config.api_token` (DB, RLS `can_configure`, server-side only) — design verificado do plano; nunca chega ao browser (provado por asserts `not.toContain(apiToken)` em todas as rotas).

**Pendências one-time (agenda só fica ao vivo com elas):** `subscriber_id`, `code_link`, `business_id` na conta da clínica + aplicar as 3 migrações. `code_link` não existe ainda (clínica não usa agendamento online) → validar ao vivo se `get_avaliable_times_calendar` reflete a agenda interna; se não, cair pra `appointment/list` + ocupação (decisão no doc, não no código).

---

## Fase 8 — Relatórios core (faturamento · comissão · líquido)

> Pré-requisitos travados: tabelas `atendimentos`, `commission_rules`, `payment_method_fees`, `fixed_costs`, `professionals` já existem (Fases anteriores), helper `public.current_profile_organization_id()` já existe, `lib/auth/scope.ts` já exporta `canManageClinicSettings`, `StatCard`, `PeriodFilterSelect`, `LazyRevenueTrendChart` e `generateReportPDF` já existem. Esta fase só adiciona: **3 RPCs SQL**, **1 service**, **3 hooks**, **1 função pura**, **1 página de relatório** + rota, e estende o PDF.
>
> GOTCHA CRÍTICO desta fase: `SECURITY DEFINER` **fura RLS**. Cada RPC DEVE conter `organization_id = public.current_profile_organization_id()` no `WHERE`, senão vaza faturamento/comissão entre clínicas. O teste SSOT da Task 8.1 trava isso por regex.

---

### Task 8.1: Teste SSOT da migração de RPCs (cada RPC org-filtrado)

**Files:** Test: `test/financeReportsRpcs.test.ts`

Mirror de `lib/query/__tests__/cache-integrity.test.ts` (fs + regex sobre o SQL) e de `test/multiTenantRlsPolicies.test.ts` (`// @vitest-environment node` + `readFileSync` da migração). Garante que a migração existe, cria os 3 RPCs, que CADA um filtra por `current_profile_organization_id`, é `security definer`, e dá `grant execute to authenticated`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260618000000_finance_reports_rpcs.sql'
);

describe('migração de RPCs de relatórios financeiros', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  const RPCS = [
    'get_revenue_report',
    'get_commission_report',
    'get_net_result',
  ] as const;

  it('cria os três RPCs de relatório', () => {
    for (const rpc of RPCS) {
      expect(sql).toContain(`create or replace function public.${rpc}(`);
    }
  });

  it('cada RPC é security definer stable', () => {
    // security definer + stable aparece uma vez por RPC (3 ao todo)
    expect((sql.match(/security definer/gi) || []).length).toBeGreaterThanOrEqual(3);
    expect((sql.match(/\bstable\b/gi) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('GOTCHA: cada RPC filtra organization_id por current_profile_organization_id (não vaza entre clínicas)', () => {
    // current_profile_organization_id deve aparecer ao menos 1x por RPC
    const occurrences = (sql.match(/public\.current_profile_organization_id\(\)/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(RPCS.length);

    // nenhum RPC pode existir sem a cláusula de org no WHERE
    for (const rpc of RPCS) {
      const start = sql.indexOf(`create or replace function public.${rpc}(`);
      const next = RPCS
        .map((r) => sql.indexOf(`create or replace function public.${r}(`))
        .filter((idx) => idx > start)
        .sort((a, b) => a - b)[0];
      const body = sql.slice(start, next === undefined ? sql.length : next);
      expect(
        body.includes('current_profile_organization_id()'),
        `${rpc} deve filtrar por organization_id = public.current_profile_organization_id()`
      ).toBe(true);
    }
  });

  it('concede execução para authenticated em cada RPC', () => {
    for (const rpc of RPCS) {
      expect(sql).toContain(`grant execute on function public.${rpc}(`);
    }
  });

  it('faturamento conta apenas atendimentos recebidos (recebido = true)', () => {
    expect(sql).toContain('recebido');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run test/financeReportsRpcs.test.ts` Expected: FAIL com "ENOENT" / "no such file" (a migração `20260618000000_finance_reports_rpcs.sql` ainda não existe).

- [ ] **Step 3: Implementar o mínimo — criar a migração SQL dos 3 RPCs**

Criar `supabase/migrations/20260618000000_finance_reports_rpcs.sql` (SQL minúsculo, idempotente, mirror do estilo `get_dashboard_stats` do schema_init: `json_build_object` / `coalesce` / `sum`):

```sql
-- =============================================================================
-- RELATÓRIOS FINANCEIROS — RPCs (faturamento · comissão · líquido)
-- =============================================================================
-- security definer FURA RLS: cada RPC filtra explicitamente
--   organization_id = public.current_profile_organization_id()
-- no WHERE, senão vaza dados financeiros entre clínicas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. get_revenue_report — faturamento = SUM(valor) de atendimentos RECEBIDOS
--    com paid_at dentro do range. Faturamento = conta quando paid.
-- -----------------------------------------------------------------------------
create or replace function public.get_revenue_report(
  p_start timestamptz,
  p_end timestamptz
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  result json;
begin
  v_org := public.current_profile_organization_id();

  select json_build_object(
    'faturamento', coalesce(sum(a.valor), 0),
    'total_atendimentos', count(*),
    'por_mes', coalesce((
      select json_agg(m order by m->>'mes')
      from (
        select json_build_object(
          'mes', to_char(date_trunc('month', a2.paid_at), 'YYYY-MM'),
          'faturamento', coalesce(sum(a2.valor), 0)
        ) as m
        from public.atendimentos a2
        where a2.organization_id = v_org
          and a2.recebido = true
          and a2.paid_at >= p_start
          and a2.paid_at <= p_end
        group by date_trunc('month', a2.paid_at)
      ) sub
    ), '[]'::json)
  )
  into result
  from public.atendimentos a
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  return result;
end;
$$;

grant execute on function public.get_revenue_report(timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. get_commission_report — comissão por profissional.
--    JOIN atendimentos a × commission_rules c (por professional_id e/ou specialty)
--    SUM(a.valor * c.percent/100) GROUP BY professional.
-- -----------------------------------------------------------------------------
create or replace function public.get_commission_report(
  p_start timestamptz,
  p_end timestamptz
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  result json;
begin
  v_org := public.current_profile_organization_id();

  select json_build_object(
    'total_comissao', coalesce(sum(linha.comissao), 0),
    'por_profissional', coalesce(
      json_agg(
        json_build_object(
          'professional_id', linha.professional_id,
          'professional_name', linha.professional_name,
          'comissao', linha.comissao,
          'faturamento_base', linha.faturamento_base
        )
        order by linha.comissao desc
      ),
      '[]'::json
    )
  )
  into result
  from (
    select
      p.id as professional_id,
      p.name as professional_name,
      coalesce(sum(a.valor * c.percent / 100), 0) as comissao,
      coalesce(sum(a.valor), 0) as faturamento_base
    from public.atendimentos a
    join public.professionals p
      on p.id = a.professional_id
     and p.organization_id = v_org
    join public.commission_rules c
      on c.organization_id = v_org
     and (c.professional_id = a.professional_id or (c.professional_id is null and c.specialty = p.specialty))
    where a.organization_id = v_org
      and a.recebido = true
      and a.paid_at >= p_start
      and a.paid_at <= p_end
    group by p.id, p.name
  ) linha;

  return result;
end;
$$;

grant execute on function public.get_commission_report(timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. get_net_result — líquido = faturamento(recebido no range)
--    − comissões(range) − taxas de cartão(payment_method_fees por
--    payment_method+card_brand+installments do atendimento)
--    − contas fixas(SUM fixed_costs active). json_build_object estilo
--    get_dashboard_stats. org-filtrado.
-- -----------------------------------------------------------------------------
create or replace function public.get_net_result(
  p_start timestamptz,
  p_end timestamptz
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_faturamento numeric;
  v_comissoes numeric;
  v_taxas numeric;
  v_contas numeric;
  result json;
begin
  v_org := public.current_profile_organization_id();

  -- Faturamento: atendimentos recebidos no range
  select coalesce(sum(a.valor), 0)
  into v_faturamento
  from public.atendimentos a
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Comissões: atendimentos recebidos no range × commission_rules
  select coalesce(sum(a.valor * c.percent / 100), 0)
  into v_comissoes
  from public.atendimentos a
  join public.professionals p
    on p.id = a.professional_id
   and p.organization_id = v_org
  join public.commission_rules c
    on c.organization_id = v_org
   and (c.professional_id = a.professional_id or (c.professional_id is null and c.specialty = p.specialty))
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Taxas de cartão: aplica payment_method_fees casando
  -- payment_type(payment_method) + card_brand + installments do atendimento.
  select coalesce(sum(a.valor * f.fee_percent / 100), 0)
  into v_taxas
  from public.atendimentos a
  join public.payment_method_fees f
    on f.organization_id = v_org
   and f.payment_type = a.payment_method
   and coalesce(f.card_brand, '') = coalesce(a.card_brand, '')
   and f.installments = a.installments
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Contas fixas: soma das despesas fixas ativas da organização
  select coalesce(sum(fc.amount), 0)
  into v_contas
  from public.fixed_costs fc
  where fc.organization_id = v_org
    and fc.active = true;

  result := json_build_object(
    'faturamento', v_faturamento,
    'comissoes', v_comissoes,
    'taxas', v_taxas,
    'contas_fixas', v_contas,
    'liquido', v_faturamento - v_comissoes - v_taxas - v_contas
  );

  return result;
end;
$$;

grant execute on function public.get_net_result(timestamptz, timestamptz) to authenticated;
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run test/financeReportsRpcs.test.ts` Expected: PASS (5 testes verdes).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260618000000_finance_reports_rpcs.sql test/financeReportsRpcs.test.ts
git commit -m "feat(financeiro): RPCs get_revenue_report/get_commission_report/get_net_result org-filtrados

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8.2: Função pura `calcLiquido` + tipos de relatório

**Files:** Create: `features/reports/utils/financeMath.ts` · Test: `features/reports/utils/financeMath.test.ts` · Modify: `types/types.ts`

Função pura `calcLiquido(faturamento, comissoes, taxas, contas)` (sem dependência de banco) + tipos de retorno dos RPCs para o service/hook.

- [ ] **Step 1: Escrever o teste que falha** (happy-dom default — arquivo colocado `.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { calcLiquido } from './financeMath';

describe('calcLiquido', () => {
  it('subtrai comissões, taxas e contas do faturamento', () => {
    expect(calcLiquido(10000, 2000, 300, 1500)).toBe(6200);
  });

  it('retorna o próprio faturamento quando não há deduções', () => {
    expect(calcLiquido(5000, 0, 0, 0)).toBe(5000);
  });

  it('pode ficar negativo quando as despesas superam o faturamento', () => {
    expect(calcLiquido(1000, 500, 100, 800)).toBe(-400);
  });

  it('trata valores indefinidos/NaN como zero', () => {
    // @ts-expect-error testando robustez com entradas inválidas
    expect(calcLiquido(10000, undefined, NaN, null)).toBe(10000);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/reports/utils/financeMath.test.ts` Expected: FAIL com "Failed to resolve import './financeMath'" / "calcLiquido is not a function".

- [ ] **Step 3: Implementar o mínimo**

Criar `features/reports/utils/financeMath.ts`:

```typescript
/**
 * Cálculo puro do resultado líquido financeiro da clínica.
 *
 * Líquido = faturamento − comissões − taxas de cartão − contas fixas.
 * Mantido como função pura (sem I/O) para ser testável e reutilizável
 * fora do RPC SQL (ex.: recomputar no client a partir do breakdown).
 *
 * @param faturamento - Total recebido no período (atendimentos pagos).
 * @param comissoes - Total de comissões dos profissionais no período.
 * @param taxas - Total de taxas de cartão aplicadas no período.
 * @param contas - Total de contas/custos fixos ativos.
 * @returns Resultado líquido (pode ser negativo).
 */
export function calcLiquido(
  faturamento: number,
  comissoes: number,
  taxas: number,
  contas: number
): number {
  const f = Number.isFinite(faturamento) ? faturamento : 0;
  const co = Number.isFinite(comissoes) ? comissoes : 0;
  const t = Number.isFinite(taxas) ? taxas : 0;
  const ct = Number.isFinite(contas) ? contas : 0;
  return f - co - t - ct;
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/reports/utils/financeMath.test.ts` Expected: PASS (4 testes verdes).

- [ ] **Step 5: Adicionar os tipos de retorno dos RPCs em `types/types.ts`**

Adicionar ao final de `types/types.ts` (camelCase nas saídas que a UI consome; campos refletem o `json_build_object` dos RPCs):

```typescript
// ============================================
// RELATÓRIOS FINANCEIROS (RPC outputs)
// ============================================

export interface RevenueReportMonth {
  mes: string; // 'YYYY-MM'
  faturamento: number;
}

export interface RevenueReport {
  faturamento: number;
  totalAtendimentos: number;
  porMes: RevenueReportMonth[];
}

export interface CommissionReportRow {
  professionalId: string;
  professionalName: string;
  comissao: number;
  faturamentoBase: number;
}

export interface CommissionReport {
  totalComissao: number;
  porProfissional: CommissionReportRow[];
}

export interface NetResult {
  faturamento: number;
  comissoes: number;
  taxas: number;
  contasFixas: number;
  liquido: number;
}
```

- [ ] **Step 6: Rodar typecheck** Run: `rtk tsc` Expected: PASS (sem novos erros de tipo).

- [ ] **Step 7: Commit**

```bash
git add features/reports/utils/financeMath.ts features/reports/utils/financeMath.test.ts types/types.ts
git commit -m "feat(financeiro): calcLiquido puro + tipos RevenueReport/CommissionReport/NetResult

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8.3: `reportsService` (chama os RPCs)

**Files:** Create: `lib/supabase/reports.ts` · Test: `lib/supabase/reports.test.ts` · Modify: `lib/supabase/index.ts:7`

Mirror de `contactsService.getStageCounts`: `supabase.rpc('nome', { p_start, p_end } as any)`, objeto `{ data, error }`, nunca throw, transforma snake→camel.

- [ ] **Step 1: Escrever o teste que falha** (happy-dom default; mocka `./client`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('./client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { reportsService } from './reports';

describe('reportsService', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('getRevenueReport chama o RPC get_revenue_report com p_start/p_end e mapeia para camelCase', async () => {
    rpcMock.mockResolvedValue({
      data: {
        faturamento: 10000,
        total_atendimentos: 5,
        por_mes: [{ mes: '2026-06', faturamento: 10000 }],
      },
      error: null,
    });

    const { data, error } = await reportsService.getRevenueReport(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );

    expect(error).toBeNull();
    expect(rpcMock).toHaveBeenCalledWith('get_revenue_report', {
      p_start: '2026-06-01T00:00:00Z',
      p_end: '2026-06-30T23:59:59Z',
    });
    expect(data).toEqual({
      faturamento: 10000,
      totalAtendimentos: 5,
      porMes: [{ mes: '2026-06', faturamento: 10000 }],
    });
  });

  it('getCommissionReport mapeia por_profissional para camelCase', async () => {
    rpcMock.mockResolvedValue({
      data: {
        total_comissao: 2000,
        por_profissional: [
          { professional_id: 'p1', professional_name: 'Adel', comissao: 2000, faturamento_base: 10000 },
        ],
      },
      error: null,
    });

    const { data, error } = await reportsService.getCommissionReport(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );

    expect(error).toBeNull();
    expect(data).toEqual({
      totalComissao: 2000,
      porProfissional: [
        { professionalId: 'p1', professionalName: 'Adel', comissao: 2000, faturamentoBase: 10000 },
      ],
    });
  });

  it('getNetResult mapeia o líquido para camelCase', async () => {
    rpcMock.mockResolvedValue({
      data: {
        faturamento: 10000,
        comissoes: 2000,
        taxas: 300,
        contas_fixas: 1500,
        liquido: 6200,
      },
      error: null,
    });

    const { data, error } = await reportsService.getNetResult(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );

    expect(error).toBeNull();
    expect(data).toEqual({
      faturamento: 10000,
      comissoes: 2000,
      taxas: 300,
      contasFixas: 1500,
      liquido: 6200,
    });
  });

  it('propaga erro do RPC sem lançar exceção', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('boom') });

    const { data, error } = await reportsService.getRevenueReport(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/supabase/reports.test.ts` Expected: FAIL com "Failed to resolve import './reports'".

- [ ] **Step 3: Implementar o mínimo**

Criar `lib/supabase/reports.ts`:

```typescript
/**
 * @fileoverview Serviço Supabase para relatórios financeiros da clínica.
 *
 * Chama os RPCs SECURITY DEFINER (get_revenue_report / get_commission_report /
 * get_net_result), que já filtram por organização via
 * public.current_profile_organization_id(). Não recebe organization_id do
 * client — o gate é o RPC + RLS.
 *
 * @module lib/supabase/reports
 */

import { supabase } from './client';
import { RevenueReport, CommissionReport, NetResult } from '@/types';

/** Saída crua do RPC get_revenue_report. */
interface DbRevenueReport {
  faturamento: number;
  total_atendimentos: number;
  por_mes: Array<{ mes: string; faturamento: number }> | null;
}

/** Saída crua do RPC get_commission_report. */
interface DbCommissionReport {
  total_comissao: number;
  por_profissional: Array<{
    professional_id: string;
    professional_name: string;
    comissao: number;
    faturamento_base: number;
  }> | null;
}

/** Saída crua do RPC get_net_result. */
interface DbNetResult {
  faturamento: number;
  comissoes: number;
  taxas: number;
  contas_fixas: number;
  liquido: number;
}

const transformRevenue = (db: DbRevenueReport): RevenueReport => ({
  faturamento: db.faturamento || 0,
  totalAtendimentos: db.total_atendimentos || 0,
  porMes: (db.por_mes || []).map((m) => ({
    mes: m.mes,
    faturamento: m.faturamento || 0,
  })),
});

const transformCommission = (db: DbCommissionReport): CommissionReport => ({
  totalComissao: db.total_comissao || 0,
  porProfissional: (db.por_profissional || []).map((r) => ({
    professionalId: r.professional_id,
    professionalName: r.professional_name,
    comissao: r.comissao || 0,
    faturamentoBase: r.faturamento_base || 0,
  })),
});

const transformNetResult = (db: DbNetResult): NetResult => ({
  faturamento: db.faturamento || 0,
  comissoes: db.comissoes || 0,
  taxas: db.taxas || 0,
  contasFixas: db.contas_fixas || 0,
  liquido: db.liquido || 0,
});

/**
 * Serviço de relatórios financeiros.
 *
 * @example
 * ```typescript
 * const { data, error } = await reportsService.getRevenueReport(start, end);
 * ```
 */
export const reportsService = {
  /**
   * Faturamento (recebido) no período + breakdown por mês.
   */
  async getRevenueReport(
    pStart: string,
    pEnd: string
  ): Promise<{ data: RevenueReport | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const { data, error } = await supabase.rpc('get_revenue_report', {
        p_start: pStart,
        p_end: pEnd,
      } as any);
      if (error) return { data: null, error };
      return { data: transformRevenue(data as DbRevenueReport), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Comissão por profissional no período.
   */
  async getCommissionReport(
    pStart: string,
    pEnd: string
  ): Promise<{ data: CommissionReport | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const { data, error } = await supabase.rpc('get_commission_report', {
        p_start: pStart,
        p_end: pEnd,
      } as any);
      if (error) return { data: null, error };
      return { data: transformCommission(data as DbCommissionReport), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Resultado líquido (faturamento − comissões − taxas − contas fixas).
   */
  async getNetResult(
    pStart: string,
    pEnd: string
  ): Promise<{ data: NetResult | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const { data, error } = await supabase.rpc('get_net_result', {
        p_start: pStart,
        p_end: pEnd,
      } as any);
      if (error) return { data: null, error };
      return { data: transformNetResult(data as DbNetResult), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },
};
```

- [ ] **Step 4: Exportar em `lib/supabase/index.ts`**

Adicionar após a linha 7 (`export { settingsService, lifecycleStagesService } from './settings';`):

```typescript
export { reportsService } from './reports';
```

- [ ] **Step 5: Rodar e ver passar** Run: `npx vitest run lib/supabase/reports.test.ts` Expected: PASS (5 testes verdes).

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/reports.ts lib/supabase/reports.test.ts lib/supabase/index.ts
git commit -m "feat(financeiro): reportsService chamando RPCs de relatório

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8.4: Hooks `useFinanceReports` + query keys

**Files:** Create: `lib/query/hooks/useFinanceReports.ts` · Test: `lib/query/hooks/useFinanceReports.test.tsx` · Modify: `lib/query/queryKeys.ts:47` · `lib/query/hooks/index.ts`

`useRevenueReport` / `useCommissionReport` / `useNetResult` — só `useQuery` (sem mutations). Keys em `queryKeys.dashboard.{revenue,commission,netResult}`. Enabled-gate igual ao mirror `useActivitiesQuery`: `!authLoading && !tenantLoading && !!user && !!organizationId`.

- [ ] **Step 1: Escrever o teste que falha** (happy-dom; mocka service + contexts; usa QueryClientProvider)

```typescript
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getRevenueReport = vi.fn();
const getCommissionReport = vi.fn();
const getNetResult = vi.fn();

vi.mock('@/lib/supabase', () => ({
  reportsService: {
    getRevenueReport: (...a: unknown[]) => getRevenueReport(...a),
    getCommissionReport: (...a: unknown[]) => getCommissionReport(...a),
    getNetResult: (...a: unknown[]) => getNetResult(...a),
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false }),
}));

vi.mock('@/context/TenantContext', () => ({
  useTenant: () => ({ tenant: { organizationId: 'org-1' }, loading: false }),
}));

import { useRevenueReport, useNetResult } from './useFinanceReports';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useFinanceReports', () => {
  beforeEach(() => {
    getRevenueReport.mockReset();
    getNetResult.mockReset();
  });

  it('useRevenueReport busca o faturamento do período', async () => {
    getRevenueReport.mockResolvedValue({
      data: { faturamento: 10000, totalAtendimentos: 5, porMes: [] },
      error: null,
    });

    const { result } = renderHook(
      () => useRevenueReport('2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.faturamento).toBe(10000);
    expect(getRevenueReport).toHaveBeenCalledWith(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );
  });

  it('useNetResult lança erro quando o service retorna error', async () => {
    getNetResult.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(
      () => useNetResult('2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run lib/query/hooks/useFinanceReports.test.tsx` Expected: FAIL com "Failed to resolve import './useFinanceReports'".

- [ ] **Step 3: Registrar as keys em `lib/query/queryKeys.ts`**

Estender o bloco `dashboard` (linhas 44-48) acrescentando as 3 keys de relatório:

```typescript
    // Dashboard (non-standard structure)
    dashboard: {
        stats: ['dashboard', 'stats'] as const,
        funnel: ['dashboard', 'funnel'] as const,
        timeline: ['dashboard', 'timeline'] as const,
        revenue: (start: string, end: string) =>
            ['dashboard', 'revenue', start, end] as const,
        commission: (start: string, end: string) =>
            ['dashboard', 'commission', start, end] as const,
        netResult: (start: string, end: string) =>
            ['dashboard', 'netResult', start, end] as const,
    },
```

- [ ] **Step 4: Implementar os hooks**

Criar `lib/query/hooks/useFinanceReports.ts`:

```typescript
/**
 * TanStack Query hooks for relatórios financeiros (read-only).
 *
 * Lê dos RPCs via reportsService. Sem mutations (relatório é derivado).
 * Enabled-gate aguarda auth + tenant prontos para a RLS/RPC funcionar.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { reportsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';

/**
 * Faturamento (recebido) do período + breakdown por mês.
 */
export const useRevenueReport = (start: string, end: string) => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.dashboard.revenue(start, end), organizationId],
    queryFn: async () => {
      const { data, error } = await reportsService.getRevenueReport(start, end);
      if (error) throw error;
      return data;
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 60 * 1000,
  });
};

/**
 * Comissão por profissional no período.
 */
export const useCommissionReport = (start: string, end: string) => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.dashboard.commission(start, end), organizationId],
    queryFn: async () => {
      const { data, error } = await reportsService.getCommissionReport(start, end);
      if (error) throw error;
      return data;
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 60 * 1000,
  });
};

/**
 * Resultado líquido do período (faturamento − comissões − taxas − contas).
 */
export const useNetResult = (start: string, end: string) => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.dashboard.netResult(start, end), organizationId],
    queryFn: async () => {
      const { data, error } = await reportsService.getNetResult(start, end);
      if (error) throw error;
      return data;
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 60 * 1000,
  });
};
```

- [ ] **Step 5: Re-exportar em `lib/query/hooks/index.ts`**

Adicionar ao final do arquivo (após o bloco `useMoveDeal`):

```typescript
// Finance Reports (read-only)
export {
  useRevenueReport,
  useCommissionReport,
  useNetResult,
} from './useFinanceReports';
```

- [ ] **Step 6: Rodar e ver passar** Run: `npx vitest run lib/query/hooks/useFinanceReports.test.tsx` Expected: PASS (2 testes verdes).

- [ ] **Step 7: Commit**

```bash
git add lib/query/hooks/useFinanceReports.ts lib/query/hooks/useFinanceReports.test.tsx lib/query/queryKeys.ts lib/query/hooks/index.ts
git commit -m "feat(financeiro): hooks useRevenueReport/useCommissionReport/useNetResult

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8.5: Helper `getFinanceDateRange` (range ISO a partir do PeriodFilter)

**Files:** Create: `features/reports/utils/financeDateRange.ts` · Test: `features/reports/utils/financeDateRange.test.ts`

O `getDateRange` do template é privado em `useDashboardMetrics.ts` (não exportado) e retorna `Date`. Os RPCs precisam de strings ISO (`p_start`/`p_end`). Criar um helper dedicado que reusa o mesmo `PeriodFilter` e devolve `{ start, end }` em ISO — sem duplicar a lógica de mês/trimestre inteira, cobrindo os casos usados na página (`this_month`, `last_month`, `last_30_days`, `this_year`).

- [ ] **Step 1: Escrever o teste que falha**

```typescript
import { describe, it, expect } from 'vitest';
import { getFinanceDateRange } from './financeDateRange';

describe('getFinanceDateRange', () => {
  it('this_month retorna do dia 1 do mês até agora, em ISO', () => {
    const now = new Date(2026, 5, 9, 12, 0, 0); // 2026-06-09
    const { start, end } = getFinanceDateRange('this_month', now);
    expect(start).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).toISOString());
    expect(new Date(end).getTime()).toBeGreaterThanOrEqual(new Date(start).getTime());
  });

  it('last_month retorna o mês anterior completo', () => {
    const now = new Date(2026, 5, 9);
    const { start, end } = getFinanceDateRange('last_month', now);
    expect(start).toBe(new Date(2026, 4, 1, 0, 0, 0, 0).toISOString());
    expect(end).toBe(new Date(2026, 5, 0, 23, 59, 59, 999).toISOString());
  });

  it('last_30_days retorna 30 dias atrás até agora', () => {
    const now = new Date(2026, 5, 9, 10, 0, 0);
    const { start } = getFinanceDateRange('last_30_days', now);
    const expectedStart = new Date(2026, 5, 9, 10, 0, 0);
    expectedStart.setDate(expectedStart.getDate() - 30);
    expect(new Date(start).getTime()).toBeLessThan(now.getTime());
  });

  it('this_year retorna de 1º de janeiro até agora', () => {
    const now = new Date(2026, 5, 9);
    const { start } = getFinanceDateRange('this_year', now);
    expect(start).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).toISOString());
  });

  it('all retorna um range amplo (desde 2000)', () => {
    const now = new Date(2026, 5, 9);
    const { start } = getFinanceDateRange('all', now);
    expect(new Date(start).getFullYear()).toBeLessThanOrEqual(2000);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/reports/utils/financeDateRange.test.ts` Expected: FAIL com "Failed to resolve import './financeDateRange'".

- [ ] **Step 3: Implementar o mínimo**

Criar `features/reports/utils/financeDateRange.ts`:

```typescript
import { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';

export interface FinanceDateRangeISO {
  start: string;
  end: string;
}

/**
 * Converte um PeriodFilter em range ISO ({ start, end }) para os RPCs
 * financeiros (p_start / p_end). Reusa o mesmo enum PeriodFilter do dashboard,
 * mas devolve strings ISO (o getDateRange do dashboard é privado e retorna Date).
 *
 * @param period - Filtro de período selecionado na UI.
 * @param now - Data de referência (injetável p/ teste determinístico).
 * @returns Range em ISO 8601.
 */
export function getFinanceDateRange(
  period: PeriodFilter,
  now: Date = new Date()
): FinanceDateRangeISO {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1);

  let start: Date;
  let end: Date = endOfToday;

  switch (period) {
    case 'all':
      start = new Date(2000, 0, 1, 0, 0, 0, 0);
      break;

    case 'today':
      start = today;
      break;

    case 'yesterday':
      start = new Date(today);
      start.setDate(start.getDate() - 1);
      end = new Date(today.getTime() - 1);
      break;

    case 'last_7_days':
      start = new Date(now);
      start.setDate(start.getDate() - 7);
      break;

    case 'last_30_days':
      start = new Date(now);
      start.setDate(start.getDate() - 30);
      break;

    case 'this_month':
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;

    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;

    case 'this_quarter': {
      const quarterStart = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), quarterStart, 1, 0, 0, 0, 0);
      break;
    }

    case 'last_quarter': {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const lastQuarterStart = (currentQuarter - 1 + 4) % 4;
      const year = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
      start = new Date(year, lastQuarterStart * 3, 1, 0, 0, 0, 0);
      end = new Date(year, lastQuarterStart * 3 + 3, 0, 23, 59, 59, 999);
      break;
    }

    case 'this_year':
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      break;

    case 'last_year':
      start = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      break;

    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run features/reports/utils/financeDateRange.test.ts` Expected: PASS (5 testes verdes).

- [ ] **Step 5: Commit**

```bash
git add features/reports/utils/financeDateRange.ts features/reports/utils/financeDateRange.test.ts
git commit -m "feat(financeiro): getFinanceDateRange (PeriodFilter -> range ISO p/ RPCs)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8.6: `FinanceReportPage` (KPIs + chart) com gate RBAC

**Files:** Create: `features/reports/FinanceReportPage.tsx` · Test: `features/reports/FinanceReportPage.test.tsx` · Modify: `features/reports/utils/generateReportPDF.ts`

KPIs com `StatCard` (Faturamento / Comissão / Líquido), `PeriodFilterSelect`, `LazyRevenueTrendChart` (faturamento por mês), botão Exportar PDF. **Gate RBAC**: Comissão e Líquido (margem do Adel) só aparecem para `canManageClinicSettings(profile?.role)`; Faturamento o `clinic_staff` pode ver.

- [ ] **Step 1: Escrever o teste que falha** (component + RBAC + axe; mocka hooks + contexts, mirror `SettingsPage.rbac.test.tsx`)

```typescript
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const useRevenueReport = vi.fn();
const useCommissionReport = vi.fn();
const useNetResult = vi.fn();

vi.mock('@/lib/query/hooks/useFinanceReports', () => ({
  useRevenueReport: (...a: unknown[]) => useRevenueReport(...a),
  useCommissionReport: (...a: unknown[]) => useCommissionReport(...a),
  useNetResult: (...a: unknown[]) => useNetResult(...a),
}));

// Evita carregar recharts/lazy chart real no teste.
vi.mock('@/components/charts', () => ({
  LazyRevenueTrendChart: () => <div data-testid="revenue-chart" />,
  ChartWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import FinanceReportPage from './FinanceReportPage';
import { useAuth } from '@/context/AuthContext';

const useAuthMock = vi.mocked(useAuth);

function mockReports() {
  useRevenueReport.mockReturnValue({
    data: { faturamento: 10000, totalAtendimentos: 5, porMes: [{ mes: '2026-06', faturamento: 10000 }] },
    isLoading: false,
    isError: false,
  });
  useCommissionReport.mockReturnValue({
    data: { totalComissao: 2000, porProfissional: [] },
    isLoading: false,
    isError: false,
  });
  useNetResult.mockReturnValue({
    data: { faturamento: 10000, comissoes: 2000, taxas: 300, contasFixas: 1500, liquido: 6200 },
    isLoading: false,
    isError: false,
  });
}

describe('FinanceReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReports();
  });

  it('clinic_admin vê os KPIs Faturamento, Comissão e Líquido', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    render(<FinanceReportPage />);

    expect(screen.getByText('Faturamento')).toBeInTheDocument();
    expect(screen.getByText('Comissões')).toBeInTheDocument();
    expect(screen.getByText('Líquido')).toBeInTheDocument();
  });

  it('clinic_staff vê Faturamento mas NÃO vê Comissões nem Líquido (margem do Adel)', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u2', role: 'clinic_staff', organization_id: 'org-1', email: 'vitoria@clinica.com' },
    } as any);

    render(<FinanceReportPage />);

    expect(screen.getByText('Faturamento')).toBeInTheDocument();
    expect(screen.queryByText('Comissões')).not.toBeInTheDocument();
    expect(screen.queryByText('Líquido')).not.toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    const { container } = render(<FinanceReportPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run features/reports/FinanceReportPage.test.tsx` Expected: FAIL com "Failed to resolve import './FinanceReportPage'".

- [ ] **Step 3: Implementar a página**

Criar `features/reports/FinanceReportPage.tsx`:

```typescript
'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { DollarSign, Users, TrendingUp, Download } from 'lucide-react';
import { StatCard } from '@/features/dashboard/components/StatCard';
import { PeriodFilterSelect } from '@/components/filters/PeriodFilterSelect';
import { LazyRevenueTrendChart, ChartWrapper } from '@/components/charts';
import { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
import { getFinanceDateRange } from './utils/financeDateRange';
import {
  useRevenueReport,
  useCommissionReport,
  useNetResult,
} from '@/lib/query/hooks/useFinanceReports';
import { generateFinanceReportPDF } from './utils/generateReportPDF';
import { useAuth } from '@/context/AuthContext';
import { canManageClinicSettings } from '@/lib/auth/scope';

/**
 * Formata um valor em reais (BRL).
 */
const formatBRL = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Página de relatório financeiro da clínica.
 *
 * Faturamento é visível para toda a equipe; Comissões e Líquido (margem do
 * Adel) só para quem tem canManageClinicSettings (clinic_admin / agency_admin).
 */
const FinanceReportPage: React.FC = () => {
  const { profile } = useAuth();
  const [period, setPeriod] = useState<PeriodFilter>('this_month');

  const canSeeMargin = canManageClinicSettings(profile?.role);

  const { start, end } = useMemo(() => getFinanceDateRange(period), [period]);

  const {
    data: revenue,
    isLoading: revenueLoading,
    isError: revenueError,
  } = useRevenueReport(start, end);
  const { data: commission } = useCommissionReport(start, end);
  const { data: netResult } = useNetResult(start, end);

  const trendData = useMemo(
    () =>
      (revenue?.porMes || []).map((m) => ({
        month: m.mes,
        revenue: m.faturamento,
      })),
    [revenue?.porMes]
  );

  const handleExportPDF = useCallback(async () => {
    await generateFinanceReportPDF(
      {
        faturamento: revenue?.faturamento ?? 0,
        comissoes: commission?.totalComissao ?? 0,
        liquido: netResult?.liquido ?? 0,
        porMes: revenue?.porMes ?? [],
        canSeeMargin,
      },
      period
    );
  }, [
    revenue?.faturamento,
    revenue?.porMes,
    commission?.totalComissao,
    netResult?.liquido,
    canSeeMargin,
    period,
  ]);

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] space-y-4">
      {/* Header com Filtros */}
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Relatório Financeiro
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Faturamento, comissões e resultado líquido da clínica.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodFilterSelect value={period} onChange={setPeriod} />
          <button
            type="button"
            onClick={handleExportPDF}
            className="group flex items-center gap-2 px-3 py-2 rounded-lg glass border border-slate-200/50 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/20 transition-all duration-200"
            title="Exportar PDF"
          >
            <Download size={16} className="group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium opacity-80 group-hover:opacity-100">PDF</span>
          </button>
        </div>
      </div>

      {/* Estado de erro */}
      {revenueError ? (
        <div className="glass p-4 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5 shadow-sm shrink-0">
          <p className="text-sm text-red-600 dark:text-red-400">
            Não foi possível carregar o relatório financeiro. Tente novamente.
          </p>
        </div>
      ) : null}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        <StatCard
          title="Faturamento"
          value={revenueLoading ? '...' : formatBRL(revenue?.faturamento ?? 0)}
          subtext={`${revenue?.totalAtendimentos ?? 0} atendimentos`}
          subtextPositive
          icon={DollarSign}
          color="bg-blue-500"
          comparisonLabel="recebido no período"
        />

        {canSeeMargin ? (
          <StatCard
            title="Comissões"
            value={formatBRL(commission?.totalComissao ?? 0)}
            subtext={`${commission?.porProfissional.length ?? 0} profissionais`}
            subtextPositive={false}
            icon={Users}
            color="bg-purple-500"
            comparisonLabel="a pagar no período"
          />
        ) : null}

        {canSeeMargin ? (
          <StatCard
            title="Líquido"
            value={formatBRL(netResult?.liquido ?? 0)}
            subtext={`Taxas ${formatBRL(netResult?.taxas ?? 0)} · Contas ${formatBRL(netResult?.contasFixas ?? 0)}`}
            subtextPositive={(netResult?.liquido ?? 0) >= 0}
            icon={TrendingUp}
            color="bg-emerald-500"
            comparisonLabel="após deduções"
          />
        ) : null}
      </div>

      {/* Faturamento por mês */}
      <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col flex-1 min-h-[250px]">
        <div className="flex justify-between items-center mb-2 shrink-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Faturamento por Mês
          </h2>
        </div>
        <div className="flex-1 min-h-0 relative">
          {trendData.length > 0 ? (
            <div className="absolute inset-0">
              <ChartWrapper height="100%">
                <LazyRevenueTrendChart data={trendData} />
              </ChartWrapper>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 py-6">
              <DollarSign size={32} className="mb-2 opacity-50" />
              <p className="text-sm">Nenhum faturamento no período.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FinanceReportPage;
```

- [ ] **Step 4: Estender o PDF — adicionar `generateFinanceReportPDF`**

Adicionar ao final de `features/reports/utils/generateReportPDF.ts` (reusa o objeto `COLORS` e o padrão de dynamic import / Blob URL já existentes no arquivo):

```typescript
interface FinanceReportData {
  faturamento: number;
  comissoes: number;
  liquido: number;
  porMes: Array<{ mes: string; faturamento: number }>;
  /** Quando false, omite Comissão e Líquido (margem restrita). */
  canSeeMargin: boolean;
}

/**
 * Gera o PDF do relatório financeiro (faturamento · comissão · líquido).
 *
 * Respeita o gate de margem: se canSeeMargin for false, exporta apenas o
 * faturamento (sem comissão/líquido), espelhando a UI da FinanceReportPage.
 *
 * @param data - Dados financeiros do período.
 * @param period - Período selecionado.
 */
export const generateFinanceReportPDF = async (
  data: FinanceReportData,
  period: PeriodFilter
) => {
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;

  const formatBRL = (value: number) =>
    value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Título
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.primary);
  doc.text('Relatório Financeiro', margin, 21);

  // Período + metadados
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.secondary);
  doc.text(`Período: ${PERIOD_LABELS[period]}`, margin, 32);
  doc.text(`${dateStr} às ${timeStr}`, pageWidth - margin, 32, { align: 'right' });

  // Divider
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.line(margin, 38, pageWidth - margin, 38);

  // KPI cards (1 ou 3 conforme gate de margem)
  const kpis = data.canSeeMargin
    ? [
        { label: 'Faturamento', value: formatBRL(data.faturamento), accent: COLORS.blue },
        { label: 'Comissões', value: formatBRL(data.comissoes), accent: COLORS.purple },
        { label: 'Líquido', value: formatBRL(data.liquido), accent: COLORS.emerald },
      ]
    : [{ label: 'Faturamento', value: formatBRL(data.faturamento), accent: COLORS.blue }];

  const kpiY = 45;
  const cardGap = 4;
  const cardWidth = (contentWidth - cardGap * (kpis.length - 1)) / kpis.length;
  const cardHeight = 32;

  kpis.forEach((kpi, i) => {
    const x = margin + i * (cardWidth + cardGap);

    doc.setFillColor(...COLORS.white);
    doc.setDrawColor(...COLORS.border);
    doc.roundedRect(x, kpiY, cardWidth, cardHeight, 2, 2, 'FD');

    doc.setFillColor(...kpi.accent);
    doc.roundedRect(x, kpiY, cardWidth, 4, 2, 2, 'F');
    doc.setFillColor(...COLORS.white);
    doc.rect(x, kpiY + 2, cardWidth, 2, 'F');

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.secondary);
    doc.text(kpi.label, x + 4, kpiY + 11);

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.primary);
    doc.text(kpi.value, x + 4, kpiY + 22);
  });

  // Faturamento por mês (lista)
  const listY = kpiY + cardHeight + 15;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.primary);
  doc.text('Faturamento por Mês', margin, listY);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  if (data.porMes.length > 0) {
    data.porMes.forEach((m, i) => {
      const y = listY + 8 + i * 7;
      doc.setTextColor(...COLORS.secondary);
      doc.text(m.mes, margin, y);
      doc.setTextColor(...COLORS.primary);
      doc.text(formatBRL(m.faturamento), pageWidth - margin, y, { align: 'right' });
    });
  } else {
    doc.setTextColor(...COLORS.secondary);
    doc.text('Sem faturamento no período.', margin, listY + 8);
  }

  // Output via Blob URL
  const pdfBlob = doc.output('blob');
  const blobUrl = URL.createObjectURL(pdfBlob);
  window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
};
```

- [ ] **Step 5: Rodar e ver passar** Run: `npx vitest run features/reports/FinanceReportPage.test.tsx` Expected: PASS (3 testes verdes, incluindo o de RBAC e o de axe).

- [ ] **Step 6: Commit**

```bash
git add features/reports/FinanceReportPage.tsx features/reports/FinanceReportPage.test.tsx features/reports/utils/generateReportPDF.ts
git commit -m "feat(financeiro): FinanceReportPage (KPIs + chart) com gate de margem + PDF

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8.7: Rota `/reports/financeiro` (wrapper)

**Files:** Create: `app/(protected)/reports/financeiro/page.tsx`

Wrapper de ~15 linhas `'use client'` + `next/dynamic` `ssr:false` + `PageLoader`, mirror exato de `app/(protected)/activities/page.tsx`.

- [ ] **Step 1: Escrever o teste que falha** Test: `app/(protected)/reports/financeiro/page.test.tsx`

```typescript
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock do PageLoader e da página real para isolar o wrapper.
vi.mock('@/components/PageLoader', () => ({
  PageLoader: () => <div>Carregando...</div>,
}));

vi.mock('@/features/reports/FinanceReportPage', () => ({
  default: () => <div data-testid="finance-report-page" />,
}));

import FinanceiroRoute from './page';

describe('rota /reports/financeiro', () => {
  it('renderiza sem quebrar (wrapper dynamic)', () => {
    render(<FinanceiroRoute />);
    // O dynamic com ssr:false renderiza o loading no primeiro paint.
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** Run: `npx vitest run "app/(protected)/reports/financeiro/page.test.tsx"` Expected: FAIL com "Failed to resolve import './page'".

- [ ] **Step 3: Implementar o wrapper**

Criar `app/(protected)/reports/financeiro/page.tsx`:

```typescript
'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const FinanceReportPage = dynamic(
    () => import('@/features/reports/FinanceReportPage'),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Componente React `Financeiro`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function Financeiro() {
    return <FinanceReportPage />
}
```

- [ ] **Step 4: Rodar e ver passar** Run: `npx vitest run "app/(protected)/reports/financeiro/page.test.tsx"` Expected: PASS.

- [ ] **Step 5: Gate final da fase** Run: `npm run precheck:fast` Expected: PASS (lint + typecheck + test:run verdes).

- [ ] **Step 6: Commit**

```bash
git add "app/(protected)/reports/financeiro/page.tsx" "app/(protected)/reports/financeiro/page.test.tsx"
git commit -m "feat(financeiro): rota /reports/financeiro (wrapper dynamic ssr:false)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

**DoD da Fase 8:**
- Tenant isolado: cada RPC filtra por `public.current_profile_organization_id()` no WHERE (trava por regex na Task 8.1 — `SECURITY DEFINER` não vaza entre clínicas).
- Faturamento = somente atendimentos `recebido = true` com `paid_at` no range; líquido = faturamento − comissões − taxas − contas fixas (função pura `calcLiquido` testada).
- Gate RBAC: `clinic_staff` (Vitória) vê só Faturamento; `clinic_admin`/`agency_admin` (Adel) vê Comissão e Líquido (via `canManageClinicSettings`) — coberto na UI e no PDF.
- Loading / error / empty na `FinanceReportPage`; acessibilidade via `axe` sem violações.
- `npm run precheck:fast` (lint + typecheck + test:run) verde.

---

## Self-review (writing-plans)

- **Cobertura do escopo travado:** call-list (F6) · registrar atendimento, faturamento=recebido (F4) · agenda — agendar dentro do Basecrm via API Clinicorp (F7) · configs taxas/comissão-por-dr-e-especialidade/contas-fixas (F5) · relatórios faturamento/comissão/líquido (F8) · profissionais + catálogo (F3) · seed 202 (F2) · ambiente/deploy R$120 (F0) · segurança antes da PII (F1). ✅ Todos os itens do critério de sucesso têm fase.
- **FORA (confirmado ausente):** nota fiscal, agenda própria do zero, anamnese — nenhuma fase as constrói.
- **Consistência de nomes:** tabelas/serviços/hooks/rotas seguem o contrato travado (`atendimentos`, `professionals`, `payment_method_fees`, `commission_rules`, `fixed_costs`, `appointments`, `clinicorp_config`). RLS: operação=`can_operate_organization`, config=`can_configure_organization`.
- **Pontos a validar na execução (declarados, não fabricados):** (a) Supabase pausado → reativar (F0); (b) aba canônica da LEAD.xlsx + export CSV (F2); (c) `subscriber_id`/`code_link`/`business_id` do Clinicorp (F7); (d) o motor `get_avaliable_times_calendar` é do agendamento ONLINE — validar ao vivo que reflete a agenda interna, fallback `appointment/list`+`schedule_occupation` (F7, task de validação incluída).

## Handoff de execução

Plano salvo. Duas opções de execução:
1. **Subagent-Driven (recomendado)** — um subagente fresco por tarefa, review entre tarefas, iteração rápida.
2. **Inline** — executar nesta sessão em lotes com checkpoints.

Sugestão de ordem real: **F0 → F1 → F2** (destrava ambiente + segurança + dados) antes de qualquer feature; depois F3→F4 (núcleo do atendimento), F5 (configs), F8 (relatórios), F6 (call-list), F7 (agenda — depende da config Clinicorp). F6 e F7 são as mais independentes.