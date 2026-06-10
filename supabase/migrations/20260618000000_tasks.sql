-- =============================================================================
-- tasks — tarefas & lembretes (N2, adendo 2026-06-10 — núcleo novo do mockup)
-- =============================================================================
-- "ligações, retornos e avisos — nada de paciente esquecido".
-- A Vitória cria tarefa (ligação/lembrete/mensagem), com data e hora opcional,
-- conclui (done carimba completed_at) ou adia (snoozed).
--
-- `julia_first`: toggle "Julia avisa primeiro no WhatsApp" do drawer do mockup.
-- v1 SÓ PERSISTE a intenção — a automação (Evolution + cron 24h) é fase
-- posterior atrás de flag; o caminho manual sempre funciona (guardrail).
--
-- Tabela OPERACIONAL (espelha atendimentos):
--   SELECT  = can_access_organization  (todo o tenant lê)
--   mutação = can_operate_organization (recepção/staff opera)
--
-- Invariantes de domínio NO BANCO (lição F4 — defense-in-depth):
--   type em call|reminder|message · status em open|done|snoozed
--   · done ⇔ completed_at preenchido (nos DOIS sentidos).
-- =============================================================================

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id),
  type text not null default 'reminder',
  title text not null,
  note text,
  due_date date not null,
  due_time time,
  status text not null default 'open',
  julia_first boolean not null default false,
  created_by uuid references public.profiles(id),
  completed_at timestamptz,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_type_chk
    check (type in ('call', 'reminder', 'message')),
  constraint tasks_status_chk
    check (status in ('open', 'done', 'snoozed')),
  -- done exige completed_at e completed_at exige done (vice-versa).
  constraint tasks_done_completed_at_chk
    check ((status = 'done') = (completed_at is not null))
);

alter table public.tasks enable row level security;

-- Listagens "Vence hoje"/"Próximas" filtram por org + due_date + status.
create index if not exists idx_tasks_org_due_status on public.tasks(organization_id, due_date, status);
create index if not exists idx_tasks_contact on public.tasks(contact_id);
create index if not exists idx_tasks_owner on public.tasks(owner_id);

drop policy if exists "tasks_select_by_tenant" on public.tasks;
create policy "tasks_select_by_tenant"
  on public.tasks
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

drop policy if exists "tasks_mutate_by_tenant_operator" on public.tasks;
create policy "tasks_mutate_by_tenant_operator"
  on public.tasks
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

drop trigger if exists update_tasks_updated_at on public.tasks;
create trigger update_tasks_updated_at
  before update on public.tasks
  for each row
  execute function public.update_updated_at_column();

-- =============================================================================
-- contacts.contact_preference — preferência de contato (N2)
-- =============================================================================
-- 'whatsapp_only' = "não gosta de ligação": a call-list (F6) EXCLUI o contato
-- e a ficha mostra o badge "prefere WhatsApp".
alter table public.contacts
  add column if not exists contact_preference text not null default 'any';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contacts_contact_preference_chk'
  ) then
    alter table public.contacts
      add constraint contacts_contact_preference_chk
      check (contact_preference in ('any', 'whatsapp_only'));
  end if;
end $$;
