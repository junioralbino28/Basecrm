-- =============================================================================
-- Espera em DIAS vira o dia local, não 24h corridas (28/09)
--
-- Regra do Junior: "a primeira mensagem tem que ser no dia seguinte que o lead
-- não respondeu — conversei segunda à tarde, terça de manhã ele já recebe".
-- O compilador SEMPRE marca daySemantics='next_local_day' em timeout de dias,
-- mas o runtime somava 24h corridas: quem esfriava segunda às 15h só receberia
-- QUARTA de manhã (24h caem fora da janela 08:30-11:30 e empurram um dia).
--
-- Conserto: com daySemantics='next_local_day' e unidade 'days', o vencimento é
-- a MEIA-NOITE LOCAL (fuso da organização) somada de N dias — "virou o dia" —
-- e a janela da manhã + fila espaçada cuidam da hora do envio. Minutos/horas e
-- dias SEM a semântica (versões antigas) ficam como eram.
--
-- Reescreve public.open_automation_wait_for_job (20260913040000) preservando
-- cabeçalho de segurança, locks, compare-and-set e grants.
-- =============================================================================

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
  v_day_semantics text;
  v_timezone text;
  v_local_date date;
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
  v_day_semantics := v_job.payload#>>'{config,daySemantics}';

  if v_unit = 'days' and v_day_semantics = 'next_local_day' then
    -- "Virou o dia" no fuso da organização: N dias = N meias-noites locais.
    select coalesce(settings.automation_timezone, 'America/Sao_Paulo')
    into v_timezone
    from public.organization_settings settings
    where settings.organization_id = v_job.organization_id;
    v_timezone := coalesce(v_timezone, 'America/Sao_Paulo');
    begin
      v_local_date := (v_now at time zone v_timezone)::date;
    exception when others then
      v_timezone := 'America/Sao_Paulo';
      v_local_date := (v_now at time zone v_timezone)::date;
    end;
    v_expires_at := ((v_local_date + v_amount)::timestamp) at time zone v_timezone;
  else
    v_expires_at := case v_unit
      when 'minutes' then v_now + make_interval(mins => v_amount)
      when 'hours' then v_now + make_interval(hours => v_amount)
      when 'days' then v_now + make_interval(days => v_amount)
      else null
    end;
  end if;
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
