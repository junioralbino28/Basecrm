-- =============================================================================
-- appointments — cache local de resiliência da agenda
-- =============================================================================
-- A VERDADE é o Clinicorp (book/list ao vivo via /api/agenda/*); isto é fallback/leitura
-- rápida. external_id = id do Clinicorp; source='clinicorp_api'.
-- UNIQUE(org,source,external_id) p/ dedupe do sync. SEM PII crua (só nome+telefone em notes).
-- RLS: SELECT can_access (recepção lê), mutate can_operate (sync server-side via service-role).
-- =============================================================================

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
