-- =============================================================================
-- Domínio novo do CRM (crm.cennohub.com.br) na trava de origem do OAuth do Google (29/09)
--
-- Decisão do Junior (25/09): o CRM passa a morar em crm.cennohub.com.br. O endereço
-- antigo (crm.basea2.com) continua servindo por baixo até os webhooks e o relógio
-- migrarem, então as origens antigas ficam. Só acrescenta a nova; o código espelha
-- em lib/googleCalendar/oauth.ts (GOOGLE_CALENDAR_OAUTH_ALLOWED_ORIGINS).
-- =============================================================================

alter table public.google_oauth_states
  drop constraint google_oauth_states_redirect_origin_known;

alter table public.google_oauth_states
  add constraint google_oauth_states_redirect_origin_known
    check (redirect_origin in (
      'https://crm.cennohub.com.br',
      'https://crm.basea2.com',
      'https://teste.crm.basea2.com',
      'http://localhost:3000'
    ));
