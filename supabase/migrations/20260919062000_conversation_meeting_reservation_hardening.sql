-- Endurece a agenda da Aurora:
-- 1. confirmação humana e automática usam a mesma reserva atômica;
-- 2. bloqueios manuais são revalidados dentro da transação;
-- 3. alterações de bloqueio compartilham o mesmo advisory lock da reserva.

drop function if exists public.reserve_conversation_meeting(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz
);

create or replace function public.lock_conversation_calendar_block_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_owner_id uuid;
begin
  if tg_op = 'DELETE' then
    v_organization_id := old.organization_id;
    v_owner_id := old.owner_id;
  else
    v_organization_id := new.organization_id;
    v_owner_id := new.owner_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_organization_id::text || ':' || coalesce(v_owner_id::text, 'unassigned'),
      0
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lock_conversation_calendar_block_owner_trigger
  on public.conversation_calendar_blocks;

create trigger lock_conversation_calendar_block_owner_trigger
before insert or update or delete on public.conversation_calendar_blocks
for each row execute function public.lock_conversation_calendar_block_owner();

revoke all on function public.lock_conversation_calendar_block_owner() from public;

create or replace function public.reserve_conversation_meeting(
  p_activity_id uuid,
  p_organization_id uuid,
  p_channel_connection_id uuid,
  p_owner_id uuid,
  p_contact_id uuid,
  p_deal_id uuid,
  p_title text,
  p_description text,
  p_date timestamptz,
  p_created_at timestamptz,
  p_timezone text,
  p_allow_update boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.activities%rowtype;
  v_local_start timestamp without time zone;
  v_weekday text;
begin
  if p_activity_id is null
    or p_organization_id is null
    or p_date is null
    or p_date <= now()
    or nullif(btrim(p_title), '') is null
    or char_length(p_title) > 200
    or char_length(coalesce(p_description, '')) > 2000
    or nullif(btrim(coalesce(p_timezone, '')), '') is null
    or not exists (
      select 1 from pg_catalog.pg_timezone_names timezone
      where timezone.name = p_timezone
    )
  then
    return false;
  end if;

  if p_channel_connection_id is not null and not exists (
    select 1 from public.channel_connections connection
    where connection.id = p_channel_connection_id
      and connection.organization_id = p_organization_id
  ) then
    return false;
  end if;

  if p_contact_id is not null and not exists (
    select 1 from public.contacts contact
    where contact.id = p_contact_id and contact.organization_id = p_organization_id
  ) then
    return false;
  end if;

  if p_deal_id is not null and not exists (
    select 1 from public.deals deal
    where deal.id = p_deal_id and deal.organization_id = p_organization_id
  ) then
    return false;
  end if;

  if p_owner_id is not null and not exists (
    select 1 from public.profiles profile
    where profile.id = p_owner_id and profile.organization_id = p_organization_id
  ) then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || coalesce(p_owner_id::text, 'unassigned'),
      0
    )
  );

  select activity.* into v_existing
  from public.activities activity
  where activity.id = p_activity_id
  for update;

  if found and not p_allow_update then
    return v_existing.organization_id = p_organization_id
      and v_existing.date = p_date
      and v_existing.owner_id is not distinct from p_owner_id
      and v_existing.type = 'MEETING';
  end if;

  if found and (
    v_existing.organization_id <> p_organization_id
    or v_existing.type <> 'MEETING'
    or v_existing.contact_id is distinct from p_contact_id
    or v_existing.deal_id is distinct from p_deal_id
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.activities activity
    where activity.organization_id = p_organization_id
      and activity.owner_id is not distinct from p_owner_id
      and activity.type = 'MEETING'
      and activity.completed = false
      and activity.deleted_at is null
      and activity.id <> p_activity_id
      and activity.date > p_date - interval '60 minutes'
      and activity.date < p_date + interval '60 minutes'
  ) then
    return false;
  end if;

  v_local_start := p_date at time zone p_timezone;
  v_weekday := case extract(isodow from v_local_start)::integer
    when 1 then 'monday'
    when 2 then 'tuesday'
    when 3 then 'wednesday'
    when 4 then 'thursday'
    when 5 then 'friday'
    when 6 then 'saturday'
    when 7 then 'sunday'
  end;

  if p_channel_connection_id is not null and p_owner_id is not null and exists (
    select 1
    from public.conversation_calendar_blocks block
    where block.organization_id = p_organization_id
      and block.channel_connection_id = p_channel_connection_id
      and block.owner_id = p_owner_id
      and (
        (block.recurrence = 'once' and block.block_date = v_local_start::date)
        or
        (block.recurrence = 'weekly' and v_weekday = any(block.weekdays))
      )
      and v_local_start::time < block.end_time
      and (v_local_start::time + interval '40 minutes') > block.start_time
  ) then
    return false;
  end if;

  if found then
    update public.activities
    set title = p_title,
        description = p_description,
        date = p_date,
        completed = false,
        deal_id = p_deal_id,
        contact_id = p_contact_id,
        owner_id = p_owner_id
    where id = p_activity_id;
  else
    insert into public.activities (
      id,
      organization_id,
      title,
      description,
      type,
      date,
      completed,
      deal_id,
      contact_id,
      owner_id,
      created_at
    ) values (
      p_activity_id,
      p_organization_id,
      p_title,
      p_description,
      'MEETING',
      p_date,
      false,
      p_deal_id,
      p_contact_id,
      p_owner_id,
      coalesce(p_created_at, now())
    );
  end if;

  return true;
end;
$$;

revoke all on function public.reserve_conversation_meeting(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, boolean
) from public, anon, authenticated;

grant execute on function public.reserve_conversation_meeting(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, boolean
) to service_role;
