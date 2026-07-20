-- =============================================================================
-- Funil Construtor C1A — contrato do passo switch
-- =============================================================================

alter table public.automation_steps
  drop constraint automation_steps_type_known,
  add constraint automation_steps_type_known
    check (
      step_type in (
        'send_message',
        'delay',
        'wait_for_event',
        'create_task',
        'move_stage',
        'move_pipeline',
        'condition',
        'switch'
      )
    );

alter table public.automation_step_edges
  drop constraint automation_step_edges_outcome_known,
  add constraint automation_step_edges_outcome_known
    check (
      outcome in (
        'success',
        'answered',
        'timeout',
        'failed',
        'true',
        'false',
        'otherwise'
      )
      or outcome ~ '^case:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  add constraint automation_step_edges_order_unique
    unique (from_step_id, "order");

-- O materializador persiste o tipo do passo no job. Sem esta extensão, um
-- switch válido no authoring falharia ao entrar na fila.
alter table public.automation_jobs
  drop constraint automation_jobs_type_known,
  add constraint automation_jobs_type_known
    check (
      job_type in (
        'send_message',
        'delay',
        'wait_for_event',
        'create_task',
        'move_stage',
        'move_pipeline',
        'condition',
        'switch'
      )
    );
