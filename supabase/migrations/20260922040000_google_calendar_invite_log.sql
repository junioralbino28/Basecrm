-- =============================================================================
-- Google Agenda na Aurora — o teto de convites passa a contar CONVITES, e a linha
-- barrada pelo anti-abuso ganha estado proprio.
-- SPEC: docs/features/aurora-cenno/SPEC-google-agenda.md
--
-- Achado ALTO da revisao adversarial dos proprios consertos (22/09):
--
-- 1. `countRecentInvites` contava LINHAS de conversation_meeting_google_events com
--    `invited_at` nas ultimas 24 h. Como a remarcacao reusa a MESMA linha (activity_id
--    e a chave), o contador de uma conversa nunca passava de 1: o lead podia informar
--    um e-mail, pedir para remarcar, trocar o e-mail, remarcar de novo, e cada volta
--    disparava um convite real da conta Google da empresa para um endereco novo — sem
--    nunca encostar no teto de 20. O teto existia, era chamado no lugar certo e mesmo
--    assim nao fechava nada. Agora cada convite ENVIADO vira uma linha aqui, e e isto
--    que o teto conta.
--
--    A tabela tambem e o registro de auditoria que faltava: da para responder "quais
--    enderecos esta conexao convidou nas ultimas 24 h" com um select.
--
--    Sem FK de proposito, como em google_calendar_orphan_events: e um log, precisa
--    sobreviver a exclusao da conversa, do contato e da propria reuniao.
--
-- 2. A linha recusada pelo limite de "1 evento ativo por contato" era gravada como
--    `failed`, que e o MESMO estado de "o Google falhou". Ao reconectar o Google,
--    `requeueFailedGoogleMeetingEvents` devolvia essas linhas para a fila e o limite
--    anti-abuso simplesmente deixava de valer. Estado proprio (`blocked`) separa os
--    dois: nenhum caminho automatico ressuscita uma recusa de politica.
-- =============================================================================

create table if not exists public.google_calendar_invite_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  owner_id uuid not null,
  invitee_email text not null,
  source_activity_id uuid,
  sent_at timestamptz not null default now()
);

-- Janela de 24 h por (organizacao, responsavel): e exatamente a leitura do teto.
create index if not exists google_calendar_invite_log_window_idx
  on public.google_calendar_invite_log(organization_id, owner_id, sent_at desc);

comment on table public.google_calendar_invite_log is
  'Um registro por convite do Google REALMENTE enviado (attendee + sendUpdates=all). E o que o teto anti-abuso conta e o historico de quem foi convidado. Uso interno: so service_role.';

alter table public.google_calendar_invite_log enable row level security;

revoke all on table public.google_calendar_invite_log from public, anon, authenticated;
grant all on table public.google_calendar_invite_log to service_role;

-- Semeia o historico ja existente: cada linha que tem convite enviado conta como um convite.
insert into public.google_calendar_invite_log (organization_id, owner_id, invitee_email, source_activity_id, sent_at)
select organization_id, owner_id, coalesce(invited_email, invitee_email), activity_id, invited_at
  from public.conversation_meeting_google_events
 where invited_at is not null
   and coalesce(invited_email, invitee_email) is not null;

-- 2 --------------------------------------------------------------------------
alter table public.conversation_meeting_google_events
  drop constraint if exists conversation_meeting_google_events_status_check;

alter table public.conversation_meeting_google_events
  add constraint conversation_meeting_google_events_status_check
  check (status in ('pending', 'created', 'update_pending', 'cancel_pending', 'cancelled', 'failed', 'blocked'));

-- Linhas ja gravadas pela recusa de politica passam para o estado novo (o texto do
-- `last_error` e escrito num unico lugar, em meetingEventQueue.ts).
update public.conversation_meeting_google_events
   set status = 'blocked'
 where status = 'failed'
   and last_error like 'Limite anti-abuso:%';
