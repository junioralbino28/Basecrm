-- =============================================================================
-- Funil Construtor — F3: outbox, attempts e dispatch compartilhado em simulação
-- =============================================================================

alter table public.organization_settings
  add column if not exists automation_live_enabled boolean not null default false;

alter table public.automation_versions
  add constraint automation_versions_id_tenant_unique
    unique (id, organization_id);
alter table public.automation_enrollments
  add constraint automation_enrollments_id_version_tenant_unique
    unique (id, automation_version_id, organization_id);

create table public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  enrollment_id uuid not null,
  version_id uuid not null,
  step_key uuid not null,
  job_type text not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_jobs_type_known
    check (job_type in ('send_message', 'delay', 'wait_for_event', 'create_task', 'move_stage', 'move_pipeline', 'condition')),
  constraint automation_jobs_status_known
    check (status in ('pending', 'leased', 'sent', 'failed', 'unknown', 'dead_letter', 'simulated')),
  constraint automation_jobs_idempotency_not_blank
    check (btrim(idempotency_key) <> ''),
  constraint automation_jobs_payload_object
    check (jsonb_typeof(payload) = 'object'),
  constraint automation_jobs_attempt_count_non_negative
    check (attempt_count >= 0),
  constraint automation_jobs_lease_consistent
    check (
      (status = 'leased') = (lease_owner is not null and lease_until is not null)
    ),
  constraint automation_jobs_enrollment_version_tenant_fk
    foreign key (enrollment_id, version_id, organization_id)
    references public.automation_enrollments(id, automation_version_id, organization_id),
  constraint automation_jobs_version_tenant_fk
    foreign key (version_id, organization_id)
    references public.automation_versions(id, organization_id),
  constraint automation_jobs_id_tenant_unique
    unique (id, organization_id)
);

create table public.automation_step_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  enrollment_id uuid not null,
  job_id uuid not null,
  version_id uuid not null,
  step_key uuid not null,
  attempt_number integer not null,
  status text not null default 'running',
  scheduled_for timestamptz not null,
  started_at timestamptz not null default now(),
  executed_at timestamptz,
  duration_ms integer,
  provider_message_id text,
  rendered_content text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint automation_step_attempts_number_positive check (attempt_number > 0),
  constraint automation_step_attempts_status_known
    check (status in ('running', 'sent', 'failed', 'unknown', 'simulated')),
  constraint automation_step_attempts_duration_non_negative
    check (duration_ms is null or duration_ms >= 0),
  constraint automation_step_attempts_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint automation_step_attempts_job_tenant_fk
    foreign key (job_id, organization_id)
    references public.automation_jobs(id, organization_id),
  constraint automation_step_attempts_enrollment_version_tenant_fk
    foreign key (enrollment_id, version_id, organization_id)
    references public.automation_enrollments(id, automation_version_id, organization_id),
  constraint automation_step_attempts_job_number_unique
    unique (job_id, attempt_number),
  constraint automation_step_attempts_id_tenant_unique
    unique (id, organization_id)
);

alter table public.conversation_messages
  add column channel_connection_id uuid,
  add column automation_job_id uuid unique,
  add column idempotency_key text,
  add column provider_message_id text,
  add column delivery_source text,
  add column delivery_status text,
  add column delivery_attempt text,
  add column delivery_error text,
  add constraint conversation_messages_delivery_source_known
    check (delivery_source is null or delivery_source in ('manual', 'automation')),
  add constraint conversation_messages_delivery_status_known
    check (delivery_status is null or delivery_status in ('pending', 'sent', 'failed', 'unknown', 'simulated')),
  add constraint conversation_messages_channel_tenant_fk
    foreign key (organization_id, channel_connection_id)
    references public.channel_connections(organization_id, id),
  add constraint conversation_messages_automation_job_tenant_fk
    foreign key (automation_job_id, organization_id)
    references public.automation_jobs(id, organization_id);

create unique index uq_conversation_messages_idempotency
  on public.conversation_messages(organization_id, idempotency_key)
  where idempotency_key is not null;
create unique index uq_conversation_messages_provider_id
  on public.conversation_messages(channel_connection_id, provider_message_id)
  where provider_message_id is not null;

create index idx_automation_jobs_claim
  on public.automation_jobs(status, available_at, created_at)
  where status in ('pending', 'leased');
create index idx_automation_jobs_enrollment
  on public.automation_jobs(enrollment_id, created_at);
create index idx_automation_jobs_version
  on public.automation_jobs(version_id);
create index idx_automation_step_attempts_job
  on public.automation_step_attempts(job_id, attempt_number desc);
create index idx_automation_step_attempts_enrollment
  on public.automation_step_attempts(enrollment_id, created_at desc);
create index idx_conversation_messages_channel_provider
  on public.conversation_messages(channel_connection_id, provider_message_id);

alter table public.automation_jobs enable row level security;
alter table public.automation_step_attempts enable row level security;

create policy "automation_jobs_select_by_tenant_operator"
  on public.automation_jobs
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );

create policy "automation_step_attempts_select_by_tenant_operator"
  on public.automation_step_attempts
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );

create trigger update_automation_jobs_updated_at
  before update on public.automation_jobs
  for each row execute function public.update_updated_at_column();

create or replace function public.guard_automation_job_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.enrollment_id is distinct from old.enrollment_id
    or new.version_id is distinct from old.version_id
    or new.step_key is distinct from old.step_key
    or new.idempotency_key is distinct from old.idempotency_key
  then
    raise exception using
      errcode = '23514',
      message = 'identidade do job é imutável';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_automation_job_identity() from public;
revoke all on function public.guard_automation_job_identity() from anon;
revoke all on function public.guard_automation_job_identity() from authenticated;

create trigger guard_automation_job_identity
  before update on public.automation_jobs
  for each row execute function public.guard_automation_job_identity();

create or replace function public.enqueue_automation_job(
  p_enrollment_id uuid,
  p_step_key uuid,
  p_job_type text,
  p_idempotency_key text,
  p_payload jsonb,
  p_available_at timestamptz default now()
)
returns public.automation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.automation_enrollments%rowtype;
  v_definition jsonb;
  v_step jsonb;
  v_job public.automation_jobs%rowtype;
begin
  select *
  into v_enrollment
  from public.automation_enrollments
  where id = p_enrollment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'inscrição não encontrada';
  end if;
  if v_enrollment.status not in ('active', 'waiting') then
    raise exception using errcode = '55000', message = 'inscrição não aceita novo job';
  end if;
  if v_enrollment.current_step_key <> p_step_key then
    raise exception using errcode = '22023', message = 'job não corresponde ao cursor da inscrição';
  end if;

  select definition
  into v_definition
  from public.automation_versions
  where id = v_enrollment.automation_version_id
    and organization_id = v_enrollment.organization_id;

  select step
  into v_step
  from jsonb_array_elements(v_definition->'steps') step
  where step->>'stepKey' = p_step_key::text;
  if not found or v_step->>'type' <> p_job_type then
    raise exception using errcode = '22023', message = 'step_key/job_type inválidos para a versão';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'payload do job deve ser objeto';
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
    v_enrollment.organization_id,
    v_enrollment.id,
    v_enrollment.automation_version_id,
    p_step_key,
    p_job_type,
    p_idempotency_key,
    p_payload,
    p_available_at
  )
  on conflict (idempotency_key) do nothing
  returning * into v_job;

  if v_job.id is null then
    select *
    into v_job
    from public.automation_jobs
    where idempotency_key = p_idempotency_key;

    if v_job.enrollment_id <> v_enrollment.id
      or v_job.version_id <> v_enrollment.automation_version_id
      or v_job.step_key <> p_step_key
      or v_job.job_type <> p_job_type
      or v_job.payload <> p_payload
    then
      raise exception using errcode = '23505', message = 'idempotency_key reutilizada com outro job';
    end if;
  end if;

  return v_job;
end;
$$;

revoke all on function public.enqueue_automation_job(uuid, uuid, text, text, jsonb, timestamptz) from public;
revoke all on function public.enqueue_automation_job(uuid, uuid, text, text, jsonb, timestamptz) from anon;
revoke all on function public.enqueue_automation_job(uuid, uuid, text, text, jsonb, timestamptz) from authenticated;
grant execute on function public.enqueue_automation_job(uuid, uuid, text, text, jsonb, timestamptz) to service_role;

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
  v_attempt_number integer;
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
  into v_enrollment
  from public.automation_enrollments
  where id = v_job.enrollment_id
    and organization_id = v_job.organization_id;
  if not found or v_enrollment.thread_id is null then
    raise exception using errcode = '55000', message = 'inscrição sem thread para dispatch';
  end if;

  select definition
  into v_definition
  from public.automation_versions
  where id = v_job.version_id
    and organization_id = v_job.organization_id;
  if v_definition->>'deliveryMode' <> 'simulation' then
    raise exception using errcode = '42501', message = 'F3 aceita somente delivery_mode simulation';
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
  if v_job.status not in ('pending', 'leased') then
    raise exception using errcode = '55000', message = 'job não pode ser preparado neste estado';
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

  v_attempt_number := v_job.attempt_count + 1;
  update public.automation_jobs
  set attempt_count = v_attempt_number,
      updated_at = v_now
  where id = v_job.id;

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
    v_attempt_number,
    'running',
    v_job.available_at,
    v_now,
    v_job.payload->>'content',
    jsonb_build_object('delivery_mode', 'simulation')
  );

  return query select v_job.id, v_message_id, true, 'pending'::text, null::text;
end;
$$;

revoke all on function public.prepare_automation_outbound(uuid) from public;
revoke all on function public.prepare_automation_outbound(uuid) from anon;
revoke all on function public.prepare_automation_outbound(uuid) from authenticated;
grant execute on function public.prepare_automation_outbound(uuid) to service_role;

create or replace function public.complete_automation_simulation(
  p_job_id uuid,
  p_message_id uuid
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

  if v_job.status = 'simulated' and v_message.delivery_status = 'simulated' then
    return query select v_job.id, v_message.id;
    return;
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

  update public.automation_step_attempts attempts
  set status = 'simulated',
      executed_at = v_now,
      duration_ms = greatest(
        0,
        floor(extract(epoch from (v_now - started_at)) * 1000)::integer
      ),
      provider_message_id = null,
      error = null,
      metadata = metadata || jsonb_build_object(
        'delivery_mode', 'simulation',
        'external_effect', false
      )
  where attempts.job_id = v_job.id
    and attempts.attempt_number = v_job.attempt_count
    and attempts.status = 'running';

  update public.automation_jobs
  set status = 'simulated',
      lease_owner = null,
      lease_until = null,
      last_error = null,
      updated_at = v_now
  where id = v_job.id;

  -- Atualiza resumo sem trocar status/routing/human lock: automação não é takeover.
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

  return query select v_job.id, v_message.id;
end;
$$;

revoke all on function public.complete_automation_simulation(uuid, uuid) from public;
revoke all on function public.complete_automation_simulation(uuid, uuid) from anon;
revoke all on function public.complete_automation_simulation(uuid, uuid) from authenticated;
grant execute on function public.complete_automation_simulation(uuid, uuid) to service_role;
