-- =============================================================================
-- lead_sources — origens de lead editáveis (N1, adendo 2026-06-10)
-- =============================================================================
-- O Adel pediu na prática: origens (Anúncio Meta, Instagram, Indicação,
-- Google/GMN) viram cadastro editável por tenant e alimentam o select de
-- origem no form de contato/lead.
--
-- Tabela OPERACIONAL (espelha atendimentos):
--   SELECT  = can_access_organization  (todo o tenant lê pra preencher o form)
--   mutação = can_operate_organization (recepção/staff cadastra/edita origem)
--
-- SEM seed aqui — as origens padrão são inseridas via MCP no tenant piloto
-- durante o provisionamento (decisão do orquestrador, 2026-06-10).
-- =============================================================================

create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lead_sources enable row level security;

create index if not exists idx_lead_sources_org on public.lead_sources(organization_id, created_at desc);
create index if not exists idx_lead_sources_owner on public.lead_sources(owner_id);

drop policy if exists "lead_sources_select_by_tenant" on public.lead_sources;
create policy "lead_sources_select_by_tenant"
  on public.lead_sources
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

drop policy if exists "lead_sources_mutate_by_tenant_operator" on public.lead_sources;
create policy "lead_sources_mutate_by_tenant_operator"
  on public.lead_sources
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

drop trigger if exists update_lead_sources_updated_at on public.lead_sources;
create trigger update_lead_sources_updated_at
  before update on public.lead_sources
  for each row
  execute function public.update_updated_at_column();
