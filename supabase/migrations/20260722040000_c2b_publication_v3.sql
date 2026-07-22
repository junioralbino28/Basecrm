-- =============================================================================
-- C2B — publicação v3 por etiqueta UUID, preservando snapshots v1/v2
-- =============================================================================

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
  v_tag_id_text text;
begin
  select * into v_automation from public.automations where id = p_automation_id;
  if v_automation.id is null then return; end if;

  delete from public.automation_tag_dependencies
  where automation_id = p_automation_id and source_scope = 'draft';

  v_tag_id_text := nullif(btrim(v_automation.trigger_config ->> 'tag_id'), '');
  if v_automation.trigger_type = 'tag_added' and v_tag_id_text is not null then
    begin
      v_tag_id := v_tag_id_text::uuid;
    exception when invalid_text_representation then
      v_tag_id := null;
    end;

    insert into public.automation_tag_dependencies (
      organization_id, automation_id, category_id, tag_id,
      dependency_type, source_scope, source_key, legacy_value
    )
    select
      v_automation.organization_id, v_automation.id, tag.category_id, tag.id,
      'trigger', 'draft', 'trigger', coalesce(tag.legacy_value, tag.name)
    from public.tags tag
    join public.tag_categories category
      on category.id = tag.category_id
     and category.organization_id = tag.organization_id
     and category.archived_at is null
    where tag.id = v_tag_id
      and tag.organization_id = v_automation.organization_id
      and tag.archived_at is null;
  elsif v_automation.trigger_type = 'tag_added'
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
        v_automation.organization_id, v_automation.id, tag.category_id, tag.id,
        'trigger', 'draft', 'trigger', v_automation.trigger_config ->> 'tag'
      from public.tags tag where tag.id = v_tag_id;
    end if;
  end if;

  for v_case in
    select
      step.id as step_id,
      step.step_key::text as step_key,
      step.config ->> 'field' as field,
      item.value ->> 'case_id' as case_id,
      item.value ->> 'value' as case_value
    from public.automation_steps step
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(step.config -> 'cases') = 'array'
        then step.config -> 'cases' else '[]'::jsonb end
    ) item(value)
    where step.automation_id = p_automation_id
      and step.step_type = 'switch'
      and step.config ->> 'field' in ('deal.tags', 'deal.tag_ids')
      and nullif(btrim(item.value ->> 'value'), '') is not null
  loop
    if v_case.field = 'deal.tag_ids' then
      begin
        v_tag_id := v_case.case_value::uuid;
      exception when invalid_text_representation then
        v_tag_id := null;
      end;
    else
      v_tag_id := public.resolve_legacy_tag(v_automation.organization_id, v_case.case_value);
      if v_tag_id is null then
        perform public.record_unresolved_v2_tag_dependency(
          v_automation.organization_id,
          v_automation.id,
          'switch:' || v_case.step_key || ':' || coalesce(v_case.case_id, 'sem-case-id'),
          v_case.case_value
        );
      end if;
    end if;

    if v_tag_id is not null then
      insert into public.automation_tag_dependencies (
        organization_id, automation_id, step_id, step_key, case_id,
        category_id, tag_id, dependency_type, source_scope, source_key, legacy_value
      )
      select
        v_automation.organization_id, v_automation.id, v_case.step_id,
        v_case.step_key, v_case.case_id, tag.category_id, tag.id,
        'switch_case', 'draft',
        'switch:' || v_case.step_key || ':' || coalesce(v_case.case_id, 'sem-case-id'),
        coalesce(tag.legacy_value, tag.name)
      from public.tags tag
      join public.tag_categories category
        on category.id = tag.category_id
       and category.organization_id = tag.organization_id
       and category.archived_at is null
      where tag.id = v_tag_id
        and tag.organization_id = v_automation.organization_id
        and tag.archived_at is null;
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
  v_tag_id_text text;
  v_legacy_value text;
  v_schema_version integer;
begin
  select * into v_version from public.automation_versions where id = p_version_id;
  if v_version.id is null then return; end if;

  delete from public.automation_tag_dependencies
  where automation_version_id = p_version_id and source_scope = 'published';

  begin
    v_schema_version := coalesce((v_version.definition ->> 'schemaVersion')::integer, 1);
  exception when invalid_text_representation then
    v_schema_version := 1;
  end;

  if v_schema_version >= 3 then
    v_tag_id_text := nullif(btrim(
      v_version.definition -> 'trigger' -> 'config' ->> 'tagId'
    ), '');
    begin
      v_tag_id := v_tag_id_text::uuid;
    exception when invalid_text_representation then
      v_tag_id := null;
    end;
  else
    v_legacy_value := v_version.definition -> 'trigger' -> 'config' ->> 'tag';
    if nullif(btrim(v_legacy_value), '') is not null then
      v_tag_id := public.resolve_legacy_tag(v_version.organization_id, v_legacy_value);
      if v_tag_id is null then
        perform public.record_unresolved_v2_tag_dependency(
          v_version.organization_id, v_version.automation_id,
          v_version.id::text || ':trigger', v_legacy_value
        );
      end if;
    end if;
  end if;

  if v_tag_id is not null then
    insert into public.automation_tag_dependencies (
      organization_id, automation_id, automation_version_id,
      category_id, tag_id, dependency_type, source_scope, source_key, legacy_value
    )
    select
      v_version.organization_id, v_version.automation_id, v_version.id,
      tag.category_id, tag.id, 'trigger', 'published',
      v_version.id::text || ':trigger', coalesce(v_legacy_value, tag.legacy_value, tag.name)
    from public.tags tag
    join public.tag_categories category
      on category.id = tag.category_id
     and category.organization_id = tag.organization_id
     and category.archived_at is null
    where tag.id = v_tag_id
      and tag.organization_id = v_version.organization_id
      and tag.archived_at is null;
  end if;

  for v_case in
    select
      step.value ->> 'stepKey' as step_key,
      step.value -> 'config' ->> 'field' as field,
      switch_case.value ->> 'caseId' as case_id,
      switch_case.value ->> 'value' as case_value
    from jsonb_array_elements(
      case when jsonb_typeof(v_version.definition -> 'steps') = 'array'
        then v_version.definition -> 'steps' else '[]'::jsonb end
    ) step(value)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(step.value -> 'config' -> 'cases') = 'array'
        then step.value -> 'config' -> 'cases' else '[]'::jsonb end
    ) switch_case(value)
    where step.value ->> 'type' = 'switch'
      and step.value -> 'config' ->> 'field' in ('deal.tags', 'deal.tag_ids')
      and nullif(btrim(switch_case.value ->> 'value'), '') is not null
  loop
    v_legacy_value := null;
    if v_case.field = 'deal.tag_ids' then
      begin
        v_tag_id := v_case.case_value::uuid;
      exception when invalid_text_representation then
        v_tag_id := null;
      end;
    else
      v_legacy_value := v_case.case_value;
      v_tag_id := public.resolve_legacy_tag(v_version.organization_id, v_legacy_value);
      if v_tag_id is null then
        perform public.record_unresolved_v2_tag_dependency(
          v_version.organization_id,
          v_version.automation_id,
          v_version.id::text || ':switch:' || coalesce(v_case.step_key, 'sem-step')
            || ':' || coalesce(v_case.case_id, 'sem-case-id'),
          v_legacy_value
        );
      end if;
    end if;

    if v_tag_id is not null then
      insert into public.automation_tag_dependencies (
        organization_id, automation_id, automation_version_id, step_key, case_id,
        category_id, tag_id, dependency_type, source_scope, source_key, legacy_value
      )
      select
        v_version.organization_id, v_version.automation_id, v_version.id,
        v_case.step_key, v_case.case_id, tag.category_id, tag.id,
        'switch_case', 'published',
        v_version.id::text || ':switch:' || coalesce(v_case.step_key, 'sem-step')
          || ':' || coalesce(v_case.case_id, 'sem-case-id'),
        coalesce(v_legacy_value, tag.legacy_value, tag.name)
      from public.tags tag
      join public.tag_categories category
        on category.id = tag.category_id
       and category.organization_id = tag.organization_id
       and category.archived_at is null
      where tag.id = v_tag_id
        and tag.organization_id = v_version.organization_id
        and tag.archived_at is null;
    end if;
  end loop;
end;
$$;

create or replace function public.guard_published_automation_tag_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tag_id uuid;
begin
  if new.lifecycle_status <> 'published' or new.published_version_id is null then
    return new;
  end if;
  if old.lifecycle_status = 'published'
    and old.published_version_id is not distinct from new.published_version_id
  then
    return new;
  end if;

  select dependency.tag_id
  into v_tag_id
  from public.automation_tag_dependencies dependency
  where dependency.organization_id = new.organization_id
    and dependency.automation_id = new.id
    and dependency.automation_version_id = new.published_version_id
    and dependency.source_scope = 'published'
    and dependency.dependency_type = 'trigger';
  if v_tag_id is null then
    raise exception using
      errcode = '22023',
      message = 'A automação precisa de uma etiqueta de serviço válida antes de publicar.';
  end if;

  perform 1
  from public.tags tag
  join public.tag_categories category
    on category.id = tag.category_id
   and category.organization_id = tag.organization_id
   and category.archived_at is null
  where tag.organization_id = new.organization_id
    and tag.id = v_tag_id
    and tag.archived_at is null
  for update of tag;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'A etiqueta de serviço está arquivada ou não pertence a esta organização.';
  end if;

  if exists (
    select 1
    from public.automations automation
    join public.automation_tag_dependencies dependency
      on dependency.organization_id = automation.organization_id
     and dependency.automation_id = automation.id
     and dependency.automation_version_id = automation.published_version_id
     and dependency.source_scope = 'published'
     and dependency.dependency_type = 'trigger'
    where automation.organization_id = new.organization_id
      and automation.id <> new.id
      and automation.lifecycle_status = 'published'
      and dependency.tag_id = v_tag_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'Esta etiqueta já possui uma automação publicada ativa. Pause a automação atual antes de publicar outra.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_published_automation_tag_owner()
  from public, anon, authenticated;
grant execute on function public.guard_published_automation_tag_owner() to service_role;

drop trigger if exists guard_published_automation_tag_owner on public.automations;
create trigger guard_published_automation_tag_owner
  before update of lifecycle_status, published_version_id on public.automations
  for each row execute function public.guard_published_automation_tag_owner();

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
