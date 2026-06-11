-- =============================================================================
-- clinicorp_config — config por tenant da integração Clinicorp
-- =============================================================================
-- O token (api_token) NUNCA é exposto ao client: usado SÓ server-side pelo adapter.
-- RLS: SELECT + mutate AMBOS can_configure_organization (só clinic_admin/agency_admin;
-- clinic_staff NÃO lê — o token não pode vazar pra recepção).
-- subscriber_id/code_link/business_id NÃO são secretos (config externa da clínica).
-- =============================================================================

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
