-- Reserva atomica para reunioes marcadas por agentes de conversa.
-- A agenda interna (activities) continua sendo a fonte de verdade.

create or replace function public.reserve_conversation_meeting(
  p_activity_id uuid,
  p_organization_id uuid,
  p_owner_id uuid,
  p_contact_id uuid,
  p_deal_id uuid,
  p_title text,
  p_description text,
  p_date timestamptz,
  p_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.activities%rowtype;
begin
  if p_activity_id is null
    or p_organization_id is null
    or p_date is null
    or p_date <= now()
    or nullif(btrim(p_title), '') is null
    or char_length(p_title) > 200
    or char_length(coalesce(p_description, '')) > 2000
  then
    return false;
  end if;

  if p_contact_id is not null and not exists (
    select 1 from public.contacts c
    where c.id = p_contact_id and c.organization_id = p_organization_id
  ) then
    return false;
  end if;

  if p_deal_id is not null and not exists (
    select 1 from public.deals d
    where d.id = p_deal_id and d.organization_id = p_organization_id
  ) then
    return false;
  end if;

  if p_owner_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_id and p.organization_id = p_organization_id
  ) then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || coalesce(p_owner_id::text, 'unassigned'),
      0
    )
  );

  select a.* into v_existing
  from public.activities a
  where a.id = p_activity_id;

  if found then
    return v_existing.organization_id = p_organization_id
      and v_existing.date = p_date
      and v_existing.owner_id is not distinct from p_owner_id
      and v_existing.type = 'MEETING';
  end if;

  if exists (
    select 1
    from public.activities a
    where a.organization_id = p_organization_id
      and a.owner_id is not distinct from p_owner_id
      and a.type = 'MEETING'
      and a.completed = false
      and a.deleted_at is null
      and a.date > p_date - interval '60 minutes'
      and a.date < p_date + interval '60 minutes'
  ) then
    return false;
  end if;

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

  return true;
end;
$$;

revoke all on function public.reserve_conversation_meeting(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function public.reserve_conversation_meeting(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz
) to service_role;
