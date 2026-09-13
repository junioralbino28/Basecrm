-- 2a (achado ao provar o executor) — `claim_automation_jobs` estourava `integer` ao reconciliar
-- uma tentativa "running" antiga.
--
-- O cálculo `floor(extract(epoch from (now() - started_at)) * 1000)::integer` passa de 2^31
-- quando a tentativa tem mais de 24,8 dias. Como a reconciliação roda dentro do laço do claim,
-- UM job preso (lease vencida, tentativa aberta) há mais de 25 dias derruba a reserva de TODOS
-- os jobs, para sempre: `integer out of range` em cada tick. Achado no Supabase local com
-- resíduo de testes de julho; em produção aconteceria com qualquer job abandonado.
--
-- Correção: limitar a duração ao maior inteiro antes do cast. Cabeçalho de segurança IDÊNTICO
-- (DEFINER, search_path vazio, só service_role); corpo idêntico salvo a expressão de duração.

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
          duration_ms = least(
            2147483647::double precision,
            greatest(0::double precision, floor(extract(epoch from (v_now - attempt.started_at)) * 1000))
          )::integer,
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

revoke all on function public.claim_automation_jobs(text, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_automation_jobs(text, integer, integer, uuid) to service_role;
