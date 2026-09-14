-- 3c (decisão do Junior, 13/09) — "compareceu" passa a ir à Meta como InitiateCheckout.
--
-- A lista de eventos da Conversions API for Business Messaging não tem nada que signifique
-- "compareceu à consulta". O Junior escolheu InitiateCheckout ("começou a finalizar a compra"):
-- quem compareceu à consulta ao menos vai pagar por ela. Para ninguém se confundir depois, a
-- tradução de cada nome fica gravada aqui (comentário da coluna), em `lib/meta/conversionEventLabels.ts`
-- e em docs/features/conversao-meta/SPEC.md.
--
-- Escada padrão (por cliente, alterável em /api/settings/meta-capi):
--   respondeu  → LeadSubmitted     (lead enviado)
--   agendou    → QualifiedLead     (lead qualificado)
--   compareceu → InitiateCheckout  (começou a finalizar a compra)
--   fechou     → Purchase          (compra)
--
-- Só o padrão e as linhas que ainda estavam sem nome para "compareceu" mudam; quem já tiver
-- escolhido outro nome não é tocado. Nenhum marco antigo é reenviado (os "skipped nao_mapeado"
-- ficam como estão: a janela de 7 dias já os teria vencido).

alter table public.organization_settings
  alter column meta_capi_event_map
  set default '{"replied": "LeadSubmitted", "scheduled": "QualifiedLead", "attended": "InitiateCheckout", "won": "Purchase"}'::jsonb;

update public.organization_settings
set meta_capi_event_map = coalesce(meta_capi_event_map, '{}'::jsonb) || '{"attended": "InitiateCheckout"}'::jsonb,
    updated_at = now()
where coalesce(meta_capi_event_map->>'attended', '') = '';

comment on column public.organization_settings.meta_capi_event_map is
  'Nome do evento da Meta (Conversions API for Business Messaging) por marco do negócio. '
  'Tradução: LeadSubmitted = lead enviado (respondeu) · QualifiedLead = lead qualificado (agendou) · '
  'InitiateCheckout = começou a finalizar a compra (compareceu à consulta) · Purchase = compra (fechou) · '
  'AddToCart = adicionou ao carrinho · ViewContent = viu conteúdo · CartAbandoned = abandonou o carrinho · '
  'OrderCreated/OrderShipped/OrderDelivered/OrderCanceled/OrderReturned = pedido criado/enviado/entregue/cancelado/devolvido · '
  'RatingProvided = deu nota · ReviewProvided = escreveu avaliação. null = marco não é enviado.';
