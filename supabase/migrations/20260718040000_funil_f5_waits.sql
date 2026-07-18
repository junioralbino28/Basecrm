-- =============================================================================
-- Funil Construtor — F5: wait_for_event, inbox idempotente e takeover humano
-- =============================================================================

alter table public.automation_enrollments
  add column paused_from_status text,
  add column pause_reason text,
  add constraint automation_enrollments_paused_origin_known
    check (paused_from_status is null or paused_from_status in ('active', 'waiting')),
  add constraint automation_enrollments_paused_metadata_consistent
    check (
      (status = 'paused') = (
        paused_from_status is not null
        and pause_reason is not null
      )
    );

create unique index if not exists uq_conversation_messages_org_id
  on public.conversation_messages(organization_id, id);

create table public.automation_waits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  enrollment_id uuid not null,
  version_id uuid not null,
  step_key uuid not null,
  thread_id uuid not null,
  channel_connection_id uuid not null,
  outbound_provider_message_id text,
  status text not null default 'pending',
  resolution_source text,
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_by_message_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint automation_waits_status_known
    check (status in ('pending', 'resolved', 'expired')),
  constraint automation_waits_resolution_source_known
    check (
      resolution_source is null
      or resolution_source in ('quote', 'conversation_fallback', 'timeout')
    ),
  constraint automation_waits_expiry_after_open
    check (expires_at > opened_at),
  constraint automation_waits_resolution_consistent
    check (
      (status = 'pending' and resolved_at is null and resolved_by_message_id is null and resolution_source is null)
      or (
        status = 'resolved'
        and resolved_at is not null
        and resolved_by_message_id is not null
        and resolution_source in ('quote', 'conversation_fallback')
      )
      or (
        status = 'expired'
        and resolved_at is not null
        and resolved_by_message_id is null
        and resolution_source = 'timeout'
      )
    ),
  constraint automation_waits_enrollment_version_tenant_fk
    foreign key (enrollment_id, version_id, organization_id)
    references public.automation_enrollments(id, automation_version_id, organization_id),
  constraint automation_waits_thread_tenant_fk
    foreign key (organization_id, thread_id)
    references public.conversation_threads(organization_id, id),
  constraint automation_waits_channel_tenant_fk
    foreign key (organization_id, channel_connection_id)
    references public.channel_connections(organization_id, id),
  constraint automation_waits_message_tenant_fk
    foreign key (organization_id, resolved_by_message_id)
    references public.conversation_messages(organization_id, id),
  constraint automation_waits_id_tenant_unique
    unique (id, organization_id)
);

create unique index uq_automation_waits_one_pending_thread
  on public.automation_waits(organization_id, thread_id)
  where status = 'pending';
create index idx_automation_waits_quote
  on public.automation_waits(channel_connection_id, outbound_provider_message_id)
  where status = 'pending' and outbound_provider_message_id is not null;
create index idx_automation_waits_expiry
  on public.automation_waits(expires_at, opened_at)
  where status = 'pending';
create index idx_automation_waits_enrollment
  on public.automation_waits(enrollment_id, opened_at desc);

create table public.automation_inbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  channel_connection_id uuid not null,
  provider_message_id text not null,
  thread_id uuid not null,
  message_id uuid not null,
  quoted_provider_message_id text,
  matched_wait_id uuid,
  resolution_source text,
  result_status text not null default 'received',
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint automation_inbox_events_provider_id_not_blank
    check (btrim(provider_message_id) <> ''),
  constraint automation_inbox_events_result_known
    check (result_status in ('received', 'resolved', 'unmatched')),
  constraint automation_inbox_events_resolution_source_known
    check (
      resolution_source is null
      or resolution_source in ('quote', 'conversation_fallback')
    ),
  constraint automation_inbox_events_channel_tenant_fk
    foreign key (organization_id, channel_connection_id)
    references public.channel_connections(organization_id, id),
  constraint automation_inbox_events_thread_tenant_fk
    foreign key (organization_id, thread_id)
    references public.conversation_threads(organization_id, id),
  constraint automation_inbox_events_message_tenant_fk
    foreign key (organization_id, message_id)
    references public.conversation_messages(organization_id, id),
  constraint automation_inbox_events_wait_tenant_fk
    foreign key (matched_wait_id, organization_id)
    references public.automation_waits(id, organization_id),
  constraint automation_inbox_events_provider_unique
    unique (channel_connection_id, provider_message_id)
);

create index idx_automation_inbox_events_thread_received
  on public.automation_inbox_events(thread_id, received_at desc);

alter table public.automation_waits enable row level security;
alter table public.automation_inbox_events enable row level security;

create policy "automation_waits_select_by_tenant_operator"
  on public.automation_waits
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );

create policy "automation_inbox_events_select_by_tenant_operator"
  on public.automation_inbox_events
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );

create or replace function public.open_automation_wait(
  p_enrollment_id uuid,
  p_step_key uuid,
  p_expires_at timestamptz,
  p_outbound_provider_message_id text default null
)
returns public.automation_waits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.automation_enrollments%rowtype;
  v_definition jsonb;
  v_wait public.automation_waits%rowtype;
begin
  select *
  into v_enrollment
  from public.automation_enrollments
  where id = p_enrollment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'inscrição não encontrada';
  end if;

  select *
  into v_wait
  from public.automation_waits
  where organization_id = v_enrollment.organization_id
    and thread_id = v_enrollment.thread_id
    and status = 'pending';
  if found then
    if v_wait.enrollment_id = v_enrollment.id
      and v_wait.step_key = p_step_key
      and v_wait.outbound_provider_message_id is not distinct from p_outbound_provider_message_id
    then
      return v_wait;
    end if;
    raise exception using
      errcode = '23505',
      message = 'conversa já possui espera pendente';
  end if;

  if v_enrollment.status <> 'active'
    or v_enrollment.current_step_key <> p_step_key
    or v_enrollment.thread_id is null
    or v_enrollment.channel_connection_id is null
  then
    raise exception using errcode = '55000', message = 'inscrição não pode abrir esta espera';
  end if;
  if p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'expiração precisa estar no futuro';
  end if;

  select definition
  into v_definition
  from public.automation_versions
  where id = v_enrollment.automation_version_id
    and organization_id = v_enrollment.organization_id;
  if not exists (
    select 1
    from jsonb_array_elements(v_definition->'steps') step
    where step->>'stepKey' = p_step_key::text
      and step->>'type' = 'wait_for_event'
  ) then
    raise exception using errcode = '22023', message = 'step não é wait_for_event';
  end if;

  insert into public.automation_waits (
    organization_id,
    enrollment_id,
    version_id,
    step_key,
    thread_id,
    channel_connection_id,
    outbound_provider_message_id,
    expires_at
  )
  values (
    v_enrollment.organization_id,
    v_enrollment.id,
    v_enrollment.automation_version_id,
    p_step_key,
    v_enrollment.thread_id,
    v_enrollment.channel_connection_id,
    nullif(btrim(p_outbound_provider_message_id), ''),
    p_expires_at
  )
  returning * into v_wait;

  update public.automation_enrollments
  set status = 'waiting',
      updated_at = now()
  where id = v_enrollment.id;

  return v_wait;
end;
$$;

revoke all on function public.open_automation_wait(uuid, uuid, timestamptz, text) from public;
revoke all on function public.open_automation_wait(uuid, uuid, timestamptz, text) from anon;
revoke all on function public.open_automation_wait(uuid, uuid, timestamptz, text) from authenticated;
grant execute on function public.open_automation_wait(uuid, uuid, timestamptz, text) to service_role;

create or replace function public.resolve_automation_wait_from_inbox(
  p_channel_connection_id uuid,
  p_provider_message_id text,
  p_thread_id uuid,
  p_message_id uuid,
  p_quoted_provider_message_id text,
  p_received_at timestamptz
)
returns table (
  event_id uuid,
  wait_id uuid,
  resolution text,
  duplicate boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_message_created_at timestamptz;
  v_event public.automation_inbox_events%rowtype;
  v_wait public.automation_waits%rowtype;
  v_resolution text;
begin
  if nullif(btrim(p_provider_message_id), '') is null then
    raise exception using errcode = '22023', message = 'provider_message_id obrigatório';
  end if;

  select channel.organization_id, message.created_at
  into v_organization_id, v_message_created_at
  from public.channel_connections channel
  join public.conversation_threads thread
    on thread.organization_id = channel.organization_id
   and thread.channel_connection_id = channel.id
   and thread.id = p_thread_id
  join public.conversation_messages message
    on message.organization_id = thread.organization_id
   and message.thread_id = thread.id
   and message.id = p_message_id
   and message.direction = 'inbound'
  where channel.id = p_channel_connection_id;
  if not found then
    raise exception using errcode = '23503', message = 'inbox não pertence à conversa/canal';
  end if;

  insert into public.automation_inbox_events (
    organization_id,
    channel_connection_id,
    provider_message_id,
    thread_id,
    message_id,
    quoted_provider_message_id,
    received_at
  )
  values (
    v_organization_id,
    p_channel_connection_id,
    p_provider_message_id,
    p_thread_id,
    p_message_id,
    nullif(btrim(p_quoted_provider_message_id), ''),
    p_received_at
  )
  on conflict (channel_connection_id, provider_message_id) do nothing
  returning * into v_event;

  if v_event.id is null then
    select *
    into v_event
    from public.automation_inbox_events inbox
    where inbox.channel_connection_id = p_channel_connection_id
      and inbox.provider_message_id = p_provider_message_id;

    if v_event.organization_id <> v_organization_id
      or v_event.thread_id <> p_thread_id
      or v_event.message_id <> p_message_id
    then
      raise exception using errcode = '23505', message = 'evento inbox reutilizado com outro conteúdo';
    end if;

    return query select
      v_event.id,
      v_event.matched_wait_id,
      v_event.resolution_source,
      true;
    return;
  end if;

  if nullif(btrim(p_quoted_provider_message_id), '') is not null then
    select *
    into v_wait
    from public.automation_waits candidate
    where candidate.organization_id = v_organization_id
      and candidate.thread_id = p_thread_id
      and candidate.channel_connection_id = p_channel_connection_id
      and candidate.outbound_provider_message_id = p_quoted_provider_message_id
      and candidate.status = 'pending'
      and candidate.opened_at <= v_message_created_at
    order by candidate.opened_at
    limit 1;
    if found then
      v_resolution := 'quote';
    end if;
  end if;

  if v_wait.id is null then
    select *
    into v_wait
    from public.automation_waits candidate
    where candidate.organization_id = v_organization_id
      and candidate.thread_id = p_thread_id
      and candidate.channel_connection_id = p_channel_connection_id
      and candidate.status = 'pending'
      and candidate.opened_at <= v_message_created_at
    order by candidate.opened_at
    limit 1;
    if found then
      v_resolution := 'conversation_fallback';
    end if;
  end if;

  if v_wait.id is not null then
    update public.automation_waits candidate
    set status = 'resolved',
        resolution_source = v_resolution,
        resolved_by_message_id = p_message_id,
        resolved_at = p_received_at
    where candidate.id = v_wait.id
      and candidate.status = 'pending'
    returning * into v_wait;
  end if;

  if v_wait.id is null or v_wait.status <> 'resolved' then
    update public.automation_inbox_events
    set result_status = 'unmatched'
    where id = v_event.id
    returning * into v_event;
  else
    perform public.advance_automation_enrollment(
      v_wait.enrollment_id,
      v_wait.step_key,
      'answered'
    );

    update public.automation_inbox_events
    set matched_wait_id = v_wait.id,
        resolution_source = v_resolution,
        result_status = 'resolved'
    where id = v_event.id
    returning * into v_event;
  end if;

  return query select
    v_event.id,
    v_event.matched_wait_id,
    v_event.resolution_source,
    false;
end;
$$;

revoke all on function public.resolve_automation_wait_from_inbox(uuid, text, uuid, uuid, text, timestamptz) from public;
revoke all on function public.resolve_automation_wait_from_inbox(uuid, text, uuid, uuid, text, timestamptz) from anon;
revoke all on function public.resolve_automation_wait_from_inbox(uuid, text, uuid, uuid, text, timestamptz) from authenticated;
grant execute on function public.resolve_automation_wait_from_inbox(uuid, text, uuid, uuid, text, timestamptz) to service_role;

create or replace function public.expire_due_automation_waits(
  p_batch_limit integer default 50
)
returns setof public.automation_waits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_wait public.automation_waits%rowtype;
begin
  if p_batch_limit < 1 or p_batch_limit > 200 then
    raise exception using errcode = '22023', message = 'batch_limit deve ficar entre 1 e 200';
  end if;

  for v_candidate in
    select candidate.id
    from public.automation_waits candidate
    where candidate.status = 'pending'
      and candidate.expires_at <= now()
    order by candidate.expires_at, candidate.opened_at, candidate.id
    for update skip locked
    limit p_batch_limit
  loop
    update public.automation_waits candidate
    set status = 'expired',
        resolution_source = 'timeout',
        resolved_at = now()
    where candidate.id = v_candidate.id
      and candidate.status = 'pending'
    returning * into v_wait;

    if v_wait.id is not null then
      perform public.advance_automation_enrollment(
        v_wait.enrollment_id,
        v_wait.step_key,
        'timeout'
      );
      return next v_wait;
    end if;
  end loop;
end;
$$;

revoke all on function public.expire_due_automation_waits(integer) from public;
revoke all on function public.expire_due_automation_waits(integer) from anon;
revoke all on function public.expire_due_automation_waits(integer) from authenticated;
grant execute on function public.expire_due_automation_waits(integer) to service_role;

create or replace function public.pause_automation_enrollments_for_thread(
  p_thread_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns setof public.automation_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  if nullif(btrim(p_reason), '') is null or length(p_reason) > 240 then
    raise exception using errcode = '22023', message = 'motivo de pausa inválido';
  end if;

  select organization_id
  into v_organization_id
  from public.conversation_threads
  where id = p_thread_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'conversa não encontrada';
  end if;

  if p_actor_id is not null and not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_id
      and profile.organization_id = v_organization_id
  ) then
    raise exception using errcode = '23503', message = 'ator não pertence ao tenant';
  end if;

  return query
  update public.automation_enrollments enrollment
  set paused_from_status = enrollment.status,
      pause_reason = btrim(p_reason),
      status = 'paused',
      paused_at = now(),
      paused_by = p_actor_id,
      updated_at = now()
  where enrollment.organization_id = v_organization_id
    and enrollment.thread_id = p_thread_id
    and enrollment.status in ('active', 'waiting')
  returning enrollment.*;
end;
$$;

revoke all on function public.pause_automation_enrollments_for_thread(uuid, uuid, text) from public;
revoke all on function public.pause_automation_enrollments_for_thread(uuid, uuid, text) from anon;
revoke all on function public.pause_automation_enrollments_for_thread(uuid, uuid, text) from authenticated;
grant execute on function public.pause_automation_enrollments_for_thread(uuid, uuid, text) to service_role;

-- Imutabilidade impede mutação direta, mas não pode bloquear a exclusão em
-- cascata do tenant/rascunho pai (necessária também para descarte de fixtures).
create or replace function public.prevent_automation_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    or (
      tg_op = 'DELETE'
      and exists (
        select 1
        from public.automations automation
        where automation.id = old.automation_id
      )
    )
  then
    raise exception using
      errcode = '55000',
      message = 'versões publicadas são imutáveis';
  end if;

  return old;
end;
$$;
