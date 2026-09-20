create table if not exists public.conversation_ai_rate_limits (
  scope_key text primary key check (char_length(scope_key) between 1 and 200),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.conversation_ai_rate_limits enable row level security;
revoke all on table public.conversation_ai_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.conversation_ai_rate_limits to service_role;

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
     or p_window_seconds not between 1 and 3600 then
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
