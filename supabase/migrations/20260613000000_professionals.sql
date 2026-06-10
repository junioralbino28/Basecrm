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
