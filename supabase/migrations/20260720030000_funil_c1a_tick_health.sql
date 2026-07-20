-- =============================================================================
-- Funil Construtor C1A — saúde agregada do tick e gate do envio real
-- =============================================================================

create table public.automation_tick_health (
  singleton boolean primary key default true,
  last_attempt_token uuid,
  last_requested_at timestamptz,
  last_request_id bigint,
  last_received_at timestamptz,
  last_succeeded_at timestamptz,
  last_http_status integer,
  last_materialized_count integer,
  consecutive_failures integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint automation_tick_health_singleton check (singleton),
  constraint automation_tick_health_request_id_positive
    check (last_request_id is null or last_request_id > 0),
  constraint automation_tick_health_http_status_valid
    check (last_http_status is null or last_http_status between 100 and 599),
  constraint automation_tick_health_materialized_non_negative
    check (last_materialized_count is null or last_materialized_count >= 0),
  constraint automation_tick_health_failures_non_negative
    check (consecutive_failures >= 0)
);

alter table public.automation_tick_health enable row level security;

revoke all on table public.automation_tick_health from public;
revoke all on table public.automation_tick_health from anon;
revoke all on table public.automation_tick_health from authenticated;
grant select on table public.automation_tick_health to service_role;

insert into public.automation_tick_health (singleton)
values (true);

create or replace function public.begin_automation_tick_request()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_token uuid := gen_random_uuid();
begin
  update public.automation_tick_health
  set last_attempt_token = v_attempt_token,
      last_requested_at = now(),
      last_request_id = null,
      updated_at = now()
  where singleton;

  if not found then
    raise exception using errcode = '55000', message = 'estado de saúde do tick ausente';
  end if;
  return v_attempt_token;
end;
$$;

revoke all on function public.begin_automation_tick_request() from public;
revoke all on function public.begin_automation_tick_request() from anon;
revoke all on function public.begin_automation_tick_request() from authenticated;
grant execute on function public.begin_automation_tick_request() to service_role;

create or replace function public.mark_automation_tick_enqueued(
  p_attempt_token uuid,
  p_request_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attempt_token is null or p_request_id is null or p_request_id < 1 then
    raise exception using errcode = '22023', message = 'identidade da requisição inválida';
  end if;

  update public.automation_tick_health
  set last_request_id = p_request_id,
      updated_at = now()
  where singleton
    and last_attempt_token = p_attempt_token;
  return found;
end;
$$;

revoke all on function public.mark_automation_tick_enqueued(uuid, bigint) from public;
revoke all on function public.mark_automation_tick_enqueued(uuid, bigint) from anon;
revoke all on function public.mark_automation_tick_enqueued(uuid, bigint) from authenticated;
grant execute on function public.mark_automation_tick_enqueued(uuid, bigint) to service_role;

create or replace function public.fail_automation_tick_request(
  p_attempt_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attempt_token is null or nullif(btrim(p_error), '') is null then
    raise exception using errcode = '22023', message = 'falha do tick inválida';
  end if;

  update public.automation_tick_health
  set last_http_status = null,
      consecutive_failures = consecutive_failures + 1,
      last_error = left(p_error, 1000),
      updated_at = now()
  where singleton
    and last_attempt_token = p_attempt_token;
  return found;
end;
$$;

revoke all on function public.fail_automation_tick_request(uuid, text) from public;
revoke all on function public.fail_automation_tick_request(uuid, text) from anon;
revoke all on function public.fail_automation_tick_request(uuid, text) from authenticated;
grant execute on function public.fail_automation_tick_request(uuid, text) to service_role;

create or replace function public.mark_automation_tick_received(
  p_attempt_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attempt_token is null then
    raise exception using errcode = '22023', message = 'attempt_token ausente';
  end if;

  update public.automation_tick_health
  set last_received_at = now(),
      updated_at = now()
  where singleton
    and last_attempt_token = p_attempt_token;
  return found;
end;
$$;

revoke all on function public.mark_automation_tick_received(uuid) from public;
revoke all on function public.mark_automation_tick_received(uuid) from anon;
revoke all on function public.mark_automation_tick_received(uuid) from authenticated;
grant execute on function public.mark_automation_tick_received(uuid) to service_role;

create or replace function public.complete_automation_tick(
  p_attempt_token uuid,
  p_http_status integer,
  p_materialized_count integer,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_success boolean;
begin
  if p_attempt_token is null
    or p_http_status not between 100 and 599
    or p_materialized_count < 0
  then
    raise exception using errcode = '22023', message = 'conclusão do tick inválida';
  end if;
  v_success := p_http_status between 200 and 299 and nullif(btrim(p_error), '') is null;

  update public.automation_tick_health
  set last_succeeded_at = case when v_success then now() else last_succeeded_at end,
      last_http_status = p_http_status,
      last_materialized_count = p_materialized_count,
      consecutive_failures = case
        when v_success then 0
        else consecutive_failures + 1
      end,
      last_error = case
        when v_success then null
        else left(
          coalesce(nullif(btrim(p_error), ''), format('tick respondeu HTTP %s', p_http_status)),
          1000
        )
      end,
      updated_at = now()
  where singleton
    and last_attempt_token = p_attempt_token
    and last_received_at >= last_requested_at;
  return found;
end;
$$;

revoke all on function public.complete_automation_tick(uuid, integer, integer, text) from public;
revoke all on function public.complete_automation_tick(uuid, integer, integer, text) from anon;
revoke all on function public.complete_automation_tick(uuid, integer, integer, text) from authenticated;
grant execute on function public.complete_automation_tick(uuid, integer, integer, text) to service_role;

create or replace function public.request_automation_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_attempt_token uuid;
  v_request_id bigint;
begin
  -- Esta atualização fica fora do bloco EXCEPTION: o rollback da subtransação
  -- do pg_net nunca apaga o registro de que houve uma tentativa.
  v_attempt_token := public.begin_automation_tick_request();

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
    perform public.fail_automation_tick_request(
      v_attempt_token,
      'segredo ou URL do tick ausente'
    );
    return null;
  end if;

  begin
    select net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object(
        'scheduled_at', now(),
        'tick_attempt_id', v_attempt_token
      ),
      timeout_milliseconds := 5000
    )
    into v_request_id;
  exception when others then
    perform public.fail_automation_tick_request(
      v_attempt_token,
      'pg_net: ' || sqlerrm
    );
    return null;
  end;

  if not public.mark_automation_tick_enqueued(v_attempt_token, v_request_id) then
    raise exception using errcode = '55000', message = 'tentativa do tick ficou obsoleta';
  end if;
  return v_request_id;
end;
$$;

revoke all on function public.request_automation_tick() from public;
revoke all on function public.request_automation_tick() from anon;
revoke all on function public.request_automation_tick() from authenticated;
grant execute on function public.request_automation_tick() to service_role;

create or replace function public.automation_scheduler_health_at(
  p_now timestamptz
)
returns table (
  cron_installed boolean,
  pg_net_installed boolean,
  schedule text,
  active boolean,
  stage text,
  healthy boolean,
  degraded boolean,
  reason text,
  last_requested_at timestamptz,
  last_request_id bigint,
  last_received_at timestamptz,
  last_succeeded_at timestamptz,
  last_http_status integer,
  last_materialized_count integer,
  consecutive_failures integer,
  last_error text
)
language sql
stable
security definer
set search_path = ''
as $$
  with scheduler as (
    select
      exists (
        select 1
        from pg_catalog.pg_extension
        where extname = 'pg_cron'
      ) as cron_installed,
      exists (
        select 1
        from pg_catalog.pg_extension
        where extname = 'pg_net'
      ) as pg_net_installed,
      (
        select job.schedule
        from cron.job job
        where job.jobname = 'automation-tick-every-5-minutes'
        limit 1
      ) as schedule,
      coalesce((
        select job.active
        from cron.job job
        where job.jobname = 'automation-tick-every-5-minutes'
        limit 1
      ), false) as active
  ),
  state as (
    select *
    from public.automation_tick_health
    where singleton
  ),
  derived as (
    select
      scheduler.*,
      state.*,
      case
        when state.last_requested_at is null then 'scheduled'
        when state.last_succeeded_at >= state.last_requested_at then 'tick_succeeded'
        when state.last_received_at >= state.last_requested_at then 'endpoint_received'
        when state.last_request_id is not null then 'request_emitted'
        when state.last_error is not null then 'request_failed'
        else 'scheduled'
      end as stage,
      (
        not scheduler.cron_installed
        or not scheduler.pg_net_installed
        or not scheduler.active
        or state.last_succeeded_at is null
        or p_now - state.last_succeeded_at > interval '10 minutes'
        or (
          state.consecutive_failures > 0
          and state.last_requested_at > coalesce(
            state.last_succeeded_at,
            '-infinity'::timestamptz
          )
        )
      ) as degraded
    from scheduler
    cross join state
  )
  select
    derived.cron_installed,
    derived.pg_net_installed,
    derived.schedule,
    derived.active,
    derived.stage,
    not derived.degraded as healthy,
    derived.degraded,
    case
      when not derived.cron_installed then 'pg_cron não instalado'
      when not derived.pg_net_installed then 'pg_net não instalado'
      when not derived.active then 'agendamento do tick inativo'
      when derived.consecutive_failures > 0
        and derived.last_requested_at > coalesce(
          derived.last_succeeded_at,
          '-infinity'::timestamptz
        )
        then coalesce(derived.last_error, 'última tentativa do tick falhou')
      when derived.last_succeeded_at is null then 'tick ainda não concluiu'
      when p_now - derived.last_succeeded_at > interval '10 minutes'
        then 'tick não conclui há dois intervalos'
      else null
    end as reason,
    derived.last_requested_at,
    derived.last_request_id,
    derived.last_received_at,
    derived.last_succeeded_at,
    derived.last_http_status,
    derived.last_materialized_count,
    derived.consecutive_failures,
    derived.last_error
  from derived;
$$;

revoke all on function public.automation_scheduler_health_at(timestamptz) from public;
revoke all on function public.automation_scheduler_health_at(timestamptz) from anon;
revoke all on function public.automation_scheduler_health_at(timestamptz) from authenticated;
grant execute on function public.automation_scheduler_health_at(timestamptz) to service_role;

drop function public.automation_scheduler_health();

create function public.automation_scheduler_health()
returns table (
  cron_installed boolean,
  pg_net_installed boolean,
  schedule text,
  active boolean,
  stage text,
  healthy boolean,
  degraded boolean,
  reason text,
  last_requested_at timestamptz,
  last_request_id bigint,
  last_received_at timestamptz,
  last_succeeded_at timestamptz,
  last_http_status integer,
  last_materialized_count integer,
  consecutive_failures integer,
  last_error text
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.automation_scheduler_health_at(now());
$$;

revoke all on function public.automation_scheduler_health() from public;
revoke all on function public.automation_scheduler_health() from anon;
revoke all on function public.automation_scheduler_health() from authenticated;
grant execute on function public.automation_scheduler_health() to service_role;

create or replace function public.guard_automation_live_enable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_healthy boolean;
  v_reason text;
begin
  if new.automation_live_enabled then
    if tg_op = 'INSERT'
      or (
        tg_op = 'UPDATE'
        and not coalesce(old.automation_live_enabled, false)
      )
    then
      select health.healthy, health.reason
      into v_healthy, v_reason
      from public.automation_scheduler_health_at(now()) health;

      if not coalesce(v_healthy, false) then
        raise exception using
          errcode = '55000',
          message = 'envio real bloqueado: ' || coalesce(v_reason, 'saúde do tick desconhecida');
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_automation_live_enable() from public;
revoke all on function public.guard_automation_live_enable() from anon;
revoke all on function public.guard_automation_live_enable() from authenticated;

create trigger guard_automation_live_enable
  before insert or update on public.organization_settings
  for each row execute function public.guard_automation_live_enable();

create or replace function public.set_automation_live_enabled(
  p_organization_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_enabled is null then
    raise exception using errcode = '22023', message = 'configuração de live inválida';
  end if;

  update public.organization_settings
  set automation_live_enabled = p_enabled,
      updated_at = now()
  where organization_id = p_organization_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'organização não encontrada';
  end if;
  return p_enabled;
end;
$$;

revoke all on function public.set_automation_live_enabled(uuid, boolean) from public;
revoke all on function public.set_automation_live_enabled(uuid, boolean) from anon;
revoke all on function public.set_automation_live_enabled(uuid, boolean) from authenticated;
grant execute on function public.set_automation_live_enabled(uuid, boolean) to service_role;
