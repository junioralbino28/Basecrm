-- =============================================================================
-- Funil Construtor — F4: scheduler, claim/lease, retry e reconciliação
-- =============================================================================

create extension if not exists pg_cron;

create or replace function public.request_automation_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret
  into v_url
  from vault.decrypted_secrets
  where name = 'automation_tick_url'
  limit 1;

  select decrypted_secret
  into v_secret
  from vault.decrypted_secrets
  where name = 'automation_tick_secret'
  limit 1;

  if nullif(btrim(v_url), '') is null
    or nullif(btrim(v_secret), '') is null
  then
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('scheduled_at', now()),
    timeout_milliseconds := 5000
  )
  into v_request_id;

  return v_request_id;
exception when others then
  return null;
end;
$$;

revoke all on function public.request_automation_tick() from public;
revoke all on function public.request_automation_tick() from anon;
revoke all on function public.request_automation_tick() from authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'automation-tick-every-5-minutes'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'automation-tick-every-5-minutes',
    '*/5 * * * *',
    'select public.request_automation_tick();'
  );
end;
$$;

create or replace function public.automation_scheduler_health()
returns table (
  cron_installed boolean,
  pg_net_installed boolean,
  schedule text,
  active boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron'),
    exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net'),
    job.schedule,
    job.active
  from cron.job job
  where job.jobname = 'automation-tick-every-5-minutes'
  limit 1;
$$;

revoke all on function public.automation_scheduler_health() from public;
revoke all on function public.automation_scheduler_health() from anon;
revoke all on function public.automation_scheduler_health() from authenticated;
grant execute on function public.automation_scheduler_health() to service_role;

create or replace function public.render_automation_body(
  p_body text,
  p_context jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rendered text := p_body;
  v_match text[];
  v_value text;
  v_fallback text;
begin
  if p_body is null then
    return null;
  end if;
  if jsonb_typeof(p_context) <> 'object' then
    raise exception using errcode = '22023', message = 'contexto de renderização inválido';
  end if;

  for v_match in
    select regexp_matches(
      p_body,
      '(\{\{\s*([a-z][a-z0-9_.]*)\s*\|\s*default:\s*"((?:[^"\\]|\\.)*)"\s*\}\})',
      'g'
    )
  loop
    v_value := p_context #>> string_to_array(v_match[2], '.');
    v_fallback := replace(replace(v_match[3], '\"', '"'), '\\', '\');
    v_rendered := replace(
      v_rendered,
      v_match[1],
      coalesce(nullif(btrim(v_value), ''), v_fallback)
    );
  end loop;

  if v_rendered like '%{{%' or v_rendered like '%}}%' then
    raise exception using
      errcode = '22023',
      message = 'template publicado contém variável não renderizável';
  end if;

  return v_rendered;
end;
$$;

revoke all on function public.render_automation_body(text, jsonb) from public;
revoke all on function public.render_automation_body(text, jsonb) from anon;
revoke all on function public.render_automation_body(text, jsonb) from authenticated;

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

create or replace function public.claim_automation_jobs(
  p_worker_id text,
  p_batch_limit integer default 10,
  p_lease_seconds integer default 60,
  p_job_id uuid default null
)
returns setof public.automation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_job public.automation_jobs%rowtype;
  v_now timestamptz := now();
begin
  if nullif(btrim(p_worker_id), '') is null or length(p_worker_id) > 120 then
    raise exception using errcode = '22023', message = 'worker_id inválido';
  end if;
  if p_batch_limit < 1 or p_batch_limit > 50 then
    raise exception using errcode = '22023', message = 'batch_limit deve ficar entre 1 e 50';
  end if;
  if p_lease_seconds < 5 or p_lease_seconds > 900 then
    raise exception using errcode = '22023', message = 'lease_seconds deve ficar entre 5 e 900';
  end if;

  for v_candidate in
    select job.id, job.status, job.attempt_count
    from public.automation_jobs job
    where (p_job_id is null or job.id = p_job_id)
      and (
        (job.status = 'pending' and job.available_at <= v_now)
        or (job.status = 'leased' and job.lease_until <= v_now)
      )
    order by job.available_at, job.created_at, job.id
    for update skip locked
    limit p_batch_limit
  loop
    if v_candidate.status = 'leased' then
      update public.automation_step_attempts attempt
      set status = 'failed',
          executed_at = v_now,
          duration_ms = greatest(
            0,
            floor(extract(epoch from (v_now - attempt.started_at)) * 1000)::integer
          ),
          error = 'lease_expired',
          metadata = attempt.metadata || jsonb_build_object('reconciled', true)
      where attempt.job_id = v_candidate.id
        and attempt.attempt_number = v_candidate.attempt_count
        and attempt.status = 'running';
    end if;

    update public.automation_jobs job
    set status = 'leased',
        lease_owner = p_worker_id,
        lease_until = v_now + make_interval(secs => p_lease_seconds),
        attempt_count = job.attempt_count + 1,
        updated_at = v_now
    where job.id = v_candidate.id
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
      rendered_content,
      metadata
    )
    values (
      v_job.organization_id,
      v_job.enrollment_id,
      v_job.id,
      v_job.version_id,
      v_job.step_key,
      v_job.attempt_count,
      'running',
      v_job.available_at,
      v_now,
      v_job.payload->>'content',
      jsonb_build_object('lease_owner', p_worker_id)
    );

    return next v_job;
  end loop;
end;
$$;

revoke all on function public.claim_automation_jobs(text, integer, integer, uuid) from public;
revoke all on function public.claim_automation_jobs(text, integer, integer, uuid) from anon;
revoke all on function public.claim_automation_jobs(text, integer, integer, uuid) from authenticated;
grant execute on function public.claim_automation_jobs(text, integer, integer, uuid) to service_role;

create or replace function public.advance_automation_enrollment(
  p_enrollment_id uuid,
  p_step_key uuid,
  p_outcome text
)
returns public.automation_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.automation_enrollments%rowtype;
  v_definition jsonb;
  v_next_step_key uuid;
begin
  select *
  into v_enrollment
  from public.automation_enrollments
  where id = p_enrollment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'inscrição não encontrada';
  end if;
  if v_enrollment.current_step_key <> p_step_key then
    raise exception using errcode = '55000', message = 'cursor da inscrição já avançou';
  end if;

  select definition
  into v_definition
  from public.automation_versions
  where id = v_enrollment.automation_version_id
    and organization_id = v_enrollment.organization_id;

  select (edge->>'toStepKey')::uuid
  into v_next_step_key
  from jsonb_array_elements(v_definition->'edges') edge
  where edge->>'fromStepKey' = p_step_key::text
    and edge->>'outcome' = p_outcome
  order by (edge->>'order')::integer
  limit 1;

  if v_next_step_key is null then
    update public.automation_enrollments
    set status = 'done',
        paused_at = null,
        paused_by = null,
        updated_at = now()
    where id = v_enrollment.id
    returning * into v_enrollment;
  else
    update public.automation_enrollments
    set current_step_key = v_next_step_key,
        status = case when status = 'paused' then 'paused' else 'active' end,
        updated_at = now()
    where id = v_enrollment.id
    returning * into v_enrollment;
  end if;

  return v_enrollment;
end;
$$;

revoke all on function public.advance_automation_enrollment(uuid, uuid, text) from public;
revoke all on function public.advance_automation_enrollment(uuid, uuid, text) from anon;
revoke all on function public.advance_automation_enrollment(uuid, uuid, text) from authenticated;

create or replace function public.complete_automation_job(
  p_job_id uuid,
  p_worker_id text,
  p_attempt_count integer,
  p_outcome text,
  p_error text default null
)
returns public.automation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_now timestamptz := now();
  v_backoff_seconds integer;
begin
  if p_outcome not in ('sent', 'simulated', 'retryable_failure', 'failed', 'unknown') then
    raise exception using errcode = '22023', message = 'outcome de job inválido';
  end if;

  select *
  into v_job
  from public.automation_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'job não encontrado';
  end if;
  if v_job.status <> 'leased'
    or v_job.lease_owner <> p_worker_id
    or v_job.attempt_count <> p_attempt_count
  then
    raise exception using errcode = '55000', message = 'lease ou tentativa obsoleta';
  end if;

  update public.automation_step_attempts attempt
  set status = case
        when p_outcome = 'retryable_failure' then 'failed'
        else p_outcome
      end,
      executed_at = v_now,
      duration_ms = greatest(
        0,
        floor(extract(epoch from (v_now - attempt.started_at)) * 1000)::integer
      ),
      error = p_error
  where attempt.job_id = v_job.id
    and attempt.attempt_number = p_attempt_count
    and attempt.status = 'running';

  if p_outcome = 'retryable_failure' and v_job.attempt_count < 5 then
    v_backoff_seconds := least(
      300,
      (5 * power(2, greatest(0, v_job.attempt_count - 1)))::integer
    );
    update public.automation_jobs
    set status = 'pending',
        available_at = v_now + make_interval(secs => v_backoff_seconds),
        lease_owner = null,
        lease_until = null,
        last_error = p_error,
        updated_at = v_now
    where id = v_job.id
    returning * into v_job;
  elsif p_outcome in ('retryable_failure', 'failed') then
    update public.automation_jobs
    set status = 'dead_letter',
        lease_owner = null,
        lease_until = null,
        last_error = p_error,
        updated_at = v_now
    where id = v_job.id
    returning * into v_job;
  else
    update public.automation_jobs
    set status = p_outcome,
        lease_owner = null,
        lease_until = null,
        last_error = p_error,
        updated_at = v_now
    where id = v_job.id
    returning * into v_job;

    if p_outcome in ('sent', 'simulated') then
      perform public.advance_automation_enrollment(
        v_job.enrollment_id,
        v_job.step_key,
        'success'
      );
    end if;
  end if;

  return v_job;
end;
$$;

revoke all on function public.complete_automation_job(uuid, text, integer, text, text) from public;
revoke all on function public.complete_automation_job(uuid, text, integer, text, text) from anon;
revoke all on function public.complete_automation_job(uuid, text, integer, text, text) from authenticated;
grant execute on function public.complete_automation_job(uuid, text, integer, text, text) to service_role;

create or replace function public.prepare_automation_outbound(p_job_id uuid)
returns table (
  job_id uuid,
  message_id uuid,
  is_new boolean,
  delivery_status text,
  provider_message_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_enrollment public.automation_enrollments%rowtype;
  v_definition jsonb;
  v_message_id uuid;
  v_existing public.conversation_messages%rowtype;
  v_now timestamptz := now();
begin
  select *
  into v_job
  from public.automation_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'job não encontrado';
  end if;
  if v_job.job_type <> 'send_message' then
    raise exception using errcode = '22023', message = 'job não é dispatch de mensagem';
  end if;

  select *
  into v_existing
  from public.conversation_messages
  where automation_job_id = v_job.id;
  if found then
    return query select
      v_job.id,
      v_existing.id,
      false,
      coalesce(v_existing.delivery_status, 'unknown'),
      v_existing.provider_message_id;
    return;
  end if;

  if v_job.status <> 'leased'
    or v_job.lease_owner is null
    or v_job.lease_until <= v_now
  then
    raise exception using errcode = '55000', message = 'job precisa de lease ativo';
  end if;
  if not exists (
    select 1
    from public.automation_step_attempts attempt
    where attempt.job_id = v_job.id
      and attempt.attempt_number = v_job.attempt_count
      and attempt.status = 'running'
  ) then
    raise exception using errcode = '55000', message = 'tentativa do lease não encontrada';
  end if;

  select *
  into v_enrollment
  from public.automation_enrollments
  where id = v_job.enrollment_id
    and organization_id = v_job.organization_id;
  if not found or v_enrollment.thread_id is null then
    raise exception using errcode = '55000', message = 'inscrição sem thread para dispatch';
  end if;
  if v_enrollment.status <> 'active' then
    raise exception using errcode = '55000', message = 'inscrição pausada ou inativa';
  end if;

  select definition
  into v_definition
  from public.automation_versions
  where id = v_job.version_id
    and organization_id = v_job.organization_id;
  if v_definition->>'deliveryMode' <> 'simulation' then
    raise exception using errcode = '42501', message = 'F4 aceita somente delivery_mode simulation';
  end if;

  insert into public.conversation_messages (
    thread_id,
    organization_id,
    channel_connection_id,
    direction,
    message_type,
    author_name,
    content,
    metadata,
    automation_job_id,
    idempotency_key,
    delivery_source,
    delivery_status,
    sent_at,
    created_at
  )
  values (
    v_enrollment.thread_id,
    v_enrollment.organization_id,
    v_enrollment.channel_connection_id,
    'outbound',
    coalesce(nullif(v_job.payload->>'messageType', ''), 'text'),
    coalesce(nullif(v_job.payload->>'authorName', ''), 'Automação'),
    coalesce(nullif(v_job.payload->>'content', ''), '[mensagem automática]'),
    jsonb_build_object(
      'automation_job_id', v_job.id,
      'automation_version_id', v_job.version_id,
      'automation_step_key', v_job.step_key,
      'delivery_status', 'pending'
    ) || coalesce(v_job.payload->'metadata', '{}'::jsonb),
    v_job.id,
    v_job.idempotency_key,
    'automation',
    'pending',
    v_now,
    v_now
  )
  returning id into v_message_id;

  return query select v_job.id, v_message_id, true, 'pending'::text, null::text;
end;
$$;

drop function public.complete_automation_simulation(uuid, uuid);

create or replace function public.complete_automation_simulation(
  p_job_id uuid,
  p_message_id uuid,
  p_lease_owner text,
  p_attempt_count integer
)
returns table (job_id uuid, message_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_message public.conversation_messages%rowtype;
  v_definition jsonb;
  v_now timestamptz := now();
begin
  select *
  into v_job
  from public.automation_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'job não encontrado';
  end if;

  select definition
  into v_definition
  from public.automation_versions
  where id = v_job.version_id
    and organization_id = v_job.organization_id;
  if v_definition->>'deliveryMode' <> 'simulation' then
    raise exception using errcode = '42501', message = 'safe mode bloqueou efeito não simulado';
  end if;
  if v_job.status <> 'leased'
    or v_job.lease_owner <> p_lease_owner
    or v_job.attempt_count <> p_attempt_count
  then
    raise exception using errcode = '55000', message = 'lease ou tentativa obsoleta';
  end if;

  select *
  into v_message
  from public.conversation_messages
  where id = p_message_id
    and automation_job_id = v_job.id
    and organization_id = v_job.organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'mensagem pending não encontrada';
  end if;
  if v_message.delivery_status <> 'pending'
    or v_message.provider_message_id is not null
  then
    raise exception using errcode = '55000', message = 'mensagem não está pending sem provider ID';
  end if;

  update public.conversation_messages
  set delivery_status = 'simulated',
      provider_message_id = null,
      delivery_attempt = 'simulation',
      delivery_error = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'delivery_status', 'simulated',
        'delivery_mode', 'simulation',
        'external_effect', false,
        'provider_message_id', null
      )
  where id = v_message.id;

  update public.automation_step_attempts attempt
  set status = 'simulated',
      executed_at = v_now,
      duration_ms = greatest(
        0,
        floor(extract(epoch from (v_now - attempt.started_at)) * 1000)::integer
      ),
      provider_message_id = null,
      error = null,
      metadata = attempt.metadata || jsonb_build_object(
        'delivery_mode', 'simulation',
        'external_effect', false
      )
  where attempt.job_id = v_job.id
    and attempt.attempt_number = p_attempt_count
    and attempt.status = 'running';

  update public.automation_jobs
  set status = 'simulated',
      lease_owner = null,
      lease_until = null,
      last_error = null,
      updated_at = v_now
  where id = v_job.id
    and status = 'leased'
    and lease_owner = p_lease_owner
    and attempt_count = p_attempt_count;

  if not found then
    raise exception using errcode = '55000', message = 'compare-and-set da simulação falhou';
  end if;

  update public.conversation_threads
  set last_message_at = v_now,
      updated_at = v_now,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'lastDirection', 'outbound',
        'lastMessagePreview', left(v_message.content, 160),
        'lastMessageType', v_message.message_type,
        'lastMessageSentAt', v_now,
        'lastMessageAuthorName', v_message.author_name
      )
  where id = v_message.thread_id
    and organization_id = v_job.organization_id;

  perform public.advance_automation_enrollment(
    v_job.enrollment_id,
    v_job.step_key,
    'success'
  );

  return query select v_job.id, v_message.id;
end;
$$;

revoke all on function public.complete_automation_simulation(uuid, uuid, text, integer) from public;
revoke all on function public.complete_automation_simulation(uuid, uuid, text, integer) from anon;
revoke all on function public.complete_automation_simulation(uuid, uuid, text, integer) from authenticated;
grant execute on function public.complete_automation_simulation(uuid, uuid, text, integer) to service_role;
