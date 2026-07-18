-- =============================================================================
-- Funil Construtor — F6: persistência atômica do builder manual
-- =============================================================================

create or replace function public.save_automation_draft(
  p_organization_id uuid,
  p_automation_id uuid,
  p_expected_draft_revision bigint,
  p_name text,
  p_trigger_config jsonb,
  p_steps jsonb,
  p_edges jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_automation public.automations%rowtype;
  v_step jsonb;
  v_edge jsonb;
  v_from_id uuid;
  v_to_id uuid;
begin
  if nullif(btrim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'nome da automação obrigatório';
  end if;
  if jsonb_typeof(p_trigger_config) <> 'object'
    or jsonb_typeof(p_steps) <> 'array'
    or jsonb_typeof(p_edges) <> 'array'
  then
    raise exception using errcode = '22023', message = 'payload do draft inválido';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_id
  ) then
    raise exception using errcode = '23503', message = 'ator do draft não encontrado';
  end if;

  if p_automation_id is null then
    insert into public.automations (
      organization_id,
      name,
      lifecycle_status,
      delivery_mode,
      trigger_type,
      trigger_config,
      created_by
    )
    values (
      p_organization_id,
      btrim(p_name),
      'draft',
      'simulation',
      'tag_added',
      p_trigger_config,
      p_actor_id
    )
    returning * into v_automation;
  else
    select *
    into v_automation
    from public.automations
    where id = p_automation_id
      and organization_id = p_organization_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'automação não encontrada no tenant';
    end if;
    if p_expected_draft_revision is null
      or v_automation.draft_revision <> p_expected_draft_revision
    then
      raise exception using
        errcode = '55000',
        message = 'rascunho alterado em outra sessão; recarregue antes de salvar';
    end if;

    update public.automations
    set name = btrim(p_name),
        trigger_type = 'tag_added',
        trigger_config = p_trigger_config,
        delivery_mode = 'simulation',
        updated_at = now()
    where id = v_automation.id
    returning * into v_automation;
  end if;

  delete from public.automation_step_edges
  where automation_id = v_automation.id
    and organization_id = p_organization_id;

  delete from public.automation_steps step
  where step.automation_id = v_automation.id
    and step.organization_id = p_organization_id
    and not exists (
      select 1
      from jsonb_array_elements(p_steps) payload
      where payload->>'stepKey' = step.step_key::text
    );

  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    if coalesce(v_step->>'stepKey', '') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(v_step->>'stepType', '') is null
      or jsonb_typeof(v_step->'config') <> 'object'
      or coalesce(v_step->>'sortKey', '') !~ '^[0-9]+$'
    then
      raise exception using errcode = '22023', message = 'passo do draft inválido';
    end if;

    insert into public.automation_steps (
      organization_id,
      automation_id,
      step_key,
      step_type,
      config,
      sort_key
    )
    values (
      p_organization_id,
      v_automation.id,
      (v_step->>'stepKey')::uuid,
      v_step->>'stepType',
      v_step->'config',
      (v_step->>'sortKey')::integer
    )
    on conflict (automation_id, step_key) do update
    set step_type = excluded.step_type,
        config = excluded.config,
        sort_key = excluded.sort_key,
        updated_at = now();
  end loop;

  for v_edge in select value from jsonb_array_elements(p_edges)
  loop
    select id
    into v_from_id
    from public.automation_steps
    where automation_id = v_automation.id
      and organization_id = p_organization_id
      and step_key = (v_edge->>'fromStepKey')::uuid;

    select id
    into v_to_id
    from public.automation_steps
    where automation_id = v_automation.id
      and organization_id = p_organization_id
      and step_key = (v_edge->>'toStepKey')::uuid;

    if v_from_id is null
      or v_to_id is null
      or nullif(v_edge->>'outcome', '') is null
      or coalesce(v_edge->>'order', '') !~ '^[0-9]+$'
    then
      raise exception using errcode = '22023', message = 'aresta do draft inválida';
    end if;

    insert into public.automation_step_edges (
      organization_id,
      automation_id,
      from_step_id,
      outcome,
      to_step_id,
      "order"
    )
    values (
      p_organization_id,
      v_automation.id,
      v_from_id,
      v_edge->>'outcome',
      v_to_id,
      (v_edge->>'order')::integer
    );
  end loop;

  select *
  into v_automation
  from public.automations
  where id = v_automation.id;

  return jsonb_build_object(
    'automationId', v_automation.id,
    'draftRevision', v_automation.draft_revision,
    'deliveryMode', v_automation.delivery_mode
  );
end;
$$;

revoke all on function public.save_automation_draft(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, uuid) from public;
revoke all on function public.save_automation_draft(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, uuid) from anon;
revoke all on function public.save_automation_draft(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, uuid) from authenticated;
grant execute on function public.save_automation_draft(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, uuid) to service_role;
