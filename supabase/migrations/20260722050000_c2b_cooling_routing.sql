-- =============================================================================
-- C2B — relógio de esfriamento, evento de roteamento e tarefa-porteiro
-- =============================================================================

create unique index if not exists uq_conversation_messages_org_id
  on public.conversation_messages(organization_id, id);
create unique index if not exists uq_tasks_org_id
  on public.tasks(organization_id, id);
create unique index if not exists uq_tags_org_id
  on public.tags(organization_id, id);

create table public.automation_conversation_clocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null,
  deal_id uuid,
  contact_id uuid,
  channel_connection_id uuid,
  last_message_id uuid not null,
  last_activity_at timestamptz not null,
  route_after timestamptz not null,
  generation bigint not null default 1,
  processed_generation bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_conversation_clocks_generation_valid
    check (generation >= 1 and processed_generation >= 0 and processed_generation <= generation),
  constraint automation_conversation_clocks_route_after_valid
    check (route_after = last_activity_at + interval '5 days'),
  constraint automation_conversation_clocks_org_thread_unique
    unique (organization_id, thread_id),
  constraint automation_conversation_clocks_org_id_unique
    unique (organization_id, id),
  constraint automation_conversation_clocks_thread_fk
    foreign key (organization_id, thread_id)
    references public.conversation_threads(organization_id, id)
    on delete cascade,
  constraint automation_conversation_clocks_deal_fk
    foreign key (organization_id, deal_id)
    references public.deals(organization_id, id)
    on delete cascade,
  constraint automation_conversation_clocks_contact_fk
    foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id)
    on delete set null,
  constraint automation_conversation_clocks_channel_fk
    foreign key (organization_id, channel_connection_id)
    references public.channel_connections(organization_id, id)
    on delete set null,
  constraint automation_conversation_clocks_message_fk
    foreign key (organization_id, last_message_id)
    references public.conversation_messages(organization_id, id)
    on delete cascade
);

create index automation_conversation_clocks_due
  on public.automation_conversation_clocks(route_after, id)
  where processed_generation < generation;

create table public.automation_routing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null,
  deal_id uuid,
  contact_id uuid,
  channel_connection_id uuid,
  source_message_id uuid not null,
  source_generation bigint not null,
  last_activity_at timestamptz not null,
  eligible_at timestamptz not null,
  status text not null default 'pending',
  candidate_count integer not null default 0,
  selected_category_id uuid,
  selected_tag_id uuid,
  automation_id uuid,
  automation_version_id uuid,
  enrollment_id uuid,
  task_id uuid,
  reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint automation_routing_events_status_known check (
    status in (
      'pending', 'enrolled', 'gated', 'no_interest', 'no_automation',
      'blocked_context', 'cancelled'
    )
  ),
  constraint automation_routing_events_generation_positive check (source_generation >= 1),
  constraint automation_routing_events_candidate_count_valid check (candidate_count >= 0),
  constraint automation_routing_events_resolution_consistent check (
    (status in ('pending', 'gated') and resolved_at is null)
    or (status not in ('pending', 'gated') and resolved_at is not null)
  ),
  constraint automation_routing_events_selection_consistent check (
    (selected_category_id is null and selected_tag_id is null)
    or (selected_category_id is not null and selected_tag_id is not null)
  ),
  constraint automation_routing_events_automation_consistent check (
    (automation_id is null and automation_version_id is null)
    or (automation_id is not null and automation_version_id is not null)
  ),
  constraint automation_routing_events_source_unique
    unique (organization_id, thread_id, source_message_id),
  constraint automation_routing_events_org_id_unique unique (organization_id, id),
  constraint automation_routing_events_thread_fk
    foreign key (organization_id, thread_id)
    references public.conversation_threads(organization_id, id)
    on delete cascade,
  constraint automation_routing_events_deal_fk
    foreign key (organization_id, deal_id)
    references public.deals(organization_id, id)
    on delete cascade,
  constraint automation_routing_events_contact_fk
    foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id)
    on delete set null,
  constraint automation_routing_events_channel_fk
    foreign key (organization_id, channel_connection_id)
    references public.channel_connections(organization_id, id)
    on delete set null,
  constraint automation_routing_events_message_fk
    foreign key (organization_id, source_message_id)
    references public.conversation_messages(organization_id, id)
    on delete cascade,
  constraint automation_routing_events_selected_tag_fk
    foreign key (organization_id, selected_tag_id, selected_category_id)
    references public.tags(organization_id, id, category_id)
    on delete restrict,
  constraint automation_routing_events_automation_fk
    foreign key (automation_id, organization_id)
    references public.automations(id, organization_id)
    on delete restrict,
  constraint automation_routing_events_version_fk
    foreign key (automation_version_id, automation_id, organization_id)
    references public.automation_versions(id, automation_id, organization_id)
    on delete restrict,
  constraint automation_routing_events_task_fk
    foreign key (organization_id, task_id)
    references public.tasks(organization_id, id)
    on delete set null
);

create table public.automation_routing_event_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  routing_event_id uuid not null,
  category_id uuid not null,
  tag_id uuid not null,
  was_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint automation_routing_event_candidates_unique
    unique (organization_id, routing_event_id, tag_id),
  constraint automation_routing_event_candidates_event_fk
    foreign key (organization_id, routing_event_id)
    references public.automation_routing_events(organization_id, id)
    on delete cascade,
  constraint automation_routing_event_candidates_tag_fk
    foreign key (organization_id, tag_id, category_id)
    references public.tags(organization_id, id, category_id)
    on delete restrict
);

create table public.automation_routing_gates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  routing_event_id uuid not null,
  task_id uuid not null,
  thread_id uuid not null,
  deal_id uuid not null,
  status text not null default 'open',
  selected_tag_id uuid,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint automation_routing_gates_status_known
    check (status in ('open', 'resolved', 'cancelled')),
  constraint automation_routing_gates_resolution_consistent check (
    (status = 'open' and selected_tag_id is null and resolved_at is null)
    or (status = 'resolved' and selected_tag_id is not null and resolved_at is not null)
    or (status = 'cancelled' and selected_tag_id is null and resolved_at is not null)
  ),
  constraint automation_routing_gates_event_unique
    unique (organization_id, routing_event_id),
  constraint automation_routing_gates_task_unique
    unique (organization_id, task_id),
  constraint automation_routing_gates_org_id_unique unique (organization_id, id),
  constraint automation_routing_gates_event_fk
    foreign key (organization_id, routing_event_id)
    references public.automation_routing_events(organization_id, id)
    on delete cascade,
  constraint automation_routing_gates_task_fk
    foreign key (organization_id, task_id)
    references public.tasks(organization_id, id)
    on delete cascade,
  constraint automation_routing_gates_thread_fk
    foreign key (organization_id, thread_id)
    references public.conversation_threads(organization_id, id)
    on delete cascade,
  constraint automation_routing_gates_deal_fk
    foreign key (organization_id, deal_id)
    references public.deals(organization_id, id)
    on delete cascade,
  constraint automation_routing_gates_selected_candidate_fk
    foreign key (organization_id, routing_event_id, selected_tag_id)
    references public.automation_routing_event_candidates(
      organization_id, routing_event_id, tag_id
    )
    on delete restrict
);

alter table public.automation_enrollments
  add column entry_tag_id uuid,
  add column routing_event_id uuid,
  add constraint automation_enrollments_routing_context_consistent check (
    (entry_tag_id is null and routing_event_id is null)
    or (entry_tag_id is not null and routing_event_id is not null)
  ),
  add constraint automation_enrollments_entry_tag_fk
    foreign key (organization_id, entry_tag_id)
    references public.tags(organization_id, id)
    on delete restrict,
  add constraint automation_enrollments_routing_event_fk
    foreign key (organization_id, routing_event_id)
    references public.automation_routing_events(organization_id, id)
    on delete restrict;

create unique index automation_enrollments_routing_event_unique
  on public.automation_enrollments(routing_event_id)
  where routing_event_id is not null;

create or replace function public.guard_automation_enrollment_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.automation_id is distinct from old.automation_id
    or new.automation_version_id is distinct from old.automation_version_id
    or new.deal_id is distinct from old.deal_id
    or new.contact_id is distinct from old.contact_id
    or new.entry_tag_id is distinct from old.entry_tag_id
    or new.routing_event_id is distinct from old.routing_event_id
  then
    raise exception using
      errcode = '23514',
      message = 'identidade da inscrição é imutável';
  end if;
  return new;
end;
$$;

alter table public.automation_conversation_clocks enable row level security;
alter table public.automation_routing_events enable row level security;
alter table public.automation_routing_event_candidates enable row level security;
alter table public.automation_routing_gates enable row level security;

grant select on table public.automation_conversation_clocks to authenticated;
grant select on table public.automation_routing_events to authenticated;
grant select on table public.automation_routing_event_candidates to authenticated;
grant select on table public.automation_routing_gates to authenticated;
grant all on table public.automation_conversation_clocks to service_role;
grant all on table public.automation_routing_events to service_role;
grant all on table public.automation_routing_event_candidates to service_role;
grant all on table public.automation_routing_gates to service_role;

create policy "automation_conversation_clocks_select_by_operator"
  on public.automation_conversation_clocks for select to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );
create policy "automation_routing_events_select_by_operator"
  on public.automation_routing_events for select to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );
create policy "automation_routing_event_candidates_select_by_operator"
  on public.automation_routing_event_candidates for select to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );
create policy "automation_routing_gates_select_by_operator"
  on public.automation_routing_gates for select to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
      or public.has_permission('tags.assign')
    )
  );

create or replace function public.record_automation_conversation_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.conversation_threads%rowtype;
begin
  select * into strict v_thread
  from public.conversation_threads
  where id = new.thread_id and organization_id = new.organization_id;

  update public.tasks task
  set status = 'done',
      completed_at = coalesce(task.completed_at, new.created_at),
      note = concat_ws(E'\n', nullif(task.note, ''), 'Porteiro cancelado: houve nova atividade na conversa.'),
      updated_at = new.created_at
  where task.organization_id = new.organization_id
    and task.id in (
      select gate.task_id
      from public.automation_routing_gates gate
      where gate.organization_id = new.organization_id
        and gate.thread_id = new.thread_id
        and gate.status = 'open'
    )
    and task.status <> 'done';

  update public.automation_routing_events event
  set status = 'cancelled',
      reason = 'nova_atividade_na_conversa',
      resolved_at = new.created_at
  where event.organization_id = new.organization_id
    and event.id in (
      select gate.routing_event_id
      from public.automation_routing_gates gate
      where gate.organization_id = new.organization_id
        and gate.thread_id = new.thread_id
        and gate.status = 'open'
    )
    and event.status = 'gated';

  update public.automation_routing_gates gate
  set status = 'cancelled',
      resolved_at = new.created_at
  where gate.organization_id = new.organization_id
    and gate.thread_id = new.thread_id
    and gate.status = 'open';

  insert into public.automation_conversation_clocks (
    organization_id, thread_id, deal_id, contact_id, channel_connection_id,
    last_message_id, last_activity_at, route_after
  ) values (
    new.organization_id, v_thread.id, v_thread.deal_id, v_thread.contact_id,
    v_thread.channel_connection_id, new.id, new.created_at,
    new.created_at + interval '5 days'
  )
  on conflict (organization_id, thread_id) do update
  set deal_id = excluded.deal_id,
      contact_id = excluded.contact_id,
      channel_connection_id = excluded.channel_connection_id,
      last_message_id = excluded.last_message_id,
      last_activity_at = excluded.last_activity_at,
      route_after = excluded.last_activity_at + interval '5 days',
      generation = public.automation_conversation_clocks.generation + 1,
      updated_at = now()
  where (excluded.last_activity_at, excluded.last_message_id)
      > (
        public.automation_conversation_clocks.last_activity_at,
        public.automation_conversation_clocks.last_message_id
      );

  return new;
end;
$$;

revoke all on function public.record_automation_conversation_activity()
  from public, anon, authenticated;

create trigger record_automation_conversation_activity
  after insert on public.conversation_messages
  for each row execute function public.record_automation_conversation_activity();

create or replace function public.create_automation_enrollment_from_routing_event(
  p_routing_event_id uuid,
  p_tag_id uuid,
  p_automation_id uuid
)
returns public.automation_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.automation_routing_events%rowtype;
  v_automation public.automations%rowtype;
  v_definition jsonb;
  v_entry_step_key uuid;
  v_enrollment public.automation_enrollments%rowtype;
  v_category_id uuid;
begin
  select * into v_event
  from public.automation_routing_events
  where id = p_routing_event_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'evento de roteamento não encontrado';
  end if;

  select * into v_enrollment
  from public.automation_enrollments
  where routing_event_id = v_event.id;
  if found then
    if v_enrollment.entry_tag_id <> p_tag_id
      or v_enrollment.automation_id <> p_automation_id
    then
      raise exception using errcode = '23505', message = 'evento já usado por outra rota';
    end if;
    return v_enrollment;
  end if;

  if v_event.status = 'cancelled' then
    raise exception using errcode = '55000', message = 'evento de roteamento foi cancelado';
  end if;
  if v_event.deal_id is null
    or v_event.contact_id is null
    or v_event.channel_connection_id is null
  then
    raise exception using
      errcode = '55000',
      message = 'A conversa precisa de negócio, contato e canal antes de iniciar o follow-up.';
  end if;

  select assignment.category_id into v_category_id
  from public.deal_tag_assignments assignment
  where assignment.organization_id = v_event.organization_id
    and assignment.deal_id = v_event.deal_id
    and assignment.tag_id = p_tag_id
    and assignment.removed_at is null;
  if v_category_id is null then
    raise exception using errcode = '55000', message = 'etiqueta escolhida não está ativa no negócio';
  end if;

  select * into v_automation
  from public.automations
  where id = p_automation_id
    and organization_id = v_event.organization_id
    and lifecycle_status = 'published'
    and published_version_id is not null
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'automação da etiqueta não está publicada';
  end if;
  if not exists (
    select 1
    from public.automation_tag_dependencies dependency
    where dependency.organization_id = v_event.organization_id
      and dependency.automation_id = v_automation.id
      and dependency.automation_version_id = v_automation.published_version_id
      and dependency.source_scope = 'published'
      and dependency.dependency_type = 'trigger'
      and dependency.tag_id = p_tag_id
  ) then
    raise exception using errcode = '55000', message = 'etiqueta não é gatilho da automação publicada';
  end if;

  select definition into v_definition
  from public.automation_versions
  where id = v_automation.published_version_id
    and automation_id = v_automation.id
    and organization_id = v_automation.organization_id;
  begin
    v_entry_step_key := (v_definition ->> 'entryStepKey')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'entryStepKey inválida';
  end;
  if not exists (
    select 1 from jsonb_array_elements(v_definition -> 'steps') step
    where step.value ->> 'stepKey' = v_entry_step_key::text
  ) then
    raise exception using errcode = '22023', message = 'entryStepKey ausente da versão';
  end if;

  insert into public.automation_enrollments (
    organization_id, automation_id, automation_version_id,
    deal_id, contact_id, thread_id, channel_connection_id,
    current_step_key, entry_tag_id, routing_event_id
  ) values (
    v_event.organization_id, v_automation.id, v_automation.published_version_id,
    v_event.deal_id, v_event.contact_id, v_event.thread_id, v_event.channel_connection_id,
    v_entry_step_key, p_tag_id, v_event.id
  )
  returning * into v_enrollment;

  update public.automation_routing_events
  set status = 'enrolled',
      selected_category_id = v_category_id,
      selected_tag_id = p_tag_id,
      automation_id = v_automation.id,
      automation_version_id = v_automation.published_version_id,
      enrollment_id = v_enrollment.id,
      reason = null,
      resolved_at = now()
  where id = v_event.id;

  return v_enrollment;
end;
$$;

revoke all on function public.create_automation_enrollment_from_routing_event(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.process_due_automation_routing(
  p_batch_limit integer default 50,
  p_now timestamptz default now()
)
returns table (
  clock_id uuid,
  routing_event_id uuid,
  outcome text,
  enrollment_id uuid,
  gate_id uuid,
  is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clock public.automation_conversation_clocks%rowtype;
  v_event public.automation_routing_events%rowtype;
  v_candidate_count integer;
  v_candidate record;
  v_automation_id uuid;
  v_enrollment public.automation_enrollments%rowtype;
  v_task public.tasks%rowtype;
  v_gate public.automation_routing_gates%rowtype;
  v_timezone text;
  v_local_now timestamp;
  v_due_time time;
  v_owner_id uuid;
begin
  if p_batch_limit < 1 or p_batch_limit > 200 then
    raise exception using errcode = '22023', message = 'batch_limit deve ficar entre 1 e 200';
  end if;

  for v_clock in
    select clock.*
    from public.automation_conversation_clocks clock
    where clock.processed_generation < clock.generation
      and clock.route_after <= p_now
    order by clock.route_after, clock.id
    for update skip locked
    limit p_batch_limit
  loop
    if exists (
      select 1
      from public.automation_enrollments enrollment
      where enrollment.organization_id = v_clock.organization_id
        and enrollment.thread_id = v_clock.thread_id
        and enrollment.status in ('active', 'waiting')
    ) then
      continue;
    end if;

    insert into public.automation_routing_events (
      organization_id, thread_id, deal_id, contact_id, channel_connection_id,
      source_message_id, source_generation, last_activity_at, eligible_at
    ) values (
      v_clock.organization_id, v_clock.thread_id, v_clock.deal_id,
      v_clock.contact_id, v_clock.channel_connection_id,
      v_clock.last_message_id, v_clock.generation,
      v_clock.last_activity_at, v_clock.route_after
    )
    on conflict (organization_id, thread_id, source_message_id) do nothing
    returning * into v_event;

    if v_event.id is null then
      select * into strict v_event
      from public.automation_routing_events event
      where event.organization_id = v_clock.organization_id
        and event.thread_id = v_clock.thread_id
        and event.source_message_id = v_clock.last_message_id;
      update public.automation_conversation_clocks
      set processed_generation = greatest(processed_generation, v_clock.generation),
          updated_at = p_now
      where id = v_clock.id;
      clock_id := v_clock.id;
      routing_event_id := v_event.id;
      outcome := v_event.status;
      enrollment_id := v_event.enrollment_id;
      select gate.id into gate_id
      from public.automation_routing_gates gate
      where gate.routing_event_id = v_event.id;
      is_new := false;
      return next;
      continue;
    end if;

    if v_clock.deal_id is null
      or v_clock.contact_id is null
      or v_clock.channel_connection_id is null
    then
      update public.automation_routing_events
      set status = 'blocked_context',
          reason = 'Conversa sem negócio, contato ou canal.',
          resolved_at = p_now
      where id = v_event.id
      returning * into v_event;
    else
      insert into public.automation_routing_event_candidates (
        organization_id, routing_event_id, category_id, tag_id, was_primary
      )
      select
        assignment.organization_id, v_event.id, assignment.category_id,
        assignment.tag_id, assignment.is_primary
      from public.deal_tag_assignments assignment
      join public.tags tag
        on tag.organization_id = assignment.organization_id
       and tag.id = assignment.tag_id
       and tag.category_id = assignment.category_id
       and tag.archived_at is null
      join public.tag_categories category
        on category.organization_id = assignment.organization_id
       and category.id = assignment.category_id
       and category.archived_at is null
      where assignment.organization_id = v_clock.organization_id
        and assignment.deal_id = v_clock.deal_id
        and assignment.removed_at is null
        and exists (
          select 1
          from public.automations automation
          join public.automation_tag_dependencies dependency
            on dependency.organization_id = automation.organization_id
           and dependency.automation_id = automation.id
           and dependency.automation_version_id = automation.published_version_id
           and dependency.source_scope = 'published'
           and dependency.dependency_type = 'trigger'
          where automation.organization_id = assignment.organization_id
            and automation.lifecycle_status = 'published'
            and dependency.category_id = assignment.category_id
        );

      select count(*) into v_candidate_count
      from public.automation_routing_event_candidates candidate
      where candidate.routing_event_id = v_event.id;
      update public.automation_routing_events
      set candidate_count = v_candidate_count
      where id = v_event.id;

      if v_candidate_count = 0 then
        update public.automation_routing_events
        set status = 'no_interest',
            reason = 'Nenhum procedimento com automação publicada está ativo.',
            resolved_at = p_now
        where id = v_event.id
        returning * into v_event;
      elsif v_candidate_count = 1 then
        select candidate.* into strict v_candidate
        from public.automation_routing_event_candidates candidate
        where candidate.routing_event_id = v_event.id;

        select automation.id into v_automation_id
        from public.automations automation
        join public.automation_tag_dependencies dependency
          on dependency.organization_id = automation.organization_id
         and dependency.automation_id = automation.id
         and dependency.automation_version_id = automation.published_version_id
         and dependency.source_scope = 'published'
         and dependency.dependency_type = 'trigger'
        where automation.organization_id = v_event.organization_id
          and automation.lifecycle_status = 'published'
          and dependency.tag_id = v_candidate.tag_id;

        if v_automation_id is null then
          update public.automation_routing_events
          set status = 'no_automation',
              reason = 'O procedimento não possui automação publicada.',
              resolved_at = p_now
          where id = v_event.id
          returning * into v_event;
        else
          v_enrollment := public.create_automation_enrollment_from_routing_event(
            v_event.id, v_candidate.tag_id, v_automation_id
          );
          select * into strict v_event
          from public.automation_routing_events where id = v_event.id;
        end if;
      elsif v_candidate_count > 1 then
        select settings.automation_timezone into v_timezone
        from public.organization_settings settings
        where settings.organization_id = v_event.organization_id;
        v_timezone := coalesce(v_timezone, 'America/Sao_Paulo');
        v_local_now := p_now at time zone v_timezone;
        v_due_time := least(
          v_local_now + interval '2 hours',
          date_trunc('day', v_local_now) + interval '23 hours 59 minutes'
        )::time;
        select coalesce(thread.assigned_user_id, deal.owner_id) into v_owner_id
        from public.conversation_threads thread
        join public.deals deal
          on deal.organization_id = thread.organization_id
         and deal.id = thread.deal_id
        where thread.organization_id = v_event.organization_id
          and thread.id = v_event.thread_id;

        insert into public.tasks (
          organization_id, contact_id, type, title, note,
          due_date, due_time, status, julia_first, owner_id
        ) values (
          v_event.organization_id,
          v_event.contact_id,
          'reminder',
          'Definir procedimento principal antes do follow-up',
          'Há mais de um procedimento de interesse. Escolha o principal antes de iniciar o follow-up.',
          v_local_now::date,
          v_due_time,
          'open',
          false,
          v_owner_id
        ) returning * into v_task;

        insert into public.automation_routing_gates (
          organization_id, routing_event_id, task_id, thread_id, deal_id
        ) values (
          v_event.organization_id, v_event.id, v_task.id,
          v_event.thread_id, v_event.deal_id
        ) returning * into v_gate;

        update public.automation_routing_events
        set status = 'gated',
            task_id = v_task.id,
            reason = 'Mais de um procedimento exige decisão humana.'
        where id = v_event.id
        returning * into v_event;
      end if;
    end if;

    update public.automation_conversation_clocks
    set processed_generation = greatest(processed_generation, v_clock.generation),
        updated_at = p_now
    where id = v_clock.id;

    clock_id := v_clock.id;
    routing_event_id := v_event.id;
    outcome := v_event.status;
    enrollment_id := v_event.enrollment_id;
    gate_id := v_gate.id;
    is_new := true;
    return next;

    v_event := null;
    v_gate := null;
    v_task := null;
    v_enrollment := null;
    v_automation_id := null;
  end loop;
end;
$$;

revoke all on function public.process_due_automation_routing(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_due_automation_routing(integer, timestamptz)
  to service_role;

create or replace function public.resolve_automation_routing_gate(
  p_gate_id uuid,
  p_tag_id uuid
)
returns public.automation_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate public.automation_routing_gates%rowtype;
  v_candidate public.automation_routing_event_candidates%rowtype;
  v_automation_id uuid;
  v_enrollment public.automation_enrollments%rowtype;
begin
  select * into v_gate
  from public.automation_routing_gates
  where id = p_gate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'tarefa-porteiro não encontrada';
  end if;
  if (select auth.uid()) is null
    or not public.can_access_organization(v_gate.organization_id)
    or not public.has_permission('tags.assign')
  then
    raise exception using errcode = '42501', message = 'Sem permissão para resolver o procedimento principal.';
  end if;

  if v_gate.status = 'resolved' then
    if v_gate.selected_tag_id <> p_tag_id then
      raise exception using errcode = '55000', message = 'porteiro já resolvido com outro procedimento';
    end if;
    select * into strict v_enrollment
    from public.automation_enrollments
    where routing_event_id = v_gate.routing_event_id;
    return v_enrollment;
  end if;
  if v_gate.status <> 'open' then
    raise exception using errcode = '55000', message = 'porteiro foi cancelado por nova atividade na conversa';
  end if;

  select * into v_candidate
  from public.automation_routing_event_candidates candidate
  where candidate.organization_id = v_gate.organization_id
    and candidate.routing_event_id = v_gate.routing_event_id
    and candidate.tag_id = p_tag_id;
  if not found then
    raise exception using errcode = '22023', message = 'procedimento não pertence às opções do porteiro';
  end if;

  perform 1 from public.deals
  where organization_id = v_gate.organization_id and id = v_gate.deal_id
  for update;
  update public.deal_tag_assignments
  set is_primary = false
  where organization_id = v_gate.organization_id
    and deal_id = v_gate.deal_id
    and category_id = v_candidate.category_id
    and removed_at is null;
  update public.deal_tag_assignments
  set is_primary = true
  where organization_id = v_gate.organization_id
    and deal_id = v_gate.deal_id
    and tag_id = p_tag_id
    and removed_at is null;
  if not found then
    raise exception using errcode = '55000', message = 'procedimento escolhido não está mais ativo';
  end if;

  select automation.id into v_automation_id
  from public.automations automation
  join public.automation_tag_dependencies dependency
    on dependency.organization_id = automation.organization_id
   and dependency.automation_id = automation.id
   and dependency.automation_version_id = automation.published_version_id
   and dependency.source_scope = 'published'
   and dependency.dependency_type = 'trigger'
  where automation.organization_id = v_gate.organization_id
    and automation.lifecycle_status = 'published'
    and dependency.tag_id = p_tag_id;
  if v_automation_id is null then
    raise exception using errcode = '55000', message = 'procedimento escolhido não possui automação publicada';
  end if;

  v_enrollment := public.create_automation_enrollment_from_routing_event(
    v_gate.routing_event_id, p_tag_id, v_automation_id
  );

  update public.automation_routing_gates
  set status = 'resolved',
      selected_tag_id = p_tag_id,
      resolved_by = (select auth.uid()),
      resolved_at = now()
  where id = v_gate.id;
  update public.tasks
  set status = 'done', completed_at = now(), updated_at = now()
  where organization_id = v_gate.organization_id
    and id = v_gate.task_id
    and status <> 'done';

  return v_enrollment;
end;
$$;

revoke all on function public.resolve_automation_routing_gate(uuid, uuid)
  from public, anon;
grant execute on function public.resolve_automation_routing_gate(uuid, uuid)
  to authenticated, service_role;
