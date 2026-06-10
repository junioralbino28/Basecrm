-- =============================================================================
-- atendimentos — registro clínico-financeiro de procedimentos realizados
-- =============================================================================
-- O coração do motor da Vitória: faturamento conta SÓ quando recebido = true
-- (o service carimba paid_at = now() nesse momento).
-- Tabela OPERACIONAL: clinic_staff (Vitória) registra — mutação = can_operate.
-- SELECT = can_access (todo o tenant lê).
-- `desconto` vem da planilha real do Adel (total = valor − desconto).
-- =============================================================================

create table if not exists public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id),
  deal_id uuid references public.deals(id),
  professional_id uuid references public.professionals(id),
  product_id uuid references public.products(id),
  procedimento text not null,
  valor numeric not null default 0,
  desconto numeric not null default 0,
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
  for each row
  execute function public.update_updated_at_column();
