-- =============================================================================
-- Limitador de taxa das conversas: a janela maxima passa de 1 hora para 1 dia.
--
-- Motivo (SPEC-midia-recebida v2, G18): a cota de midia recebida tem tres niveis,
-- e o terceiro e DIARIO por organizacao (500/dia, aprovado pelo Junior em 21/09).
-- Com o teto em 3600 s a chamada diaria levantava excecao; o cliente TypeScript
-- fecha em `allowed: false`, entao toda midia cairia em "limite".
--
-- UNICA mudanca: `p_window_seconds not between 1 and 3600` -> `1 and 86400`.
-- O resto da funcao foi copiado byte a byte de 20260919063000, inclusive o cabecalho
-- (plpgsql, security definer, search_path = public, pg_temp) e os privilegios
-- (so service_role executa). Travado em test/rateLimitDailyWindowMigration.test.ts.
-- Quem ja chama com 60 s (webhook, ai-reply) nao muda em nada.
-- =============================================================================

create or replace function public.consume_conversation_ai_rate_limit(
  p_scope_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_scope_key is null
     or char_length(p_scope_key) not between 1 and 200
     or p_limit not between 1 and 10000
     or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_scope_key, 0));

  select window_started_at, request_count
    into v_window_started_at, v_request_count
  from public.conversation_ai_rate_limits
  where scope_key = p_scope_key
  for update;

  if not found or v_window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    insert into public.conversation_ai_rate_limits (
      scope_key,
      window_started_at,
      request_count,
      updated_at
    ) values (
      p_scope_key,
      v_now,
      1,
      v_now
    )
    on conflict (scope_key) do update set
      window_started_at = excluded.window_started_at,
      request_count = 1,
      updated_at = excluded.updated_at;

    return query select true, p_window_seconds;
    return;
  end if;

  if v_request_count >= p_limit then
    return query select false, greatest(
      1,
      ceil(extract(epoch from (
        v_window_started_at + make_interval(secs => p_window_seconds) - v_now
      )))::integer
    );
    return;
  end if;

  update public.conversation_ai_rate_limits
  set request_count = request_count + 1,
      updated_at = v_now
  where scope_key = p_scope_key;

  return query select true, greatest(
    1,
    ceil(extract(epoch from (
      v_window_started_at + make_interval(secs => p_window_seconds) - v_now
    )))::integer
  );
end;
$$;

revoke all on function public.consume_conversation_ai_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_conversation_ai_rate_limit(text, integer, integer) to service_role;
