-- =============================================================================
-- C2B — executor v3 do switch por identidade estável de etiqueta
-- =============================================================================

create or replace function public.evaluate_automation_switch(
  p_enrollment_id uuid,
  p_step_key uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_step jsonb;
  v_case jsonb;
  v_schema_version integer;
  v_field text;
  v_operator text;
  v_value text;
  v_case_id text;
  v_matches boolean;
begin
  select
    enrollment.current_step_key,
    definition.definition,
    contact.phone as contact_phone,
    deal.tags as deal_tags,
    deal.stage_id as deal_stage_id,
    deal.board_id as deal_board_id,
    coalesce(array(
      select assignment.tag_id
      from public.deal_tag_assignments assignment
      join public.tags tag
        on tag.organization_id = assignment.organization_id
       and tag.id = assignment.tag_id
      where assignment.organization_id = enrollment.organization_id
        and assignment.deal_id = enrollment.deal_id
        and assignment.removed_at is null
        and tag.archived_at is null
      order by assignment.tag_id
    ), '{}'::uuid[]) as deal_tag_ids
  into v_context
  from public.automation_enrollments enrollment
  join public.automation_versions definition
    on definition.id = enrollment.automation_version_id
   and definition.organization_id = enrollment.organization_id
  join public.contacts contact
    on contact.id = enrollment.contact_id
   and contact.organization_id = enrollment.organization_id
  join public.deals deal
    on deal.id = enrollment.deal_id
   and deal.organization_id = enrollment.organization_id
  where enrollment.id = p_enrollment_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'inscrição não encontrada';
  end if;
  if v_context.current_step_key <> p_step_key then
    raise exception using errcode = '55000', message = 'cursor da inscrição já avançou';
  end if;

  v_schema_version := coalesce((v_context.definition->>'schemaVersion')::integer, 1);
  select step.value
  into v_step
  from jsonb_array_elements(v_context.definition->'steps') step(value)
  where step.value->>'stepKey' = p_step_key::text;

  if v_step is null or v_step->>'type' <> 'switch' then
    raise exception using errcode = '22023', message = 'passo não é um switch publicado';
  end if;

  v_field := v_step#>>'{config,field}';
  if v_field not in (
    'deal.tags', 'deal.tag_ids', 'contact.phone', 'deal.stage_id', 'deal.board_id'
  ) then
    raise exception using errcode = '22023', message = 'campo do switch não suportado';
  end if;
  if v_field = 'deal.tags' and v_schema_version >= 3 then
    raise exception using errcode = '22023', message = 'snapshot v3 deve usar deal.tag_ids';
  end if;
  if v_field = 'deal.tag_ids' and v_schema_version < 3 then
    raise exception using errcode = '22023', message = 'snapshot legado deve usar deal.tags';
  end if;

  for v_case in
    select case_item.value
    from jsonb_array_elements(v_step#>'{config,cases}') case_item(value)
    order by
      (case_item.value->>'order')::integer,
      case_item.value->>'caseId'
  loop
    v_case_id := v_case->>'caseId';
    v_operator := v_case->>'operator';
    v_value := v_case->>'value';
    v_matches := false;

    if v_field = 'deal.tags' then
      if v_operator = 'contains' then
        v_matches := coalesce(v_context.deal_tags, '{}'::text[]) @> array[v_value];
      elsif v_operator = 'not_contains' then
        v_matches := not (
          coalesce(v_context.deal_tags, '{}'::text[]) @> array[v_value]
        );
      else
        raise exception using errcode = '22023', message = 'operador inválido para deal.tags';
      end if;
    elsif v_field = 'deal.tag_ids' then
      if v_value is null
        or v_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception using errcode = '22023', message = 'UUID inválido no switch publicado';
      end if;
      if v_operator = 'contains' then
        v_matches := v_context.deal_tag_ids @> array[v_value::uuid];
      elsif v_operator = 'not_contains' then
        v_matches := not (v_context.deal_tag_ids @> array[v_value::uuid]);
      else
        raise exception using errcode = '22023', message = 'operador inválido para deal.tag_ids';
      end if;
    elsif v_field = 'contact.phone' then
      if v_operator = 'equals' then
        v_matches := coalesce(v_context.contact_phone, '') = v_value;
      elsif v_operator = 'not_equals' then
        v_matches := coalesce(v_context.contact_phone, '') <> v_value;
      elsif v_operator = 'contains' then
        v_matches := position(v_value in coalesce(v_context.contact_phone, '')) > 0;
      elsif v_operator = 'not_contains' then
        v_matches := position(v_value in coalesce(v_context.contact_phone, '')) = 0;
      elsif v_operator = 'exists' then
        v_matches := nullif(btrim(v_context.contact_phone), '') is not null;
      else
        raise exception using errcode = '22023', message = 'operador inválido para contact.phone';
      end if;
    elsif v_field = 'deal.stage_id' then
      if v_operator = 'equals' then
        v_matches := v_context.deal_stage_id::text = v_value;
      elsif v_operator = 'not_equals' then
        v_matches := v_context.deal_stage_id::text is distinct from v_value;
      elsif v_operator = 'exists' then
        v_matches := v_context.deal_stage_id is not null;
      else
        raise exception using errcode = '22023', message = 'operador inválido para deal.stage_id';
      end if;
    elsif v_field = 'deal.board_id' then
      if v_operator = 'equals' then
        v_matches := v_context.deal_board_id::text = v_value;
      elsif v_operator = 'not_equals' then
        v_matches := v_context.deal_board_id::text is distinct from v_value;
      elsif v_operator = 'exists' then
        v_matches := v_context.deal_board_id is not null;
      else
        raise exception using errcode = '22023', message = 'operador inválido para deal.board_id';
      end if;
    end if;

    if v_matches then
      if v_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'caseId inválido no switch publicado';
      end if;
      return 'case:' || v_case_id;
    end if;
  end loop;

  return 'otherwise';
end;
$$;

revoke all on function public.evaluate_automation_switch(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.evaluate_automation_switch(uuid, uuid)
  to service_role;
