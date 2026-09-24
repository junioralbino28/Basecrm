-- Conta de WhatsApp Business dona do dataset de mensagem (Meta CAPI).
--
-- Medido em 23/09/2026, com o primeiro clique real em anúncio da CENNO HUB: a Meta recusa o
-- evento de `business_messaging` que traz só o `ctwa_clid`. A matriz de teste (com
-- `test_event_code`, sem contar conversão) foi:
--
--   dataset da conta de WhatsApp + whatsapp_business_account_id -> ACEITO (events_received: 1)
--   dataset da conta de WhatsApp + page_id                      -> recusado, subcódigo 2804131
--   dataset da conta de WhatsApp + só o ctwa_clid               -> recusado, subcódigo 2804116
--   pixel de SITE               + whatsapp_business_account_id  -> recusado, subcódigo 2804132
--
-- Ou seja: o identificador tem que casar com o TIPO do dataset. Campanha de conversa no WhatsApp
-- não passa por pixel de site — o traqueamento inteiro fica na conta de WhatsApp.
--
-- Coluna nova, anulável e sem padrão: nenhuma organização muda de comportamento ao subir isto.
-- Quem não preencher continua exatamente como hoje (o envio falha do mesmo jeito que já falhava).

alter table public.organization_settings
  add column if not exists meta_capi_whatsapp_business_account_id text;

-- ⚠️ GRANT OBRIGATÓRIO. Esta tabela NÃO dá `select` amplo a `authenticated`: as permissões são
-- POR COLUNA (medido em 23/09/2026: 13 colunas com select, 23 com update). Coluna nova nasce sem
-- permissão nenhuma, e a tela devolveria `permission denied for table organization_settings` —
-- que parece erro de RLS e é erro de GRANT. Foi exatamente esse o defeito que deixou o token do
-- CAPI impossível de salvar desde sempre; sem estas linhas, o campo novo repetiria a história.
--
-- Espelha `meta_capi_dataset_id`, o campo análogo: ID público da conta, pode voltar ao navegador.
-- O token continua sendo a exceção — ele tem insert/update e NÃO tem select, de propósito.
grant select, insert, update, references (meta_capi_whatsapp_business_account_id)
  on public.organization_settings to authenticated;

grant insert, update, references (meta_capi_whatsapp_business_account_id)
  on public.organization_settings to anon;

comment on column public.organization_settings.meta_capi_whatsapp_business_account_id is
  'ID da conta de WhatsApp Business (WABA) dona do dataset de mensagem. Vai em user_data junto do '
  'ctwa_clid; sem ele a Meta recusa com error_subcode 2804116. Precisa ser a WABA vinculada ao '
  'dataset configurado em meta_capi_dataset_id, senão a recusa vira 2804132.';
