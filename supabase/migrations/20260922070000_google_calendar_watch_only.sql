-- =============================================================================
-- Google Agenda na Aurora — agenda de AVISO (nao bloqueia).
-- SPEC: docs/features/aurora-cenno/SPEC-google-agenda.md
--
-- Correcao de rumo pedida pelo Junior (22/09): a agenda principal da conta e usada
-- por MAIS DE UMA pessoa (ele e a Rayanne, para calls com clientes). Um evento la
-- NAO significa que o closer esta ocupado — bloquear o horario tira venda. Mas ele
-- quer SABER que existe algo la naquele horario.
--
-- Por isso duas listas, com sentidos diferentes e nao sobrepostos:
--   busy_calendar_ids  -> BLOQUEIA: entra no freeBusy, o horario nem e oferecido ao lead.
--   watch_calendar_ids -> SO AVISA: nao entra no freeBusy; se houver evento sobreposto no
--                         momento em que a reuniao e criada, isso vira um aviso no CRM.
--
-- Aditivo puro: coluna nova com padrao vazio = exatamente o comportamento de hoje.
-- =============================================================================

alter table public.google_calendar_connections
  add column if not exists watch_calendar_ids text[] not null default '{}'::text[];

comment on column public.google_calendar_connections.watch_calendar_ids is
  'Agendas que SO AVISAM: nao entram no freeBusy e nunca tiram horario do lead; sobreposicao vira aviso no CRM. Vazio = ninguem avisa.';

-- O aviso calculado quando o evento nasce, para a tela mostrar sem falar com o Google de novo.
alter table public.conversation_meeting_google_events
  add column if not exists overlap_warning text;

comment on column public.conversation_meeting_google_events.overlap_warning is
  'Aviso de sobreposicao com agenda de observacao no instante em que o evento foi criado (texto curto para a tela). Null = sem conflito conhecido.';
