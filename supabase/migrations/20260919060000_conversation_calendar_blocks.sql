-- Bloqueios locais da agenda usada pelos agentes de conversa.
-- Horários são guardados como hora local e interpretados no fuso da conexão.

create table public.conversation_calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_connection_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  kind text not null,
  recurrence text not null,
  block_date date,
  weekdays text[] not null default '{}',
  start_time time not null,
  end_time time not null,
  all_day boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint conversation_calendar_blocks_channel_tenant_fk
    foreign key (organization_id, channel_connection_id)
    references public.channel_connections(organization_id, id) on delete cascade,
  constraint conversation_calendar_blocks_title_check
    check (char_length(btrim(title)) between 1 and 80),
  constraint conversation_calendar_blocks_kind_check
    check (kind in ('busy', 'lunch', 'day_off', 'other')),
  constraint conversation_calendar_blocks_recurrence_check
    check (recurrence in ('once', 'weekly')),
  constraint conversation_calendar_blocks_time_check
    check (start_time < end_time),
  constraint conversation_calendar_blocks_shape_check
    check (
      (recurrence = 'once' and block_date is not null and cardinality(weekdays) = 0)
      or
      (recurrence = 'weekly' and block_date is null and cardinality(weekdays) between 1 and 7)
    ),
  constraint conversation_calendar_blocks_weekdays_check
    check (weekdays <@ array['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']::text[])
);

create index conversation_calendar_blocks_lookup_idx
  on public.conversation_calendar_blocks(organization_id, channel_connection_id, owner_id, recurrence, block_date);

create or replace function public.validate_conversation_calendar_block_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = new.owner_id
      and profile.organization_id = new.organization_id
  ) then
    raise exception 'calendar block owner must belong to organization';
  end if;
  return new;
end;
$$;

create trigger validate_conversation_calendar_block_owner_trigger
before insert or update on public.conversation_calendar_blocks
for each row execute function public.validate_conversation_calendar_block_owner();

alter table public.conversation_calendar_blocks enable row level security;

create policy "conversation_calendar_blocks_select_by_manager"
  on public.conversation_calendar_blocks
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('whatsapp.manage_connection')
  );

create policy "conversation_calendar_blocks_mutate_by_manager"
  on public.conversation_calendar_blocks
  for all
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('whatsapp.manage_connection')
  )
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('whatsapp.manage_connection')
  );

revoke all on function public.validate_conversation_calendar_block_owner() from public;
