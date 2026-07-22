-- =============================================================================
-- C2A — catálogo e histórico auditável de origens de lead
-- =============================================================================
-- contacts.source permanece como ponte textual e não gera backfill de eventos.

create table public.lead_source_migration_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  normalized_name text not null,
  source_ids uuid[] not null,
  source_names text[] not null,
  status text not null default 'pending',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  constraint lead_source_migration_reviews_name_unique
    unique (organization_id, normalized_name),
  constraint lead_source_migration_reviews_status_known
    check (status in ('pending', 'resolved')),
  constraint lead_source_migration_reviews_resolution_consistent check (
    (status = 'pending' and resolved_at is null and resolved_by is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);

alter table public.lead_sources
  add column normalized_name text,
  add column code text,
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id) on delete set null;

create unique index uq_lead_sources_org_id
  on public.lead_sources(organization_id, id);
create unique index lead_sources_normalized_name_unique
  on public.lead_sources(organization_id, normalized_name);
create unique index lead_sources_code_unique
  on public.lead_sources(organization_id, code)
  where code is not null;

with grouped as (
  select
    organization_id,
    public.normalize_catalog_name(name) as normalized_name,
    count(*) as source_count,
    array_agg(id order by id) as source_ids,
    array_agg(name order by id) as source_names
  from public.lead_sources
  group by organization_id, public.normalize_catalog_name(name)
)
update public.lead_sources s
set normalized_name = g.normalized_name
from grouped g
where g.source_count = 1
  and s.organization_id = g.organization_id
  and s.id = g.source_ids[1];

insert into public.lead_source_migration_reviews (
  organization_id, normalized_name, source_ids, source_names
)
select organization_id, normalized_name, source_ids, source_names
from (
  select
    organization_id,
    public.normalize_catalog_name(name) as normalized_name,
    count(*) as source_count,
    array_agg(id order by id) as source_ids,
    array_agg(name order by id) as source_names
  from public.lead_sources
  group by organization_id, public.normalize_catalog_name(name)
) collisions
where source_count > 1
on conflict (organization_id, normalized_name) do nothing;

alter table public.lead_sources
  add constraint lead_sources_name_not_blank check (btrim(name) <> ''),
  add constraint lead_sources_normalized_not_blank
    check (normalized_name is null or btrim(normalized_name) <> ''),
  add constraint lead_sources_code_not_blank check (code is null or btrim(code) <> ''),
  add constraint lead_sources_archive_actor_consistent check (
    (archived_at is null and archived_by is null) or archived_at is not null
  );

alter table public.deals
  add column first_lead_source_id uuid,
  add column last_lead_source_id uuid,
  add constraint deals_first_lead_source_same_org_fk
    foreign key (organization_id, first_lead_source_id)
    references public.lead_sources(organization_id, id)
    deferrable initially deferred,
  add constraint deals_last_lead_source_same_org_fk
    foreign key (organization_id, last_lead_source_id)
    references public.lead_sources(organization_id, id)
    deferrable initially deferred;

create table public.lead_source_attributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid,
  contact_id uuid,
  source_id uuid,
  attribution_state text not null,
  observed_at timestamptz not null,
  channel text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  fbclid text,
  gclid text,
  referrer text,
  campaign text,
  provenance text not null,
  external_event_id text,
  idempotency_key text not null,
  attributed_by uuid references public.profiles(id) on delete set null,
  raw_data jsonb,
  recorded_at timestamptz not null default now(),
  constraint lead_source_attributions_entity_required
    check (deal_id is not null or contact_id is not null),
  constraint lead_source_attributions_state_known
    check (attribution_state in ('known', 'unknown')),
  constraint lead_source_attributions_source_state_consistent check (
    (attribution_state = 'known' and source_id is not null)
    or (attribution_state = 'unknown' and source_id is null)
  ),
  constraint lead_source_attributions_channel_not_blank check (btrim(channel) <> ''),
  constraint lead_source_attributions_provenance_known
    check (provenance in ('automatic', 'api', 'import', 'human')),
  constraint lead_source_attributions_idempotency_not_blank
    check (btrim(idempotency_key) <> ''),
  constraint lead_source_attributions_raw_object
    check (raw_data is null or jsonb_typeof(raw_data) = 'object'),
  constraint lead_source_attributions_deal_same_org_fk
    foreign key (organization_id, deal_id)
    references public.deals(organization_id, id)
    on delete cascade,
  constraint lead_source_attributions_contact_same_org_fk
    foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id)
    on delete cascade,
  constraint lead_source_attributions_source_same_org_fk
    foreign key (organization_id, source_id)
    references public.lead_sources(organization_id, id)
    deferrable initially deferred,
  constraint lead_source_attributions_idempotency_unique
    unique (organization_id, idempotency_key),
  constraint lead_source_attributions_org_id_unique unique (organization_id, id)
);

create unique index lead_source_attributions_external_event_unique
  on public.lead_source_attributions(organization_id, channel, external_event_id)
  where external_event_id is not null;
create index lead_source_attributions_deal_history
  on public.lead_source_attributions(organization_id, deal_id, observed_at desc)
  where deal_id is not null;
create index lead_source_attributions_contact_history
  on public.lead_source_attributions(organization_id, contact_id, observed_at desc)
  where contact_id is not null;
create index lead_source_attributions_source_history
  on public.lead_source_attributions(organization_id, source_id, observed_at desc)
  where source_id is not null;

create or replace function public.prepare_lead_source_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.normalized_name := public.normalize_catalog_name(new.name);
  new.code := nullif(btrim(new.code), '');

  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then new.owner_id := (select auth.uid()); end if;
    if not new.active and new.archived_at is null then new.archived_at := now(); end if;
  else
    if new.organization_id is distinct from old.organization_id
      or new.created_at is distinct from old.created_at
      or new.owner_id is distinct from old.owner_id
    then
      raise exception using errcode = '23514', message = 'campos de identidade e auditoria da origem são imutáveis';
    end if;
    if old.code is not null and new.code is distinct from old.code then
      raise exception using errcode = '23514', message = 'o código estável da origem é imutável';
    end if;
    if not new.active and old.active and new.archived_at is null then
      new.archived_at := now();
    elsif new.active and not old.active then
      new.archived_at := null;
      new.archived_by := null;
    end if;
    if new.archived_at is not null and old.archived_at is null then
      new.active := false;
      if (select auth.uid()) is not null then new.archived_by := (select auth.uid()); end if;
    elsif new.archived_at is null and old.archived_at is not null then
      new.active := true;
      new.archived_by := null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_lead_source_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 and (
    exists (select 1 from public.lead_source_attributions where source_id = old.id)
    or exists (
      select 1 from public.deals
      where first_lead_source_id = old.id or last_lead_source_id = old.id
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'Origem com histórico não pode ser apagada. Arquive a origem.';
  end if;
  return old;
end;
$$;

revoke all on function public.prepare_lead_source_write() from public, anon, authenticated;
revoke all on function public.guard_lead_source_hard_delete() from public, anon, authenticated;

create trigger prepare_lead_source_write
  before insert or update on public.lead_sources
  for each row execute function public.prepare_lead_source_write();
create trigger guard_lead_source_hard_delete
  before delete on public.lead_sources
  for each row execute function public.guard_lead_source_hard_delete();

alter table public.lead_source_migration_reviews enable row level security;
alter table public.lead_source_attributions enable row level security;

grant select, insert, update, delete on table public.lead_sources to authenticated;
grant select, update on table public.lead_source_migration_reviews to authenticated;
grant select on table public.lead_source_attributions to authenticated;
grant all on table public.lead_source_migration_reviews, public.lead_source_attributions to service_role;

drop policy if exists "lead_sources_mutate_by_tenant_operator" on public.lead_sources;
create policy "lead_sources_insert_by_manager"
  on public.lead_sources for insert to authenticated
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('lead_sources.manage')
  );
create policy "lead_sources_update_by_manager"
  on public.lead_sources for update to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('lead_sources.manage')
  )
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('lead_sources.manage')
  );
create policy "lead_sources_delete_by_manager"
  on public.lead_sources for delete to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('lead_sources.manage')
  );

create policy "lead_source_reviews_select_by_manager"
  on public.lead_source_migration_reviews for select to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('lead_sources.manage')
  );
create policy "lead_source_reviews_update_by_manager"
  on public.lead_source_migration_reviews for update to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('lead_sources.manage')
  )
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('lead_sources.manage')
  );
create policy "lead_source_attributions_select_by_tenant"
  on public.lead_source_attributions for select to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('lead_sources.assign')
  );

create or replace function public.get_or_create_lead_source(
  p_organization_id uuid,
  p_name text,
  p_code text default null
)
returns public.lead_sources
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.lead_sources;
  v_name text := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  v_normalized text := public.normalize_catalog_name(p_name);
begin
  if not public.can_access_organization(p_organization_id)
    or not public.has_permission('lead_sources.manage')
  then
    raise exception using errcode = '42501', message = 'Sem permissão para gerenciar origens.';
  end if;
  if v_normalized = '' then
    raise exception using errcode = '22023', message = 'Informe o nome da origem.';
  end if;

  insert into public.lead_sources (
    organization_id, name, normalized_name, code, active, owner_id
  ) values (
    p_organization_id, v_name, v_normalized, nullif(btrim(p_code), ''), true,
    (select auth.uid())
  )
  on conflict (organization_id, normalized_name) do nothing
  returning * into v_source;
  if v_source.id is null then
    select * into strict v_source from public.lead_sources
    where organization_id = p_organization_id and normalized_name = v_normalized;
  end if;
  return v_source;
end;
$$;

create or replace function public.record_lead_source_attribution(
  p_organization_id uuid,
  p_idempotency_key text,
  p_deal_id uuid default null,
  p_contact_id uuid default null,
  p_source_id uuid default null,
  p_channel text default 'unknown',
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_term text default null,
  p_utm_content text default null,
  p_fbclid text default null,
  p_gclid text default null,
  p_referrer text default null,
  p_campaign text default null,
  p_external_event_id text default null
)
returns public.lead_source_attributions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attribution public.lead_source_attributions;
begin
  if (select auth.uid()) is null
    or not public.can_access_organization(p_organization_id)
    or not public.has_permission('lead_sources.assign')
  then
    raise exception using errcode = '42501', message = 'Sem permissão para registrar origem.';
  end if;
  if p_deal_id is null and p_contact_id is null then
    raise exception using errcode = '22023', message = 'Informe o negócio ou contato da atribuição.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'Informe a chave de idempotência da atribuição.';
  end if;
  if nullif(btrim(p_channel), '') is null then
    raise exception using errcode = '22023', message = 'Informe o canal observado.';
  end if;

  if p_deal_id is not null then
    perform 1 from public.deals
    where organization_id = p_organization_id and id = p_deal_id
    for update;
    if not found then
      raise exception using errcode = '23503', message = 'Negócio não encontrado nesta organização.';
    end if;
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.contacts
    where organization_id = p_organization_id and id = p_contact_id
  ) then
    raise exception using errcode = '23503', message = 'Contato não encontrado nesta organização.';
  end if;
  if p_source_id is not null and not exists (
    select 1 from public.lead_sources
    where organization_id = p_organization_id
      and id = p_source_id
      and active
      and archived_at is null
  ) then
    raise exception using errcode = '23503', message = 'Origem não encontrada ou arquivada nesta organização.';
  end if;

  insert into public.lead_source_attributions (
    organization_id, deal_id, contact_id, source_id, attribution_state,
    observed_at, channel, utm_source, utm_medium, utm_campaign, utm_term,
    utm_content, fbclid, gclid, referrer, campaign, provenance,
    external_event_id, idempotency_key, attributed_by, recorded_at
  ) values (
    p_organization_id, p_deal_id, p_contact_id, p_source_id,
    case when p_source_id is null then 'unknown' else 'known' end,
    now(), btrim(p_channel), p_utm_source, p_utm_medium, p_utm_campaign,
    p_utm_term, p_utm_content, p_fbclid, p_gclid, p_referrer, p_campaign,
    'human', nullif(btrim(p_external_event_id), ''), btrim(p_idempotency_key),
    (select auth.uid()), now()
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning * into v_attribution;

  if v_attribution.id is null then
    select * into strict v_attribution
    from public.lead_source_attributions
    where organization_id = p_organization_id
      and idempotency_key = btrim(p_idempotency_key);
    if v_attribution.deal_id is distinct from p_deal_id
      or v_attribution.contact_id is distinct from p_contact_id
      or v_attribution.source_id is distinct from p_source_id
      or v_attribution.channel is distinct from btrim(p_channel)
    then
      raise exception using
        errcode = '22023',
        message = 'A chave de idempotência já foi usada com outra atribuição.';
    end if;
    return v_attribution;
  end if;

  if p_deal_id is not null and p_source_id is not null then
    update public.deals
    set first_lead_source_id = coalesce(first_lead_source_id, p_source_id),
        last_lead_source_id = p_source_id
    where organization_id = p_organization_id and id = p_deal_id;
  end if;
  return v_attribution;
end;
$$;

revoke all on function public.get_or_create_lead_source(uuid, text, text) from public, anon;
revoke all on function public.record_lead_source_attribution(
  uuid, text, uuid, uuid, uuid, text, text, text, text, text, text,
  text, text, text, text, text
) from public, anon;
grant execute on function public.get_or_create_lead_source(uuid, text, text) to authenticated;
grant execute on function public.record_lead_source_attribution(
  uuid, text, uuid, uuid, uuid, text, text, text, text, text, text,
  text, text, text, text, text
) to authenticated;
