-- =============================================================================
-- C2B — resposta inbound sem wait pausa o follow-up da conversa
-- =============================================================================

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
    perform public.pause_automation_enrollments_for_thread(
      p_thread_id,
      null,
      'patient_inbound'
    );

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

revoke all on function public.resolve_automation_wait_from_inbox(
  uuid, text, uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.resolve_automation_wait_from_inbox(
  uuid, text, uuid, uuid, text, timestamptz
) to service_role;
