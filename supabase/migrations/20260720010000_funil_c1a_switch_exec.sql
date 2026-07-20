-- =============================================================================
-- Funil Construtor C1A — avaliação e execução idempotente do passo switch
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
    deal.board_id as deal_board_id
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

  select step.value
  into v_step
  from jsonb_array_elements(v_context.definition->'steps') step(value)
  where step.value->>'stepKey' = p_step_key::text;

  if v_step is null or v_step->>'type' <> 'switch' then
    raise exception using errcode = '22023', message = 'passo não é um switch publicado';
  end if;

  v_field := v_step#>>'{config,field}';
  if v_field not in ('deal.tags', 'contact.phone', 'deal.stage_id', 'deal.board_id') then
    raise exception using errcode = '22023', message = 'campo do switch não suportado';
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

revoke all on function public.evaluate_automation_switch(uuid, uuid) from public;
revoke all on function public.evaluate_automation_switch(uuid, uuid) from anon;
revoke all on function public.evaluate_automation_switch(uuid, uuid) from authenticated;
grant execute on function public.evaluate_automation_switch(uuid, uuid) to service_role;

create or replace function public.execute_automation_switch(
  p_enrollment_id uuid,
  p_step_key uuid
)
returns table (
  job_id uuid,
  enrollment_id uuid,
  step_key uuid,
  is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.automation_enrollments%rowtype;
  v_existing public.automation_jobs%rowtype;
  v_job public.automation_jobs%rowtype;
  v_definition jsonb;
  v_step jsonb;
  v_outcome text;
  v_label text;
  v_idempotency_key text;
  v_now timestamptz := now();
begin
  select *
  into v_existing
  from public.automation_jobs
  where automation_jobs.enrollment_id = p_enrollment_id
    and automation_jobs.step_key = p_step_key
    and automation_jobs.job_type = 'switch'
  order by automation_jobs.created_at
  limit 1;

  if found then
    if v_existing.enrollment_id <> p_enrollment_id
      or v_existing.step_key <> p_step_key
      or v_existing.job_type <> 'switch'
    then
      raise exception using errcode = '23505', message = 'idempotency_key colidiu com outro job';
    end if;
    return query select
      v_existing.id,
      v_existing.enrollment_id,
      v_existing.step_key,
      false;
    return;
  end if;

  select *
  into v_enrollment
  from public.automation_enrollments
  where id = p_enrollment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'inscrição não encontrada';
  end if;

  v_idempotency_key := format(
    'automation:%s:version:%s:step:%s',
    v_enrollment.id,
    v_enrollment.automation_version_id,
    p_step_key
  );

  select *
  into v_existing
  from public.automation_jobs
  where idempotency_key = v_idempotency_key;
  if found then
    return query select
      v_existing.id,
      v_existing.enrollment_id,
      v_existing.step_key,
      false;
    return;
  end if;

  if v_enrollment.status <> 'active' or v_enrollment.current_step_key <> p_step_key then
    raise exception using errcode = '55000', message = 'switch não corresponde ao cursor ativo';
  end if;

  select definition
  into v_definition
  from public.automation_versions
  where id = v_enrollment.automation_version_id
    and organization_id = v_enrollment.organization_id;

  select step.value
  into v_step
  from jsonb_array_elements(v_definition->'steps') step(value)
  where step.value->>'stepKey' = p_step_key::text;
  if v_step is null or v_step->>'type' <> 'switch' then
    raise exception using errcode = '22023', message = 'passo não é um switch publicado';
  end if;

  v_outcome := public.evaluate_automation_switch(p_enrollment_id, p_step_key);
  if not exists (
    select 1
    from jsonb_array_elements(v_definition->'edges') edge(value)
    where edge.value->>'fromStepKey' = p_step_key::text
      and edge.value->>'outcome' = v_outcome
  ) then
    raise exception using errcode = '22023', message = 'switch produziu outcome sem aresta';
  end if;

  if v_outcome = 'otherwise' then
    v_label := v_step#>>'{config,fallbackLabel}';
  else
    select switch_case.value->>'label'
    into v_label
    from jsonb_array_elements(v_step#>'{config,cases}') switch_case(value)
    where switch_case.value->>'caseId' = substring(v_outcome from 6);
  end if;

  insert into public.automation_jobs (
    organization_id,
    enrollment_id,
    version_id,
    step_key,
    job_type,
    idempotency_key,
    payload,
    status,
    available_at,
    attempt_count,
    created_at,
    updated_at
  )
  values (
    v_enrollment.organization_id,
    v_enrollment.id,
    v_enrollment.automation_version_id,
    p_step_key,
    'switch',
    v_idempotency_key,
    jsonb_build_object(
      'config', v_step->'config',
      'metadata', jsonb_build_object(
        'automation_version_id', v_enrollment.automation_version_id,
        'automation_step_key', p_step_key,
        'switchOutcome', v_outcome,
        'switchLabel', v_label,
        'external_effect', false
      )
    ),
    'simulated',
    v_now,
    1,
    v_now,
    v_now
  )
  returning * into v_job;

  insert into public.automation_step_attempts (
    organization_id,
    enrollment_id,
    job_id,
    version_id,
    step_key,
    attempt_number,
    status,
    scheduled_for,
    started_at,
    executed_at,
    duration_ms,
    metadata
  )
  values (
    v_job.organization_id,
    v_job.enrollment_id,
    v_job.id,
    v_job.version_id,
    v_job.step_key,
    1,
    'simulated',
    v_now,
    v_now,
    v_now,
    0,
    jsonb_build_object(
      'switch_outcome', v_outcome,
      'switch_label', v_label,
      'external_effect', false
    )
  );

  perform public.advance_automation_enrollment(
    v_enrollment.id,
    p_step_key,
    v_outcome
  );

  return query select v_job.id, v_job.enrollment_id, v_job.step_key, true;
end;
$$;

revoke all on function public.execute_automation_switch(uuid, uuid) from public;
revoke all on function public.execute_automation_switch(uuid, uuid) from anon;
revoke all on function public.execute_automation_switch(uuid, uuid) from authenticated;
grant execute on function public.execute_automation_switch(uuid, uuid) to service_role;

create or replace function public.materialize_automation_jobs(
  p_batch_limit integer default 50
)
returns table (
  job_id uuid,
  enrollment_id uuid,
  step_key uuid,
  is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_job public.automation_jobs%rowtype;
  v_switch_execution record;
  v_idempotency_key text;
  v_context jsonb;
  v_payload jsonb;
  v_available_at timestamptz;
  v_amount integer;
  v_unit text;
begin
  if p_batch_limit < 1 or p_batch_limit > 200 then
    raise exception using errcode = '22023', message = 'batch_limit deve ficar entre 1 e 200';
  end if;

  for v_candidate in
    select
      enrollment.id as enrollment_id,
      enrollment.organization_id,
      enrollment.automation_version_id as version_id,
      enrollment.current_step_key as step_key,
      definition.definition,
      step.value as step,
      contact.name as contact_name,
      contact.phone as contact_phone,
      deal.title as deal_title,
      deal.value as deal_value,
      organization.name as organization_name,
      responsible.name as responsible_name
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
    join public.organizations organization
      on organization.id = enrollment.organization_id
    left join public.profiles responsible
      on responsible.id = deal.owner_id
     and responsible.organization_id = enrollment.organization_id
    cross join lateral jsonb_array_elements(definition.definition->'steps') step(value)
    where enrollment.status = 'active'
      and step.value->>'stepKey' = enrollment.current_step_key::text
      and not exists (
        select 1
        from public.automation_jobs existing_job
        where existing_job.enrollment_id = enrollment.id
          and existing_job.version_id = enrollment.automation_version_id
          and existing_job.step_key = enrollment.current_step_key
      )
    order by enrollment.entered_at, enrollment.id
    for update of enrollment skip locked
    limit p_batch_limit
  loop
    if v_candidate.step->>'type' = 'switch' then
      select *
      into v_switch_execution
      from public.execute_automation_switch(
        v_candidate.enrollment_id,
        v_candidate.step_key
      );

      job_id := v_switch_execution.job_id;
      enrollment_id := v_switch_execution.enrollment_id;
      step_key := v_switch_execution.step_key;
      is_new := v_switch_execution.is_new;
      return next;
      continue;
    end if;

    v_idempotency_key := format(
      'automation:%s:version:%s:step:%s',
      v_candidate.enrollment_id,
      v_candidate.version_id,
      v_candidate.step_key
    );
    v_context := jsonb_build_object(
      'contato', jsonb_build_object(
        'nome', v_candidate.contact_name,
        'primeiro_nome', split_part(v_candidate.contact_name, ' ', 1),
        'telefone', v_candidate.contact_phone
      ),
      'negocio', jsonb_build_object(
        'titulo', v_candidate.deal_title,
        'valor', v_candidate.deal_value
      ),
      'responsavel', jsonb_build_object(
        'nome', v_candidate.responsible_name
      ),
      'organizacao', jsonb_build_object(
        'nome', v_candidate.organization_name
      )
    );

    if v_candidate.step->>'type' = 'send_message' then
      v_payload := jsonb_build_object(
        'content', public.render_automation_body(
          v_candidate.step#>>'{config,body}',
          v_context
        ),
        'messageType', coalesce(v_candidate.step#>>'{config,messageKind}', 'text'),
        'authorName', 'Automação',
        'metadata', jsonb_build_object(
          'automation_version_id', v_candidate.version_id,
          'automation_step_key', v_candidate.step_key
        )
      );
    else
      v_payload := jsonb_build_object(
        'config', coalesce(v_candidate.step->'config', '{}'::jsonb),
        'metadata', jsonb_build_object(
          'automation_version_id', v_candidate.version_id,
          'automation_step_key', v_candidate.step_key
        )
      );
    end if;

    v_available_at := now();
    if v_candidate.step->>'type' = 'delay' then
      v_amount := (v_candidate.step#>>'{config,amount}')::integer;
      v_unit := v_candidate.step#>>'{config,unit}';
      v_available_at := case v_unit
        when 'minutes' then now() + make_interval(mins => v_amount)
        when 'hours' then now() + make_interval(hours => v_amount)
        when 'days' then now() + make_interval(days => v_amount)
        else null
      end;
      if v_available_at is null then
        raise exception using errcode = '22023', message = 'unidade de delay inválida';
      end if;
    end if;

    insert into public.automation_jobs (
      organization_id,
      enrollment_id,
      version_id,
      step_key,
      job_type,
      idempotency_key,
      payload,
      available_at
    )
    values (
      v_candidate.organization_id,
      v_candidate.enrollment_id,
      v_candidate.version_id,
      v_candidate.step_key,
      v_candidate.step->>'type',
      v_idempotency_key,
      v_payload,
      v_available_at
    )
    on conflict (idempotency_key) do nothing
    returning * into v_job;

    if v_job.id is not null then
      job_id := v_job.id;
      enrollment_id := v_job.enrollment_id;
      step_key := v_job.step_key;
      is_new := true;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.materialize_automation_jobs(integer) from public;
revoke all on function public.materialize_automation_jobs(integer) from anon;
revoke all on function public.materialize_automation_jobs(integer) from authenticated;
grant execute on function public.materialize_automation_jobs(integer) to service_role;
