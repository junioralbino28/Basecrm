-- =============================================================================
-- Google Agenda na Aurora — Fatias 3 e 4 (evento no Google + lembrete do link)
-- SPEC: docs/features/aurora-cenno/SPEC-google-agenda.md
-- Desenho: 06-References/basecrm-producao-aurora-2026-09-21/DESENHO-GOOGLE-AGENDA-2026-09-22.md
--
-- Uma tabela nova, aditiva (nenhuma migration altera activities, channel_connections
-- nem reserve_conversation_meeting): espelho 1:1 da reuniao do CRM no Google.
--   activity_id e a CHAVE — e o mesmo id da activity reservada por
--   reserve_conversation_meeting (handoff.eventId). Remarcar a MESMA reuniao
--   atualiza esta linha (status update_pending), nunca cria outra: e o que impede
--   o evento antigo de ficar orfao no Google (achado bloqueante da critica de
--   operacao, 22/09).
--
-- Fluxo dos estados (o relogio de 5 min em app/api/internal/automations/tick):
--   pending        -> events.insert (Meet + convidado)      -> created
--   created s/ link-> events.get ate vir o hangoutLink      -> created
--   update_pending -> events.patch (horario novo)           -> created
--   cancel_pending -> events.delete                         -> cancelled
--   falha persistente                                       -> failed
--
-- next_retry_at e o relogio da fila: TEM valor quando ha trabalho a fazer e fica
-- NULO quando nao ha. O tick le exatamente `next_retry_at <= now()` (em SQL,
-- `null <= now()` nao e verdadeiro, entao a linha pronta nunca e relida a toa).
--
-- RLS ligada, SEM policy para authenticated/anon (deny-all), privilegios revogados
-- de public/anon/authenticated e concedidos so a service_role — mesmo esqueleto de
-- supabase/migrations/20260922010000_google_calendar_connections.sql. Todo acesso do
-- app passa por createStaticAdminClient dentro de app/api/**.
--
-- Nada muda para quem nao conecta: a linha so nasce quando o responsavel da agenda
-- tem conexao `connected` em google_calendar_connections (checado no codigo, sem rede).
-- =============================================================================

create table public.conversation_meeting_google_events (
  -- Mesma chave da activity reservada no CRM (1:1, sem id proprio de propósito).
  activity_id uuid primary key references public.activities(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null references public.conversation_threads(id) on delete cascade,
  channel_connection_id uuid references public.channel_connections(id) on delete set null,
  -- Responsavel da agenda: e por (organization_id, owner_id) que se acha o token no Vault.
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  -- Nome ja higienizado no codigo; entra SO no titulo fixo do evento, nunca texto do LLM (G16).
  contact_name text,
  -- Convidado do evento. Vem do lead, sem prova de posse: dai os limites anti-abuso
  -- (1 evento ativo por contato; teto de convites por conexao por dia) e o aviso de
  -- auditoria no sino a cada convite enviado.
  invitee_email text,
  -- Quando o convite de fato saiu (attendee + sendUpdates=all). Nulo = nenhum convite enviado.
  invited_at timestamptz,
  scheduled_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  google_calendar_id text not null default 'primary',
  google_event_id text,
  meet_link text,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  next_retry_at timestamptz,
  reminder_sent_at timestamptz,
  reminder_escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_meeting_google_events_status_check
    check (status in ('pending', 'created', 'update_pending', 'cancel_pending', 'cancelled', 'failed')),
  constraint conversation_meeting_google_events_attempts_check
    check (attempts >= 0)
);

-- Fila do tick (Fatia 3): status a processar + next_retry_at vencido.
create index conversation_meeting_google_events_queue_idx
  on public.conversation_meeting_google_events(next_retry_at, status)
  where next_retry_at is not null;

-- Lembrete do link (Fatia 4): janela de 15 min a partir de agora.
create index conversation_meeting_google_events_reminder_idx
  on public.conversation_meeting_google_events(scheduled_at)
  where reminder_sent_at is null and reminder_escalated_at is null;

-- Teto de convites por conexao por dia (anti-abuso).
create index conversation_meeting_google_events_owner_invited_idx
  on public.conversation_meeting_google_events(organization_id, owner_id, invited_at);

-- "No maximo 1 evento ativo por contato" e checado no codigo antes do insert; o indice
-- deixa essa leitura barata.
create index conversation_meeting_google_events_contact_idx
  on public.conversation_meeting_google_events(organization_id, contact_id, status);

comment on table public.conversation_meeting_google_events is
  'Espelho da reuniao do CRM no Google Agenda (Aurora). Chave = activity_id, para remarcar/cancelar a MESMA reuniao em vez de deixar evento orfao no Google. Uso interno: sem SELECT/INSERT/UPDATE/DELETE para authenticated/anon; so service_role, pelo relogio do tick.';

comment on column public.conversation_meeting_google_events.next_retry_at is
  'Relogio da fila: com valor quando ha trabalho pendente, NULO quando nao ha. O tick le next_retry_at <= now().';

comment on column public.conversation_meeting_google_events.invitee_email is
  'E-mail do lead, sem prova de posse. Por isso os limites anti-abuso e o aviso de auditoria no sino a cada convite enviado.';

alter table public.conversation_meeting_google_events enable row level security;

-- Privilegios padrao do Supabase dao a anon/authenticated TRUNCATE/REFERENCES/TRIGGER
-- em toda tabela nova (achado R-09). Zera tudo e concede so ao service_role; sem
-- policy nenhuma para authenticated/anon = deny-all mesmo que algum grant escape.
revoke all on table public.conversation_meeting_google_events from public, anon, authenticated;
grant all on table public.conversation_meeting_google_events to service_role;

-- O responsavel da agenda e o contato precisam ser da MESMA organizacao da linha
-- (mesmo idioma de validate_google_calendar_connection_owner na migration anterior):
-- sem isso um erro de codigo poderia espelhar a reuniao na agenda de outro tenant.
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

  return new;
end;
$$;

revoke all on function public.validate_conversation_meeting_google_event() from public, anon, authenticated;

drop trigger if exists validate_conversation_meeting_google_event_trigger
  on public.conversation_meeting_google_events;

create trigger validate_conversation_meeting_google_event_trigger
before insert or update on public.conversation_meeting_google_events
for each row execute function public.validate_conversation_meeting_google_event();
