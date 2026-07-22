-- =============================================================================
-- C2A — backfill honesto de deals.tags e dependências v2 materializadas
-- =============================================================================

create table public.tag_migration_reviews (
  id uuid primary key default gen_random_uuid(),
  review_key text not null unique,
  organization_id uuid references public.organizations(id) on delete cascade,
  review_type text not null,
  normalized_name text,
  legacy_values text[] not null default '{}',
  tag_ids uuid[] not null default '{}',
  deal_ids uuid[] not null default '{}',
  details jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  constraint tag_migration_reviews_type_known check (
    review_type in ('orphan_tag', 'normalization_collision', 'v2_dependency_unresolved')
  ),
  constraint tag_migration_reviews_status_known check (status in ('pending', 'resolved')),
  constraint tag_migration_reviews_resolution_consistent check (
    (status = 'pending' and resolved_at is null and resolved_by is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);

create index tag_migration_reviews_pending
  on public.tag_migration_reviews(organization_id, detected_at)
  where status = 'pending';

alter table public.tag_migration_reviews enable row level security;
grant select, update on table public.tag_migration_reviews to authenticated;
grant all on table public.tag_migration_reviews to service_role;

create policy "tag_migration_reviews_select_by_manager"
  on public.tag_migration_reviews for select to authenticated
  using (
    organization_id is not null
    and public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  );
create policy "tag_migration_reviews_update_by_manager"
  on public.tag_migration_reviews for update to authenticated
  using (
    organization_id is not null
    and public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  )
  with check (
    organization_id is not null
    and public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  );

create or replace function public.reconcile_legacy_deal_tags(
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group record;
  v_category_id uuid;
  v_existing_category_id uuid;
  v_tag_id uuid;
  v_existing_count integer;
  v_migrated_groups integer := 0;
  v_collision_groups integer := 0;
  v_assignments integer := 0;
  v_inserted integer := 0;
begin
  insert into public.tag_migration_reviews (
    review_key, organization_id, review_type, normalized_name,
    legacy_values, tag_ids, details
  )
  select
    'orphan_tag:' || t.id::text,
    null,
    'orphan_tag',
    public.normalize_catalog_name(t.name),
    array[t.name],
    array[t.id],
    jsonb_build_object('motivo', 'Etiqueta sem organização; tenant não foi inferido.')
  from public.tags t
  where t.organization_id is null
  on conflict (review_key) do update
    set legacy_values = excluded.legacy_values,
        tag_ids = excluded.tag_ids,
        details = excluded.details;

  for v_group in
    with raw_values as (
      select
        t.organization_id,
        regexp_replace(btrim(t.name), '\s+', ' ', 'g') as display_value,
        t.id as tag_id,
        null::uuid as deal_id
      from public.tags t
      where t.organization_id is not null
        and t.category_id is null
        and (p_organization_id is null or t.organization_id = p_organization_id)
      union all
      select
        d.organization_id,
        regexp_replace(btrim(legacy_item.raw_value), '\s+', ' ', 'g') as display_value,
        null::uuid as tag_id,
        d.id as deal_id
      from public.deals d
      cross join lateral unnest(coalesce(d.tags, '{}'::text[])) legacy_item(raw_value)
      where btrim(legacy_item.raw_value) <> ''
        and (p_organization_id is null or d.organization_id = p_organization_id)
    ), grouped as (
      select
        organization_id,
        public.normalize_catalog_name(display_value) as normalized_name,
        array_agg(distinct display_value order by display_value) as legacy_values,
        array_agg(distinct tag_id) filter (where tag_id is not null) as tag_ids,
        array_agg(distinct deal_id) filter (where deal_id is not null) as deal_ids
      from raw_values
      where display_value <> ''
      group by organization_id, public.normalize_catalog_name(display_value)
    )
    select
      organization_id,
      normalized_name,
      legacy_values,
      coalesce(tag_ids, '{}'::uuid[]) as tag_ids,
      coalesce(deal_ids, '{}'::uuid[]) as deal_ids
    from grouped
  loop
    if cardinality(v_group.legacy_values) > 1 then
      insert into public.tag_migration_reviews (
        review_key, organization_id, review_type, normalized_name,
        legacy_values, tag_ids, deal_ids, details
      ) values (
        'normalization_collision:' || v_group.organization_id::text || ':' || v_group.normalized_name,
        v_group.organization_id,
        'normalization_collision',
        v_group.normalized_name,
        v_group.legacy_values,
        v_group.tag_ids,
        v_group.deal_ids,
        jsonb_build_object(
          'motivo', 'Variantes legadas normalizam para o mesmo nome; nenhuma atribuição foi criada.'
        )
      )
      on conflict (review_key) do update
        set legacy_values = excluded.legacy_values,
            tag_ids = excluded.tag_ids,
            deal_ids = excluded.deal_ids,
            details = excluded.details;
      v_collision_groups := v_collision_groups + 1;
      continue;
    end if;

    insert into public.tag_categories (
      organization_id, label, normalized_name, cardinality, code
    ) values (
      v_group.organization_id,
      'Legado (revisar)',
      public.normalize_catalog_name('Legado (revisar)'),
      'multiple',
      'legacy-import'
    )
    on conflict (organization_id, normalized_name) do nothing;
    select id into strict v_category_id
    from public.tag_categories
    where organization_id = v_group.organization_id
      and normalized_name = public.normalize_catalog_name('Legado (revisar)');

    select
      count(*),
      (array_agg(id order by id))[1],
      (array_agg(category_id order by id) filter (where category_id is not null))[1]
    into v_existing_count, v_tag_id, v_existing_category_id
    from public.tags
    where organization_id = v_group.organization_id
      and public.normalize_catalog_name(name) = v_group.normalized_name;

    if v_existing_count > 1 then
      insert into public.tag_migration_reviews (
        review_key, organization_id, review_type, normalized_name,
        legacy_values, tag_ids, deal_ids, details
      ) values (
        'normalization_collision:' || v_group.organization_id::text || ':' || v_group.normalized_name,
        v_group.organization_id,
        'normalization_collision',
        v_group.normalized_name,
        v_group.legacy_values,
        v_group.tag_ids,
        v_group.deal_ids,
        jsonb_build_object('motivo', 'Mais de uma entidade legada corresponde ao mesmo nome normalizado.')
      )
      on conflict (review_key) do update
        set tag_ids = excluded.tag_ids,
            deal_ids = excluded.deal_ids,
            details = excluded.details;
      v_collision_groups := v_collision_groups + 1;
      continue;
    elsif v_existing_count = 1 and v_existing_category_id is not null then
      v_category_id := v_existing_category_id;
      update public.tags
      set normalized_name = v_group.normalized_name,
          legacy_value = coalesce(legacy_value, v_group.legacy_values[1])
      where id = v_tag_id;
    elsif v_existing_count = 1 then
      update public.tags
      set category_id = v_category_id,
          normalized_name = v_group.normalized_name,
          legacy_value = coalesce(legacy_value, v_group.legacy_values[1])
      where id = v_tag_id;
    else
      insert into public.tags (
        organization_id, category_id, name, normalized_name, legacy_value
      ) values (
        v_group.organization_id,
        v_category_id,
        v_group.legacy_values[1],
        v_group.normalized_name,
        v_group.legacy_values[1]
      )
      returning id into v_tag_id;
    end if;

    insert into public.deal_tag_assignments (
      organization_id, deal_id, category_id, tag_id, is_primary,
      provenance, applied_at, applied_by, recorded_at
    )
    select distinct
      d.organization_id,
      d.id,
      v_category_id,
      v_tag_id,
      false,
      'legacy_migration',
      null::timestamptz,
      null::uuid,
      now()
    from public.deals d
    cross join lateral unnest(coalesce(d.tags, '{}'::text[])) legacy_item(raw_value)
    where d.organization_id = v_group.organization_id
      and public.normalize_catalog_name(legacy_item.raw_value) = v_group.normalized_name
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    v_assignments := v_assignments + v_inserted;
    v_migrated_groups := v_migrated_groups + 1;
  end loop;

  return jsonb_build_object(
    'migrated_groups', v_migrated_groups,
    'collision_groups', v_collision_groups,
    'assignments', v_assignments
  );
end;
$$;

revoke all on function public.reconcile_legacy_deal_tags(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_legacy_deal_tags(uuid) to service_role;

select public.reconcile_legacy_deal_tags(null);

create table public.automation_tag_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null,
  automation_version_id uuid,
  step_id uuid,
  step_key text,
  case_id text,
  category_id uuid not null,
  tag_id uuid not null,
  dependency_type text not null,
  source_scope text not null,
  source_key text not null,
  legacy_value text not null,
  created_at timestamptz not null default now(),
  constraint automation_tag_dependencies_type_known
    check (dependency_type in ('trigger', 'switch_case')),
  constraint automation_tag_dependencies_scope_known
    check (source_scope in ('draft', 'published')),
  constraint automation_tag_dependencies_shape check (
    (source_scope = 'draft' and automation_version_id is null)
    or (source_scope = 'published' and automation_version_id is not null)
  ),
  constraint automation_tag_dependencies_automation_same_org_fk
    foreign key (automation_id, organization_id)
    references public.automations(id, organization_id)
    on delete cascade,
  constraint automation_tag_dependencies_version_same_org_fk
    foreign key (automation_version_id, automation_id, organization_id)
    references public.automation_versions(id, automation_id, organization_id)
    on delete cascade,
  constraint automation_tag_dependencies_step_same_org_fk
    foreign key (step_id, automation_id, organization_id)
    references public.automation_steps(id, automation_id, organization_id)
    on delete cascade,
  constraint automation_tag_dependencies_tag_same_org_category_fk
    foreign key (organization_id, tag_id, category_id)
    references public.tags(organization_id, id, category_id)
    on delete restrict,
  constraint automation_tag_dependencies_source_unique
    unique (organization_id, automation_id, source_scope, source_key)
);

create index automation_tag_dependencies_tag_usage
  on public.automation_tag_dependencies(organization_id, tag_id, source_scope);
create index automation_tag_dependencies_version
  on public.automation_tag_dependencies(automation_version_id)
  where automation_version_id is not null;

alter table public.automation_tag_dependencies enable row level security;
grant select on table public.automation_tag_dependencies to authenticated;
grant all on table public.automation_tag_dependencies to service_role;

create policy "automation_tag_dependencies_select_by_editor"
  on public.automation_tag_dependencies for select to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('tags.manage')
    )
  );

create or replace function public.resolve_legacy_tag(
  p_organization_id uuid,
  p_legacy_value text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(t.id order by t.id))[1] end
  from public.tags t
  where t.organization_id = p_organization_id
    and t.category_id is not null
    and t.archived_at is null
    and public.normalize_catalog_name(coalesce(t.legacy_value, t.name))
      = public.normalize_catalog_name(p_legacy_value);
$$;

create or replace function public.record_unresolved_v2_tag_dependency(
  p_organization_id uuid,
  p_automation_id uuid,
  p_source_key text,
  p_legacy_value text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_legacy_value), '') is null then return; end if;
  insert into public.tag_migration_reviews (
    review_key, organization_id, review_type, normalized_name,
    legacy_values, tag_ids, details
  )
  select
    'v2_dependency_unresolved:' || p_organization_id::text || ':' || p_automation_id::text || ':' || p_source_key,
    p_organization_id,
    'v2_dependency_unresolved',
    public.normalize_catalog_name(p_legacy_value),
    array[p_legacy_value],
    coalesce(array_agg(t.id order by t.id) filter (where t.id is not null), '{}'::uuid[]),
    jsonb_build_object(
      'automation_id', p_automation_id,
      'source_key', p_source_key,
      'motivo', 'Referência textual v2 sem uma única etiqueta correspondente.'
    )
  from public.tags t
  where t.organization_id = p_organization_id
    and public.normalize_catalog_name(coalesce(t.legacy_value, t.name))
      = public.normalize_catalog_name(p_legacy_value)
  on conflict (review_key) do update
    set legacy_values = excluded.legacy_values,
        tag_ids = excluded.tag_ids,
        details = excluded.details;
end;
$$;

create or replace function public.refresh_draft_tag_dependencies(p_automation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_automation public.automations;
  v_case record;
  v_tag_id uuid;
begin
  select * into v_automation from public.automations where id = p_automation_id;
  if v_automation.id is null then return; end if;

  delete from public.automation_tag_dependencies
  where automation_id = p_automation_id and source_scope = 'draft';

  if v_automation.trigger_type = 'tag_added'
    and nullif(btrim(v_automation.trigger_config ->> 'tag'), '') is not null
  then
    v_tag_id := public.resolve_legacy_tag(
      v_automation.organization_id,
      v_automation.trigger_config ->> 'tag'
    );
    if v_tag_id is null then
      perform public.record_unresolved_v2_tag_dependency(
        v_automation.organization_id, v_automation.id, 'trigger',
        v_automation.trigger_config ->> 'tag'
      );
    else
      insert into public.automation_tag_dependencies (
        organization_id, automation_id, category_id, tag_id,
        dependency_type, source_scope, source_key, legacy_value
      )
      select
        v_automation.organization_id, v_automation.id, t.category_id, t.id,
        'trigger', 'draft', 'trigger', v_automation.trigger_config ->> 'tag'
      from public.tags t where t.id = v_tag_id;
    end if;
  end if;

  for v_case in
    select
      s.id as step_id,
      s.step_key::text as step_key,
      item.value ->> 'case_id' as case_id,
      item.value ->> 'value' as legacy_value
    from public.automation_steps s
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(s.config -> 'cases') = 'array'
        then s.config -> 'cases' else '[]'::jsonb end
    ) with ordinality item(value, ord)
    where s.automation_id = p_automation_id
      and s.step_type = 'switch'
      and s.config ->> 'field' = 'deal.tags'
      and nullif(btrim(item.value ->> 'value'), '') is not null
  loop
    v_tag_id := public.resolve_legacy_tag(v_automation.organization_id, v_case.legacy_value);
    if v_tag_id is null then
      perform public.record_unresolved_v2_tag_dependency(
        v_automation.organization_id,
        v_automation.id,
        'switch:' || v_case.step_key || ':' || coalesce(v_case.case_id, 'sem-case-id'),
        v_case.legacy_value
      );
    else
      insert into public.automation_tag_dependencies (
        organization_id, automation_id, step_id, step_key, case_id,
        category_id, tag_id, dependency_type, source_scope, source_key, legacy_value
      )
      select
        v_automation.organization_id, v_automation.id, v_case.step_id,
        v_case.step_key, v_case.case_id, t.category_id, t.id,
        'switch_case', 'draft',
        'switch:' || v_case.step_key || ':' || coalesce(v_case.case_id, 'sem-case-id'),
        v_case.legacy_value
      from public.tags t where t.id = v_tag_id;
    end if;
  end loop;
end;
$$;

create or replace function public.refresh_published_tag_dependencies(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.automation_versions;
  v_case record;
  v_tag_id uuid;
  v_legacy_value text;
begin
  select * into v_version from public.automation_versions where id = p_version_id;
  if v_version.id is null then return; end if;

  delete from public.automation_tag_dependencies
  where automation_version_id = p_version_id and source_scope = 'published';

  v_legacy_value := v_version.definition -> 'trigger' -> 'config' ->> 'tag';
  if nullif(btrim(v_legacy_value), '') is not null then
    v_tag_id := public.resolve_legacy_tag(v_version.organization_id, v_legacy_value);
    if v_tag_id is null then
      perform public.record_unresolved_v2_tag_dependency(
        v_version.organization_id, v_version.automation_id,
        v_version.id::text || ':trigger', v_legacy_value
      );
    else
      insert into public.automation_tag_dependencies (
        organization_id, automation_id, automation_version_id,
        category_id, tag_id, dependency_type, source_scope, source_key, legacy_value
      )
      select
        v_version.organization_id, v_version.automation_id, v_version.id,
        t.category_id, t.id, 'trigger', 'published',
        v_version.id::text || ':trigger', v_legacy_value
      from public.tags t where t.id = v_tag_id;
    end if;
  end if;

  for v_case in
    select
      step.value ->> 'stepKey' as step_key,
      switch_case.value ->> 'caseId' as case_id,
      switch_case.value ->> 'value' as legacy_value
    from jsonb_array_elements(
      case when jsonb_typeof(v_version.definition -> 'steps') = 'array'
        then v_version.definition -> 'steps' else '[]'::jsonb end
    ) with ordinality step(value, ord)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(step.value -> 'config' -> 'cases') = 'array'
        then step.value -> 'config' -> 'cases' else '[]'::jsonb end
    ) with ordinality switch_case(value, ord)
    where step.value ->> 'type' = 'switch'
      and step.value -> 'config' ->> 'field' = 'deal.tags'
      and nullif(btrim(switch_case.value ->> 'value'), '') is not null
  loop
    v_tag_id := public.resolve_legacy_tag(v_version.organization_id, v_case.legacy_value);
    if v_tag_id is null then
      perform public.record_unresolved_v2_tag_dependency(
        v_version.organization_id,
        v_version.automation_id,
        v_version.id::text || ':switch:' || coalesce(v_case.step_key, 'sem-step')
          || ':' || coalesce(v_case.case_id, 'sem-case-id'),
        v_case.legacy_value
      );
    else
      insert into public.automation_tag_dependencies (
        organization_id, automation_id, automation_version_id, step_key, case_id,
        category_id, tag_id, dependency_type, source_scope, source_key, legacy_value
      )
      select
        v_version.organization_id, v_version.automation_id, v_version.id,
        v_case.step_key, v_case.case_id, t.category_id, t.id,
        'switch_case', 'published',
        v_version.id::text || ':switch:' || coalesce(v_case.step_key, 'sem-step')
          || ':' || coalesce(v_case.case_id, 'sem-case-id'),
        v_case.legacy_value
      from public.tags t where t.id = v_tag_id;
    end if;
  end loop;
end;
$$;

create or replace function public.sync_automation_tag_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'automations' then
    perform public.refresh_draft_tag_dependencies(new.id);
  elsif tg_table_name = 'automation_versions' then
    perform public.refresh_published_tag_dependencies(new.id);
  elsif tg_op = 'DELETE' then
    perform public.refresh_draft_tag_dependencies(old.automation_id);
  else
    perform public.refresh_draft_tag_dependencies(new.automation_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.resolve_legacy_tag(uuid, text) from public, anon, authenticated;
revoke all on function public.record_unresolved_v2_tag_dependency(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.refresh_draft_tag_dependencies(uuid) from public, anon, authenticated;
revoke all on function public.refresh_published_tag_dependencies(uuid) from public, anon, authenticated;
revoke all on function public.sync_automation_tag_dependencies() from public, anon, authenticated;

create trigger sync_automation_draft_tag_dependencies
  after insert or update of trigger_type, trigger_config on public.automations
  for each row execute function public.sync_automation_tag_dependencies();
create trigger sync_automation_step_tag_dependencies
  after insert or update or delete on public.automation_steps
  for each row execute function public.sync_automation_tag_dependencies();
create trigger sync_automation_version_tag_dependencies
  after insert on public.automation_versions
  for each row execute function public.sync_automation_tag_dependencies();

do $$
declare v_id uuid;
begin
  for v_id in select id from public.automations loop
    perform public.refresh_draft_tag_dependencies(v_id);
  end loop;
  for v_id in select id from public.automation_versions loop
    perform public.refresh_published_tag_dependencies(v_id);
  end loop;
end;
$$;

create or replace function public.guard_tag_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null and exists (
    select 1
    from public.automation_tag_dependencies d
    join public.automations a
      on a.id = d.automation_id and a.organization_id = d.organization_id
    where d.tag_id = old.id
      and d.source_scope = 'published'
      and d.automation_version_id = a.published_version_id
      and a.lifecycle_status = 'published'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Esta etiqueta é usada por uma automação publicada. Pause ou republique a automação sem esta etiqueta antes de arquivar.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_tag_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 and (
    exists (select 1 from public.deal_tag_assignments where tag_id = old.id)
    or exists (select 1 from public.automation_tag_dependencies where tag_id = old.id)
  ) then
    raise exception using
      errcode = '55000',
      message = 'Etiqueta com histórico ou dependências não pode ser apagada. Arquive a etiqueta.';
  end if;
  return old;
end;
$$;

create or replace function public.guard_tag_category_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1
    and exists (select 1 from public.tags where category_id = old.id)
  then
    raise exception using
      errcode = '55000',
      message = 'A categoria possui etiquetas. Arquive ou mova as etiquetas antes de apagar a categoria.';
  end if;
  return old;
end;
$$;

create or replace function public.guard_tag_category_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null and exists (
    select 1 from public.tags where category_id = old.id and archived_at is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'Esta categoria possui etiquetas ativas. Arquive cada etiqueta antes de arquivar a categoria.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_tag_archive() from public, anon, authenticated;
revoke all on function public.guard_tag_category_archive() from public, anon, authenticated;
revoke all on function public.guard_tag_category_delete() from public, anon, authenticated;

create trigger guard_tag_archive
  before update on public.tags
  for each row execute function public.guard_tag_archive();
create trigger guard_tag_category_archive
  before update on public.tag_categories
  for each row execute function public.guard_tag_category_archive();
