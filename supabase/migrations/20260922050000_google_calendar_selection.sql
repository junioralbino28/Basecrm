-- =============================================================================
-- Google Agenda na Aurora — Fatia 5: ESCOLHER a agenda.
-- SPEC: docs/features/aurora-cenno/SPEC-google-agenda.md
--
-- Ate aqui o evento sempre nascia na agenda `primary` da conta conectada, e so ela
-- contava como ocupado. O Junior pediu (22/09) para a IA marcar na agenda **Cenoura -
-- SDR** da conta cenourahub, e o mesmo vale para qualquer cliente com mais de uma
-- agenda ou mais de um closer: cada conexao escolhe ONDE escreve e QUAIS agendas
-- contam como ocupado.
--
-- Aditivo puro: duas colunas novas com valor padrao que reproduz exatamente o
-- comportamento de hoje (`busy_calendar_ids` vazio = usa so a agenda de escrita).
-- Nenhuma linha existente muda de comportamento enquanto ninguem escolher nada.
--
-- `google_calendar_id` (a agenda de ESCRITA) ja existe desde 20260922010000.
-- =============================================================================

alter table public.google_calendar_connections
  add column if not exists google_calendar_summary text,
  add column if not exists busy_calendar_ids text[] not null default '{}'::text[];

comment on column public.google_calendar_connections.google_calendar_summary is
  'Nome da agenda de escrita como o Google mostra (so para a tela; a verdade e google_calendar_id).';

comment on column public.google_calendar_connections.busy_calendar_ids is
  'Agendas que contam como OCUPADO no freeBusy, alem da agenda de escrita. Vazio = so a de escrita, que e o comportamento anterior a esta migration.';
