-- 2a/2c — Caminho LIVE do motor de automações (envio real pela Evolution), silêncio
-- noturno aplicado e opt-out do contato.
--
-- Contexto (13/09): o motor executava só o modo "simulation" (F4): `prepare_automation_outbound`
-- recusava qualquer versão publicada como "live", e nada executava os jobs de atraso, espera,
-- tarefa ou movimentação. Esta migration entrega o que faltava no banco para o executor
-- (`lib/automations/executor.ts`) rodar de verdade:
--
--   1. `contacts.automation_opt_out_at` — o lead pediu para não receber automações (2c).
--   2. `prepare_automation_outbound` — passa a aceitar "live" quando a organização ligou o envio
--      real (`organization_settings.automation_live_enabled`) e o contato não fez opt-out.
--      Cabeçalho de segurança IDÊNTICO ao original (F3/F4): DEFINER, search_path vazio, só
--      service_role. Só o bloco do modo mudou.
--   3. `complete_automation_live` — grava o resultado do envio real na mensagem, na tentativa e
--      no job. `sent` avança a inscrição; `failed` segue a aresta "Falhou o envio" quando existe,
--      senão pausa a conversa; `unknown` pausa para um humano olhar. Nunca retenta sozinho: a
--      biblioteca da Evolution não distingue "não saiu" de "saiu e a resposta se perdeu".
--   4. `open_automation_wait_for_job` — o job de espera abre a espera (F5) e fecha o job SEM
--      avançar (quem avança é a resposta do lead ou o timeout).
--   5. `execute_automation_create_task` / `execute_automation_move_deal` — as ações do funil no
--      próprio CRM (tarefa; mover etapa/funil). Idempotentes por job.
--   6. `fail_automation_job_and_pause` — dead-letter com motivo + pausa da conversa, para o
--      passo que não tem executor (`condition` legado, modo "test") ou a inscrição inativa.
--   7. `defer_automation_jobs_before_claim` — ANTES de reservar: adia o envio "live" que cairia
--      no silêncio noturno do cliente (fuso do cliente; janela que cruza a meia-noite) e o envio
--      de organização com o live desligado (+1 h, sem consumir tentativa).
--   8. `record_automation_opt_out` — marca o contato e pausa as inscrições da conversa.
--
-- Divergência registrada do ADR-MOTOR (worker na VPS): o executor roda dentro do tick e por
-- uma rota interna, com lote pequeno e orçamento de tempo. Ver SPEC-ENTREGA-LIVE.md.

-- ---------------------------------------------------------------------------------------
-- 1. Opt-out do contato
-- ---------------------------------------------------------------------------------------
alter table public.contacts
  add column if not exists automation_opt_out_at timestamptz;

create index if not exists contacts_automation_opt_out_idx
  on public.contacts (organization_id, id)
  where automation_opt_out_at is not null;

-- ---------------------------------------------------------------------------------------
-- 2. prepare_automation_outbound — aceita "live" com o envio real ligado
--    (mesmo cabeçalho de segurança da F3/F4; corpo idêntico salvo o bloco do modo)
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
    -- Envio real só com a chave do cliente ligada (guardada pelo gate de saúde do tick, C1A)
    -- e com o contato sem opt-out (2c). Os dois são checados aqui, no banco, para que nenhum
    -- caminho alternativo mande mensagem real sem passar por eles.
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
-- 3. complete_automation_live — resultado do envio real
-- ---------------------------------------------------------------------------------------
create or replace function public.complete_automation_live(
  p_job_id uuid,
  p_message_id uuid,
  p_lease_owner text,
  p_attempt_count integer,
  p_delivery_status text,
  p_provider_message_id text default null,
  p_attempt_label text default null,
  p_error text default null
)
returns table (job_id uuid, message_id uuid, job_status text, enrollment_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_message public.conversation_messages%rowtype;
  v_definition jsonb;
  v_now timestamptz := now();
  v_provider_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_has_failed_edge boolean := false;
  v_enrollment public.automation_enrollments%rowtype;
begin
  if p_delivery_status not in ('sent', 'failed', 'unknown') then
    raise exception using errcode = '22023', message = 'status de entrega inválido';
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
    or v_job.lease_owner <> p_lease_owner
    or v_job.attempt_count <> p_attempt_count
  then
    raise exception using errcode = '55000', message = 'lease ou tentativa obsoleta';
  end if;

  select definition
  into v_definition
  from public.automation_versions
  where id = v_job.version_id
    and organization_id = v_job.organization_id;
  if v_definition->>'deliveryMode' <> 'live' then
    raise exception using errcode = '42501', message = 'job não é de entrega live';
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
  if v_message.delivery_status <> 'pending' or v_message.provider_message_id is not null then
    raise exception using errcode = '55000', message = 'mensagem não está pending sem provider ID';
  end if;

  update public.conversation_messages
  set delivery_status = p_delivery_status,
      provider_message_id = case when p_delivery_status = 'sent' then v_provider_id else null end,
      delivery_attempt = p_attempt_label,
      delivery_error = p_error,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'delivery_status', p_delivery_status,
        'delivery_mode', 'live',
        'delivery_provider', 'evolution',
        'external_effect', p_delivery_status <> 'failed',
        'provider_message_id', case when p_delivery_status = 'sent' then v_provider_id else null end,
        'delivery_attempt', p_attempt_label,
        'delivery_error', p_error
      )
  where id = v_message.id;

  update public.automation_step_attempts attempt
  set provider_message_id = case when p_delivery_status = 'sent' then v_provider_id else null end,
      metadata = attempt.metadata || jsonb_build_object(
        'delivery_mode', 'live',
        'external_effect', p_delivery_status <> 'failed',
        'delivery_attempt', p_attempt_label
      )
  where attempt.job_id = v_job.id
    and attempt.attempt_number = p_attempt_count
    and attempt.status = 'running';

  if p_delivery_status = 'sent' then
    -- A conversa passa a ter uma saída (a 3d lê `lastOutboundAt` para o marco "respondeu").
    update public.conversation_threads
    set last_message_at = v_now,
        updated_at = v_now,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'lastDirection', 'outbound',
          'lastMessagePreview', left(v_message.content, 160),
          'lastMessageType', v_message.message_type,
          'lastMessageSentAt', v_now,
          'lastMessageAuthor', v_message.author_name,
          'lastMessageAuthorName', v_message.author_name,
          'lastOutboundAt', v_now
        )
    where id = v_message.thread_id
      and organization_id = v_job.organization_id;

    -- 'sent' fecha o job por compare-and-set e avança a inscrição pela aresta "success".
    v_job := public.complete_automation_job(v_job.id, p_lease_owner, p_attempt_count, 'sent', null);

  elsif p_delivery_status = 'unknown' then
    -- Não sabemos se saiu: o job fica "unknown" (nunca reenvia) e a conversa é pausada para
    -- um humano olhar (mesmo mecanismo do C2B para mensagem do lead sem espera).
    v_job := public.complete_automation_job(v_job.id, p_lease_owner, p_attempt_count, 'unknown', p_error);
    perform public.pause_automation_enrollments_for_thread(v_message.thread_id, null, 'delivery_unknown');

  else
    -- Falha definitiva (4xx, sem credencial, número inválido): o job vira dead-letter. Se o
    -- desenho do funil tem a aresta "Falhou o envio", a inscrição segue por ela; senão a
    -- conversa é pausada com o motivo.
    v_job := public.complete_automation_job(v_job.id, p_lease_owner, p_attempt_count, 'failed', p_error);
    select exists (
      select 1
      from jsonb_array_elements(v_definition->'edges') edge
      where edge->>'fromStepKey' = v_job.step_key::text
        and edge->>'outcome' = 'failed'
    ) into v_has_failed_edge;
    if v_has_failed_edge then
      perform public.advance_automation_enrollment(v_job.enrollment_id, v_job.step_key, 'failed');
    else
      perform public.pause_automation_enrollments_for_thread(v_message.thread_id, null, 'delivery_failed');
    end if;
  end if;

  select * into v_enrollment
  from public.automation_enrollments
  where id = v_job.enrollment_id;

  return query select v_job.id, v_message.id, v_job.status, v_enrollment.status;
end;
$$;

revoke all on function public.complete_automation_live(uuid, uuid, text, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_automation_live(uuid, uuid, text, integer, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------------------
-- 4. open_automation_wait_for_job — job de espera abre a espera e fecha o job sem avançar
-- ---------------------------------------------------------------------------------------
create or replace function public.open_automation_wait_for_job(
  p_job_id uuid,
  p_lease_owner text,
  p_attempt_count integer
)
returns public.automation_waits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_amount integer;
  v_unit text;
  v_expires_at timestamptz;
  v_outbound_provider_id text;
  v_wait public.automation_waits%rowtype;
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
  if v_job.job_type <> 'wait_for_event' then
    raise exception using errcode = '22023', message = 'job não é de espera';
  end if;
  if v_job.status <> 'leased'
    or v_job.lease_owner <> p_lease_owner
    or v_job.attempt_count <> p_attempt_count
  then
    raise exception using errcode = '55000', message = 'lease ou tentativa obsoleta';
  end if;

  v_amount := (v_job.payload#>>'{config,timeoutAmount}')::integer;
  v_unit := v_job.payload#>>'{config,timeoutUnit}';
  v_expires_at := case v_unit
    when 'minutes' then v_now + make_interval(mins => v_amount)
    when 'hours' then v_now + make_interval(hours => v_amount)
    when 'days' then v_now + make_interval(days => v_amount)
    else null
  end;
  if v_expires_at is null or v_amount is null or v_amount <= 0 then
    raise exception using errcode = '22023', message = 'timeout da espera inválido';
  end if;

  -- A última mensagem real que a automação mandou nesta inscrição: a resposta do lead
  -- citando-a casa por "quote" (F5); sem isso, casa pela conversa.
  select message.provider_message_id
  into v_outbound_provider_id
  from public.conversation_messages message
  join public.automation_jobs sent_job
    on sent_job.id = message.automation_job_id
   and sent_job.enrollment_id = v_job.enrollment_id
  where message.organization_id = v_job.organization_id
    and message.direction = 'outbound'
    and message.provider_message_id is not null
  order by message.created_at desc
  limit 1;

  v_wait := public.open_automation_wait(
    v_job.enrollment_id,
    v_job.step_key,
    v_expires_at,
    v_outbound_provider_id
  );

  update public.automation_step_attempts attempt
  set status = 'sent',
      executed_at = v_now,
      duration_ms = greatest(0, floor(extract(epoch from (v_now - attempt.started_at)) * 1000)::integer),
      error = null,
      metadata = attempt.metadata || jsonb_build_object('wait_id', v_wait.id, 'expires_at', v_expires_at)
  where attempt.job_id = v_job.id
    and attempt.attempt_number = p_attempt_count
    and attempt.status = 'running';

  update public.automation_jobs
  set status = 'sent',
      lease_owner = null,
      lease_until = null,
      last_error = null,
      updated_at = v_now
  where id = v_job.id
    and status = 'leased'
    and lease_owner = p_lease_owner
    and attempt_count = p_attempt_count;
  if not found then
    raise exception using errcode = '55000', message = 'compare-and-set da espera falhou';
  end if;

  return v_wait;
end;
$$;

revoke all on function public.open_automation_wait_for_job(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.open_automation_wait_for_job(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------------------
-- 5a. execute_automation_create_task — tarefa no CRM (idempotente por job)
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

  select *
  into v_enrollment
  from public.automation_enrollments
  where id = v_job.enrollment_id
    and organization_id = v_job.organization_id;

  -- A versão publicada guarda a configuração compilada em camelCase (`dueInMinutes`); o
  -- rascunho usa snake_case. Aceita as duas para não depender da grafia.
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

  -- Marcador do job na nota: uma tentativa repetida (lease expirada) não cria a tarefa de novo.
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
-- 5b. execute_automation_move_deal — mover etapa / mover funil (idempotente por natureza)
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

  select *
  into v_enrollment
  from public.automation_enrollments
  where id = v_job.enrollment_id
    and organization_id = v_job.organization_id;

  -- Configuração compilada em camelCase (`boardId`/`stageId`); rascunho em snake_case.
  begin
    v_board_id := coalesce(v_job.payload#>>'{config,boardId}', v_job.payload#>>'{config,board_id}')::uuid;
    v_stage_id := coalesce(v_job.payload#>>'{config,stageId}', v_job.payload#>>'{config,stage_id}')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'destino da movimentação inválido';
  end;
  if v_board_id is null or v_stage_id is null then
    raise exception using errcode = '22023', message = 'destino da movimentação inválido';
  end if;

  -- A etapa precisa existir, pertencer ao funil escolhido e à mesma organização.
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
-- 6. fail_automation_job_and_pause — dead-letter com motivo + conversa pausada
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
  v_enrollment public.automation_enrollments%rowtype;
begin
  v_job := public.complete_automation_job(p_job_id, p_lease_owner, p_attempt_count, 'failed', p_error);

  select *
  into v_enrollment
  from public.automation_enrollments
  where id = v_job.enrollment_id;

  if v_enrollment.thread_id is not null then
    perform public.pause_automation_enrollments_for_thread(v_enrollment.thread_id, null, p_reason);
  elsif v_enrollment.status in ('active', 'waiting') then
    update public.automation_enrollments
    set status = 'failed',
        exited_reason = left(p_reason, 240),
        updated_at = now()
    where id = v_enrollment.id;
  end if;

  return v_job;
end;
$$;

revoke all on function public.fail_automation_job_and_pause(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.fail_automation_job_and_pause(uuid, text, integer, text, text) to service_role;

-- ---------------------------------------------------------------------------------------
-- 7. defer_automation_jobs_before_claim — silêncio noturno e live desligado, ANTES de reservar
-- ---------------------------------------------------------------------------------------
create or replace function public.defer_automation_jobs_before_claim(
  p_batch_limit integer default 200
)
returns table (job_id uuid, organization_id uuid, reason text, available_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_now timestamptz := now();
  v_timezone text;
  v_local timestamp;
  v_local_time time;
  v_local_date date;
  v_start time;
  v_end time;
  v_in_quiet boolean;
  v_next_end timestamptz;
  v_reason text;
  v_available_at timestamptz;
begin
  if p_batch_limit < 1 or p_batch_limit > 1000 then
    raise exception using errcode = '22023', message = 'batch_limit deve ficar entre 1 e 1000';
  end if;

  for v_candidate in
    select job.id,
           job.organization_id,
           coalesce(settings.automation_live_enabled, false) as live_enabled,
           coalesce(settings.automation_timezone, 'America/Sao_Paulo') as timezone,
           coalesce(settings.automation_quiet_hours_start, '20:00'::time) as quiet_start,
           coalesce(settings.automation_quiet_hours_end, '08:00'::time) as quiet_end
    from public.automation_jobs job
    join public.automation_versions version
      on version.id = job.version_id
     and version.organization_id = job.organization_id
    left join public.organization_settings settings
      on settings.organization_id = job.organization_id
    where job.status = 'pending'
      and job.job_type = 'send_message'
      and job.available_at <= v_now
      and version.definition->>'deliveryMode' = 'live'
    order by job.available_at, job.created_at, job.id
    for update of job skip locked
    limit p_batch_limit
  loop
    v_reason := null;
    v_available_at := null;

    if not v_candidate.live_enabled then
      -- Live desligado: segura uma hora e olha de novo. Sem reserva, sem tentativa gasta.
      v_reason := 'live_desligado';
      v_available_at := v_now + interval '1 hour';
    else
      v_timezone := v_candidate.timezone;
      begin
        v_local := v_now at time zone v_timezone;
      exception when others then
        v_timezone := 'America/Sao_Paulo';
        v_local := v_now at time zone v_timezone;
      end;
      v_local_time := v_local::time;
      v_local_date := v_local::date;
      v_start := v_candidate.quiet_start;
      v_end := v_candidate.quiet_end;

      if v_start > v_end then
        -- Janela que cruza a meia-noite (padrão 20:00 → 08:00).
        v_in_quiet := v_local_time >= v_start or v_local_time < v_end;
        v_next_end := case
          when v_local_time >= v_start then ((v_local_date + 1) + v_end) at time zone v_timezone
          else (v_local_date + v_end) at time zone v_timezone
        end;
      else
        v_in_quiet := v_local_time >= v_start and v_local_time < v_end;
        v_next_end := (v_local_date + v_end) at time zone v_timezone;
      end if;

      if v_in_quiet then
        v_reason := 'horario_silencio';
        v_available_at := greatest(v_next_end, v_now + interval '1 minute');
      end if;
    end if;

    if v_reason is not null then
      update public.automation_jobs job
      set available_at = v_available_at,
          updated_at = v_now
      where job.id = v_candidate.id
        and job.status = 'pending';

      job_id := v_candidate.id;
      organization_id := v_candidate.organization_id;
      reason := v_reason;
      available_at := v_available_at;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.defer_automation_jobs_before_claim(integer) from public, anon, authenticated;
grant execute on function public.defer_automation_jobs_before_claim(integer) to service_role;

-- ---------------------------------------------------------------------------------------
-- 8. record_automation_opt_out — o lead pediu para parar
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
