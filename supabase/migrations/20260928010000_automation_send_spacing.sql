-- =============================================================================
-- Espaçamento aleatório entre envios automatizados da MESMA conexão (28/09)
--
-- Pedido do Junior (modelo Kommo dele, sem API oficial do WhatsApp): os envios
-- da régua saem um a um, com intervalo aleatório (ex.: 1 a 5 minutos), nunca em
-- rajada — proteção anti-ban do número. Hoje a defer manda todos os adiados
-- para o MESMO instante (fim do horário de silêncio) e o tick despacha em
-- sequência imediata.
--
-- Configuração POR CONEXÃO (para todos os clientes; padrão = desligado, e com
-- ela desligada o comportamento fica byte a byte como hoje):
--   channel_connections.config.automationSendSpacing = {
--     "minSeconds": 60, "maxSeconds": 300
--   }
-- Só vale para jobs de automação (send_message live). As respostas da IA na
-- conversa NÃO passam por aqui e continuam imediatas.
--
-- Reescreve public.defer_automation_jobs_before_claim (20260913040000)
-- preservando cabeçalho de segurança, retorno, e os ramos live_desligado e
-- horario_silencio. Novidades: join com a conexão, fila por conexão com
-- memória no próprio loop (mapa jsonb) e razão nova 'espacamento_conexao'.
-- =============================================================================

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
  v_base timestamptz;
  v_spacing_on boolean;
  v_cursor timestamptz;
  v_slot timestamptz;
  v_gap interval;
  -- Fila por conexão DENTRO desta execução: sem isso, dois jobs do mesmo lote
  -- veriam o mesmo "último envio" e sairiam juntos de novo.
  v_cursors jsonb := '{}'::jsonb;
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
           coalesce(settings.automation_quiet_hours_end, '08:00'::time) as quiet_end,
           enrollment.channel_connection_id,
           case when coalesce(connection.config #>> '{automationSendSpacing,minSeconds}', '') ~ '^[0-9]{1,6}$'
                then (connection.config #>> '{automationSendSpacing,minSeconds}')::integer else 0 end as spacing_min,
           case when coalesce(connection.config #>> '{automationSendSpacing,maxSeconds}', '') ~ '^[0-9]{1,6}$'
                then (connection.config #>> '{automationSendSpacing,maxSeconds}')::integer else 0 end as spacing_max
    from public.automation_jobs job
    join public.automation_versions version
      on version.id = job.version_id
     and version.organization_id = job.organization_id
    join public.automation_enrollments enrollment
      on enrollment.id = job.enrollment_id
     and enrollment.organization_id = job.organization_id
    left join public.channel_connections connection
      on connection.id = enrollment.channel_connection_id
     and connection.organization_id = job.organization_id
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
    v_base := v_now;

    if not v_candidate.live_enabled then
      -- Live desligado: segura uma hora e olha de novo. Sem reserva, sem tentativa
      -- gasta e SEM fila (quando religar, a defer reprocessa e aí espaça).
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
        v_base := greatest(v_next_end, v_now + interval '1 minute');
        v_available_at := v_base;
      end if;

      -- Fila anti-ban: só com espaçamento configurado na conexão e live ligado.
      v_spacing_on := v_candidate.channel_connection_id is not null
        and v_candidate.spacing_min >= 1
        and v_candidate.spacing_max >= v_candidate.spacing_min;
      if v_spacing_on then
        v_cursor := coalesce(
          (v_cursors ->> v_candidate.channel_connection_id::text)::timestamptz,
          greatest(
            -- Fim da fila já agendada da conexão (só a fila real: agenda de dias
            -- futuros do delay/wait não conta como fila).
            coalesce((
              -- Pending pronto (outro worker/rodada) conta como "agora" na fila.
              select max(greatest(j2.available_at, v_now))
              from public.automation_jobs j2
              join public.automation_enrollments e2
                on e2.id = j2.enrollment_id
               and e2.organization_id = j2.organization_id
              where e2.channel_connection_id = v_candidate.channel_connection_id
                and j2.job_type = 'send_message'
                and j2.status = 'pending'
                and j2.id <> v_candidate.id
                and j2.available_at <= v_now + interval '4 hours'
            ), '-infinity'::timestamptz),
            -- Último envio que acabou de sair (não colar no anterior).
            coalesce((
              select max(j3.updated_at)
              from public.automation_jobs j3
              join public.automation_enrollments e3
                on e3.id = j3.enrollment_id
               and e3.organization_id = j3.organization_id
              where e3.channel_connection_id = v_candidate.channel_connection_id
                and j3.job_type = 'send_message'
                and j3.status in ('done', 'unknown')
                and j3.updated_at > v_now - interval '60 minutes'
            ), '-infinity'::timestamptz)
          )
        );
        v_gap := make_interval(secs =>
          v_candidate.spacing_min
          + floor(random() * (v_candidate.spacing_max - v_candidate.spacing_min + 1)));
        -- Primeiro da conexão sem fila nem envio recente: cursor é -infinity e o
        -- slot cai na base (sai agora / fim do silêncio). Os seguintes empilham.
        v_slot := greatest(v_base, v_cursor + v_gap);
        v_cursors := jsonb_set(
          v_cursors,
          array[v_candidate.channel_connection_id::text],
          to_jsonb(v_slot)
        );
        if v_slot > v_now + interval '2 seconds' then
          v_available_at := v_slot;
          if v_reason is null then
            v_reason := 'espacamento_conexao';
          end if;
        end if;
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
