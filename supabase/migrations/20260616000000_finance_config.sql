-- =============================================================================
-- Configs financeiras: taxas de cartão, regras de comissão, contas fixas e
-- pagamentos de comissão (adendo 2026-06-10 — alimenta o "Paga/A pagar").
-- =============================================================================
-- RLS: SELECT + mutação SOMENTE can_configure_organization (clinic_admin/Adel).
-- clinic_staff (Vitória) NÃO lê nem escreve NENHUMA destas tabelas — margem,
-- taxas e comissões são dado sensível do dono da clínica.
--
-- Invariantes de domínio garantidas NO BANCO (lição F4 — defense-in-depth):
--   percentuais 0..100 · valores ≥ 0 · parcelas ≥ 1 · dia de vencimento 1..31
--   · payment_type do domínio · período de competência YYYY-MM.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- payment_method_fees — taxa percentual por meio de pagamento
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
  updated_at timestamptz not null default now(),
  constraint payment_method_fees_payment_type_chk
    check (payment_type in ('credito', 'debito', 'pix', 'dinheiro')),
  constraint payment_method_fees_installments_chk
    check (installments >= 1),
  constraint payment_method_fees_fee_percent_chk
    check (fee_percent >= 0 and fee_percent <= 100)
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
  for each row
  execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- commission_rules — percentual de comissão por dentista × especialidade
-- ---------------------------------------------------------------------------
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  professional_id uuid references public.professionals(id),
  specialty text,
  percent numeric not null default 0,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_rules_percent_chk
    check (percent >= 0 and percent <= 100)
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
  for each row
  execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- fixed_costs — contas fixas mensais (subtraídas do resultado líquido)
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
  updated_at timestamptz not null default now(),
  constraint fixed_costs_amount_chk check (amount >= 0),
  constraint fixed_costs_due_day_chk
    check (due_day is null or (due_day >= 1 and due_day <= 31))
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
  for each row
  execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- commission_payments — pagamentos de comissão por profissional × período
-- (adendo 2026-06-10: ação "pagar" da tela Profissionais — "Paga/A pagar")
-- ---------------------------------------------------------------------------
-- paid_at SEM default now()-stamping forçado em trigger DE PROPÓSITO: o
-- backfill histórico pode registrar pagamentos no passado (mesma razão do
-- 20260615000000_atendimentos_invariantes.sql).
create table if not exists public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  professional_id uuid not null references public.professionals(id),
  amount numeric not null default 0,
  paid_at timestamptz not null default now(),
  period text not null,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_payments_amount_chk check (amount >= 0),
  constraint commission_payments_period_chk
    check (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

alter table public.commission_payments enable row level security;

create index if not exists idx_commission_payments_org on public.commission_payments(organization_id, created_at desc);
create index if not exists idx_commission_payments_professional on public.commission_payments(professional_id);
create index if not exists idx_commission_payments_period on public.commission_payments(organization_id, period);
create index if not exists idx_commission_payments_owner on public.commission_payments(owner_id);

drop policy if exists "commission_payments_select_by_tenant_admin" on public.commission_payments;
create policy "commission_payments_select_by_tenant_admin"
  on public.commission_payments
  for select
  to authenticated
  using (public.can_configure_organization(organization_id));

drop policy if exists "commission_payments_mutate_by_tenant_admin" on public.commission_payments;
create policy "commission_payments_mutate_by_tenant_admin"
  on public.commission_payments
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

drop trigger if exists update_commission_payments_updated_at on public.commission_payments;
create trigger update_commission_payments_updated_at
  before update on public.commission_payments
  for each row
  execute function public.update_updated_at_column();
