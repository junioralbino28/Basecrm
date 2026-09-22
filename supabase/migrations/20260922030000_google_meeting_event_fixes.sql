-- =============================================================================
-- Google Agenda na Aurora — consertos das Fatias 3 e 4 achados nas duas revisoes
-- adversariais (seguranca G1-G25 e correcao/operacao) de 22/09/2026.
-- SPEC: docs/features/aurora-cenno/SPEC-google-agenda.md
--
-- Tudo ADITIVO: uma coluna nova, uma tabela nova e a revalidacao do trigger que ja
-- existia. Nenhuma tabela existente muda de forma, nenhum dado e reescrito.
--
-- 1. invited_email — QUAL endereco recebeu convite (nao so QUANDO). Sem isso o teto de
--    convites nao consegue distinguir "avisar de novo o mesmo convidado" de "mandar
--    convite para um endereco NOVO" numa remarcacao, que era o achado BLOQUEANTE da
--    revisao de seguranca: o lead informava um e-mail depois da confirmacao e pedia
--    remarcacao, e o events.patch disparava convite real da conta da empresa para
--    qualquer endereco, sem consumir o teto e sem aviso de auditoria no sino.
--
-- 2. google_calendar_orphan_events — evento que ficou vivo no Google depois de a linha
--    do espelho sumir. Apagar uma CONVERSA pela tela (DELETE em
--    app/api/platform/tenants/[tenantId]/conversations/[threadId]) apaga as activities
--    do contato e a thread; as duas FKs sao `on delete cascade`, entao a linha do
--    espelho evapora e o evento continuava na agenda do responsavel, com o lead
--    convidado, para sempre. O gatilho abaixo copia o minimo necessario ANTES de a
--    linha morrer e o tick apaga no Google depois.
--    Sem FK de proposito: a captura acontece DENTRO de um cascade, e uma FK para
--    organizations/profiles faria o insert falhar (e bloquear a exclusao) quando quem
--    esta sendo apagada e a propria organizacao.
--
-- 3. validate_conversation_meeting_google_event — ganha a checagem do thread_id, que
--    faltava (owner, contato, conexao e activity ja eram validados). CABECALHO DE
--    SEGURANCA COPIADO INTEIRO da migration 20260922020000: security definer +
--    search_path = '' + revoke. Reescrever a funcao a partir do corpo perderia isso
--    em silencio.
-- =============================================================================

-- 1 ---------------------------------------------------------------------------
alter table public.conversation_meeting_google_events
  add column if not exists invited_email text;

comment on column public.conversation_meeting_google_events.invited_email is
  'Endereco que de fato recebeu o convite do Google. Convidar um endereco DIFERENTE deste consome o teto de convites e gera aviso de auditoria, inclusive na remarcacao (events.patch).';

-- Preenche o historico: linha que ja tinha convite enviado convidou o e-mail do lead.
update public.conversation_meeting_google_events
  set invited_email = invitee_email
  where invited_at is not null and invited_email is null;

-- 2 ---------------------------------------------------------------------------
create table if not exists public.google_calendar_orphan_events (
  id uuid primary key default gen_random_uuid(),
  -- Sem FK de proposito (ver cabecalho): sao so os dados para achar o token e apagar.
  organization_id uuid not null,
  owner_id uuid not null,
  google_calendar_id text not null,
  google_event_id text not null,
  source_activity_id uuid,
  attempts integer not null default 0,
  last_error text,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_orphan_events_attempts_check check (attempts >= 0)
);

create index if not exists google_calendar_orphan_events_queue_idx
  on public.google_calendar_orphan_events(next_retry_at)
  where next_retry_at is not null;

create unique index if not exists google_calendar_orphan_events_unique_idx
  on public.google_calendar_orphan_events(organization_id, google_calendar_id, google_event_id);

comment on table public.google_calendar_orphan_events is
  'Eventos que ficaram vivos no Google depois de a linha do espelho ser apagada em cascata (exclusao de conversa/contato/activity). O tick apaga no Google e limpa a linha. Uso interno: so service_role.';

alter table public.google_calendar_orphan_events enable row level security;

revoke all on table public.google_calendar_orphan_events from public, anon, authenticated;
grant all on table public.google_calendar_orphan_events to service_role;

create or replace function public.capture_orphan_google_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- So interessa o que existe no Google e ainda nao foi cancelado la.
  if old.google_event_id is not null and old.status <> 'cancelled' then
    insert into public.google_calendar_orphan_events (
      organization_id, owner_id, google_calendar_id, google_event_id, source_activity_id, next_retry_at
    ) values (
      old.organization_id, old.owner_id, old.google_calendar_id, old.google_event_id, old.activity_id, now()
    )
    on conflict (organization_id, google_calendar_id, google_event_id) do nothing;
  end if;
  return old;
end;
$$;

revoke all on function public.capture_orphan_google_calendar_event() from public, anon, authenticated;

drop trigger if exists capture_orphan_google_calendar_event_trigger
  on public.conversation_meeting_google_events;

create trigger capture_orphan_google_calendar_event_trigger
before delete on public.conversation_meeting_google_events
for each row execute function public.capture_orphan_google_calendar_event();

-- 3 ---------------------------------------------------------------------------
create or replace function public.validate_conversation_meeting_google_event()
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
    raise exception 'google meeting event owner must belong to organization';
  end if;

  if new.contact_id is not null and not exists (
    select 1
    from public.contacts contact
    where contact.id = new.contact_id
      and contact.organization_id = new.organization_id
  ) then
    raise exception 'google meeting event contact must belong to organization';
  end if;

  if new.channel_connection_id is not null and not exists (
    select 1
    from public.channel_connections connection
    where connection.id = new.channel_connection_id
      and connection.organization_id = new.organization_id
  ) then
    raise exception 'google meeting event connection must belong to organization';
  end if;

  if not exists (
    select 1
    from public.activities activity
    where activity.id = new.activity_id
      and activity.organization_id = new.organization_id
  ) then
    raise exception 'google meeting event activity must belong to organization';
  end if;

  -- Novo (achado baixo da revisao de seguranca): a conversa tambem precisa ser do tenant.
  if not exists (
    select 1
    from public.conversation_threads thread
    where thread.id = new.thread_id
      and thread.organization_id = new.organization_id
  ) then
    raise exception 'google meeting event thread must belong to organization';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_conversation_meeting_google_event() from public, anon, authenticated;
