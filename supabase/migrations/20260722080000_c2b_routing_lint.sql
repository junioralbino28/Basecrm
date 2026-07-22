-- =============================================================================
-- C2B — remove estado local não utilizado do roteador
-- =============================================================================

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
          perform public.create_automation_enrollment_from_routing_event(
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
    v_automation_id := null;
  end loop;
end;
$$;

revoke all on function public.process_due_automation_routing(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_due_automation_routing(integer, timestamptz)
  to service_role;
