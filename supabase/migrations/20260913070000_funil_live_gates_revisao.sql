-- Entrega LIVE — gates adicionais depois do parecer do Codex (OPINIAO-LIVE.md, 13/09).
--
-- Substitui cinco funções da migration 20260913040000 com o MESMO cabeçalho de segurança
-- (DEFINER, search_path vazio, EXECUTE só do service_role). O que muda em cada uma:
--
--   B1/B4  prepare_automation_outbound: envio real exige canal `connected` E com `webhookSecret`
--          configurado (quarto gate do ADR: "canal ativo e aprovado"; e o webhook legado sem
--          segredo aceita qualquer POST, então um canal assim não serve para automação).
--   B6     execute_automation_create_task / execute_automation_move_deal: travam a inscrição
--          (`for update`) e exigem `status = 'active'` e cursor no passo do job ANTES de qualquer
--          efeito; pausa concorrente entre a leitura do executor e a RPC deixa de criar tarefa,
--          mover negócio ou avançar o cursor.
--   I1     fail_automation_job_and_pause: pausa SÓ a inscrição do job (passo sem executor,
--          configuração inválida, inscrição inativa). Pausa da conversa inteira fica para inbound,
--          opt-out e entrega ambígua, onde a conversa toda é o problema.
--   S1     record_automation_opt_out: a conversa informada precisa pertencer à organização e ao
--          contato antes de pausar.

-- ---------------------------------------------------------------------------------------
-- prepare_automation_outbound (cabeçalho e corpo idênticos à 20260913040000, + gate de canal)
-- ---------------------------------------------------------------------------------------
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
  v_mode text;
  v_channel_status text;
  v_channel_config jsonb;
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
  v_mode := v_definition->>'deliveryMode';
  if v_mode = 'live' then
    if not exists (
      select 1
      from public.organization_settings settings
      where settings.organization_id = v_job.organization_id
        and settings.automation_live_enabled = true
    ) then
      raise exception using errcode = '42501', message = 'envio real desligado para esta organização';
    end if;
    if exists (
      select 1
      from public.contacts contact
      where contact.id = v_enrollment.contact_id
        and contact.organization_id = v_enrollment.organization_id
        and contact.automation_opt_out_at is not null
    ) then
      raise exception using errcode = '42501', message = 'contato pediu para não receber automações';
    end if;

    -- Canal ativo e com webhook autenticado (parecer do Codex B1/B4; quarto gate do ADR).
    select channel.status, channel.config
    into v_channel_status, v_channel_config
    from public.channel_connections channel
    where channel.id = v_enrollment.channel_connection_id
      and channel.organization_id = v_enrollment.organization_id;
    if not found or v_channel_status is distinct from 'connected' then
      raise exception using errcode = '42501',
        message = 'canal do WhatsApp não está conectado (' || coalesce(v_channel_status, 'ausente') || ')';
    end if;
    if nullif(btrim(coalesce(v_channel_config->>'webhookSecret', '')), '') is null then
      raise exception using errcode = '42501',
        message = 'canal sem segredo de webhook configurado; envio real exige webhook autenticado';
    end if;
  elsif v_mode is distinct from 'simulation' then
    raise exception using errcode = '42501',
      message = 'modo de entrega sem executor: ' || coalesce(v_mode, 'nulo');
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

revoke all on function public.prepare_automation_outbound(uuid) from public, anon, authenticated;
grant execute on function public.prepare_automation_outbound(uuid) to service_role;

-- ---------------------------------------------------------------------------------------
-- execute_automation_create_task (+ trava e checagem da inscrição)
-- ---------------------------------------------------------------------------------------
create or replace function public.execute_automation_create_task(
  p_job_id uuid,
  p_lease_owner text,
  p_attempt_count integer
)
returns public.automation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_enrollment public.automation_enrollments%rowtype;
  v_title text;
  v_due_minutes integer;
  v_timezone text;
  v_due_local timestamp;
  v_owner_id uuid;
  v_deal_title text;
  v_marker text;
begin
  select *
  into v_job
  from public.automation_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'job não encontrado';
  end if;
  if v_job.job_type <> 'create_task' then
    raise exception using errcode = '22023', message = 'job não é de tarefa';
  end if;
  if v_job.status <> 'leased'
    or v_job.lease_owner <> p_lease_owner
    or v_job.attempt_count <> p_attempt_count
  then
    raise exception using errcode = '55000', message = 'lease ou tentativa obsoleta';
  end if;

  -- Trava a inscrição e exige que ela ainda esteja ativa NESTE passo (parecer do Codex, B6):
  -- pausa concorrente entre a leitura do executor e esta RPC não pode criar tarefa nem avançar.
  select *
  into v_enrollment
  from public.automation_enrollments
  where id = v_job.enrollment_id
    and organization_id = v_job.organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'inscrição não encontrada';
  end if;
  if v_enrollment.status <> 'active' or v_enrollment.current_step_key <> v_job.step_key then
    raise exception using errcode = '55000',
      message = 'inscrição não está ativa neste passo (' || v_enrollment.status || ')';
  end if;

  v_title := left(btrim(coalesce(v_job.payload#>>'{config,title}', '')), 240);
  if v_title = '' then
    raise exception using errcode = '22023', message = 'tarefa sem título';
  end if;
  v_due_minutes := greatest(0, coalesce(
    (coalesce(v_job.payload#>>'{config,dueInMinutes}', v_job.payload#>>'{config,due_in_minutes}'))::integer,
    0
  ));

  select coalesce(settings.automation_timezone, 'America/Sao_Paulo')
  into v_timezone
  from public.organization_settings settings
  where settings.organization_id = v_job.organization_id;
  begin
    v_due_local := (now() + make_interval(mins => v_due_minutes)) at time zone coalesce(v_timezone, 'America/Sao_Paulo');
  exception when others then
    v_due_local := (now() + make_interval(mins => v_due_minutes)) at time zone 'America/Sao_Paulo';
  end;

  select deal.owner_id, deal.title
  into v_owner_id, v_deal_title
  from public.deals deal
  where deal.id = v_enrollment.deal_id
    and deal.organization_id = v_enrollment.organization_id;

  v_marker := 'automation_job:' || v_job.id::text;
  if not exists (
    select 1
    from public.tasks task
    where task.organization_id = v_job.organization_id
      and task.note like '%' || v_marker || '%'
  ) then
    insert into public.tasks (
      organization_id,
      contact_id,
      type,
      title,
      note,
      due_date,
      due_time,
      status,
      owner_id
    )
    values (
      v_job.organization_id,
      v_enrollment.contact_id,
      'reminder',
      v_title,
      'Criada pela automação'
        || case when v_deal_title is not null then ' · ' || left(v_deal_title, 120) else '' end
        || ' [' || v_marker || ']',
      v_due_local::date,
      case when v_due_minutes > 0 then v_due_local::time else null end,
      'open',
      v_owner_id
    );
  end if;

  return public.complete_automation_job(v_job.id, p_lease_owner, p_attempt_count, 'sent', null);
end;
$$;

revoke all on function public.execute_automation_create_task(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.execute_automation_create_task(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------------------
-- execute_automation_move_deal (+ trava e checagem da inscrição)
-- ---------------------------------------------------------------------------------------
create or replace function public.execute_automation_move_deal(
  p_job_id uuid,
  p_lease_owner text,
  p_attempt_count integer
)
returns public.automation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_enrollment public.automation_enrollments%rowtype;
  v_board_id uuid;
  v_stage_id uuid;
begin
  select *
  into v_job
  from public.automation_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'job não encontrado';
  end if;
  if v_job.job_type not in ('move_stage', 'move_pipeline') then
    raise exception using errcode = '22023', message = 'job não é de movimentação';
  end if;
  if v_job.status <> 'leased'
    or v_job.lease_owner <> p_lease_owner
    or v_job.attempt_count <> p_attempt_count
  then
    raise exception using errcode = '55000', message = 'lease ou tentativa obsoleta';
  end if;

  -- Trava a inscrição e exige que ela ainda esteja ativa NESTE passo (parecer do Codex, B6).
  select *
  into v_enrollment
  from public.automation_enrollments
  where id = v_job.enrollment_id
    and organization_id = v_job.organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'inscrição não encontrada';
  end if;
  if v_enrollment.status <> 'active' or v_enrollment.current_step_key <> v_job.step_key then
    raise exception using errcode = '55000',
      message = 'inscrição não está ativa neste passo (' || v_enrollment.status || ')';
  end if;

  begin
    v_board_id := coalesce(v_job.payload#>>'{config,boardId}', v_job.payload#>>'{config,board_id}')::uuid;
    v_stage_id := coalesce(v_job.payload#>>'{config,stageId}', v_job.payload#>>'{config,stage_id}')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'destino da movimentação inválido';
  end;
  if v_board_id is null or v_stage_id is null then
    raise exception using errcode = '22023', message = 'destino da movimentação inválido';
  end if;

  if not exists (
    select 1
    from public.board_stages stage
    where stage.id = v_stage_id
      and stage.board_id = v_board_id
      and stage.organization_id = v_job.organization_id
  ) then
    raise exception using errcode = '22023', message = 'etapa de destino não existe neste funil';
  end if;

  update public.deals deal
  set board_id = v_board_id,
      stage_id = v_stage_id,
      last_stage_change_date = case when deal.stage_id is distinct from v_stage_id then now() else deal.last_stage_change_date end,
      updated_at = now()
  where deal.id = v_enrollment.deal_id
    and deal.organization_id = v_job.organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'negócio da inscrição não encontrado';
  end if;

  return public.complete_automation_job(v_job.id, p_lease_owner, p_attempt_count, 'sent', null);
end;
$$;

revoke all on function public.execute_automation_move_deal(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.execute_automation_move_deal(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------------------
-- fail_automation_job_and_pause — pausa SÓ a inscrição do job (parecer do Codex, I1)
-- ---------------------------------------------------------------------------------------
create or replace function public.fail_automation_job_and_pause(
  p_job_id uuid,
  p_lease_owner text,
  p_attempt_count integer,
  p_reason text,
  p_error text
)
returns public.automation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.automation_jobs%rowtype;
begin
  if nullif(btrim(p_reason), '') is null or length(p_reason) > 240 then
    raise exception using errcode = '22023', message = 'motivo de pausa inválido';
  end if;

  v_job := public.complete_automation_job(p_job_id, p_lease_owner, p_attempt_count, 'failed', p_error);

  update public.automation_enrollments enrollment
  set paused_from_status = enrollment.status,
      pause_reason = btrim(p_reason),
      status = 'paused',
      paused_at = now(),
      paused_by = null,
      updated_at = now()
  where enrollment.id = v_job.enrollment_id
    and enrollment.organization_id = v_job.organization_id
    and enrollment.status in ('active', 'waiting');

  return v_job;
end;
$$;

revoke all on function public.fail_automation_job_and_pause(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.fail_automation_job_and_pause(uuid, text, integer, text, text) to service_role;

-- ---------------------------------------------------------------------------------------
-- record_automation_opt_out — a conversa precisa ser da organização e do contato (S1)
-- ---------------------------------------------------------------------------------------
create or replace function public.record_automation_opt_out(
  p_organization_id uuid,
  p_contact_id uuid,
  p_thread_id uuid,
  p_occurred_at timestamptz,
  p_keyword text
)
returns table (contact_id uuid, opted_out_at timestamptz, already boolean, paused_enrollments integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing timestamptz;
  v_paused integer := 0;
begin
  select contact.automation_opt_out_at
  into v_existing
  from public.contacts contact
  where contact.id = p_contact_id
    and contact.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contato não encontrado';
  end if;

  if p_thread_id is not null and not exists (
    select 1
    from public.conversation_threads thread
    where thread.id = p_thread_id
      and thread.organization_id = p_organization_id
      and (thread.contact_id is null or thread.contact_id = p_contact_id)
  ) then
    raise exception using errcode = '23503', message = 'conversa não pertence ao contato desta organização';
  end if;

  if v_existing is null then
    update public.contacts contact
    set automation_opt_out_at = coalesce(p_occurred_at, now()),
        updated_at = now()
    where contact.id = p_contact_id
      and contact.organization_id = p_organization_id;
  end if;

  if p_thread_id is not null then
    select count(*)
    into v_paused
    from public.pause_automation_enrollments_for_thread(
      p_thread_id,
      null,
      'opt_out:' || left(coalesce(p_keyword, ''), 40)
    );
  end if;

  return query select
    p_contact_id,
    coalesce(v_existing, p_occurred_at, now()),
    v_existing is not null,
    v_paused;
end;
$$;

revoke all on function public.record_automation_opt_out(uuid, uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_automation_opt_out(uuid, uuid, uuid, timestamptz, text) to service_role;
