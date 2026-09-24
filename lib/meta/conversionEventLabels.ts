/**
 * Tradução dos 14 nomes de evento aceitos pela Conversions API for Business Messaging (3c),
 * para ninguém se confundir depois: o nome é só um rótulo para a Meta; o que ele significa
 * para nós está aqui, no comentário da coluna `organization_settings.meta_capi_event_map`
 * (migration 20260913060000) e em docs/features/conversao-meta/SPEC.md.
 *
 * Escada padrão decidida pelo Junior em 13/09 (por cliente, alterável na configuração):
 *   respondeu → LeadSubmitted · agendou → QualifiedLead · compareceu → InitiateCheckout ·
 *   fechou → Purchase.
 */
import { BUSINESS_MESSAGING_EVENT_NAMES } from './conversionsApi';

export type BusinessMessagingEventName = (typeof BUSINESS_MESSAGING_EVENT_NAMES)[number];

export type ConversionEventType = 'replied' | 'scheduled' | 'attended' | 'won';

export const BUSINESS_MESSAGING_EVENT_LABELS_PT: Record<BusinessMessagingEventName, string> = {
  LeadSubmitted: 'Lead enviado (usamos para: respondeu)',
  QualifiedLead: 'Lead qualificado (usamos para: agendou)',
  InitiateCheckout: 'Começou a finalizar a compra (usamos para: compareceu ao que foi marcado)',
  Purchase: 'Compra (usamos para: fechou)',
  AddToCart: 'Adicionou ao carrinho',
  ViewContent: 'Viu conteúdo',
  CartAbandoned: 'Abandonou o carrinho',
  OrderCreated: 'Pedido criado',
  OrderShipped: 'Pedido enviado',
  OrderDelivered: 'Pedido entregue',
  OrderCanceled: 'Pedido cancelado',
  OrderReturned: 'Pedido devolvido',
  RatingProvided: 'Deu nota',
  ReviewProvided: 'Escreveu avaliação',
};

/**
 * Estes rótulos aparecem na TELA de configuração, e o CRM atende vários ramos: agência,
 * videomonitoramento, clínica, e-commerce. Até 23/09/2026 diziam "a clínica falar", "consulta
 * marcada" e "veio à consulta" — vocabulário de um cliente só, que confunde todos os outros.
 * Mantêm-se genéricos de propósito; quem quiser o nome do próprio ramo muda o mapa de eventos.
 */
export const CONVERSION_EVENT_TYPE_LABELS_PT: Record<ConversionEventType, string> = {
  replied: 'Respondeu (o lead voltou a falar depois do primeiro contato)',
  scheduled: 'Agendou (reunião ou consulta marcada)',
  attended: 'Compareceu (participou do que foi marcado)',
  won: 'Fechou (negócio ganho)',
};

/** Escada padrão: marco do negócio → nome do evento na Meta. `null` = não enviar. */
export const DEFAULT_CONVERSION_EVENT_MAP: Record<ConversionEventType, BusinessMessagingEventName | null> = {
  replied: 'LeadSubmitted',
  scheduled: 'QualifiedLead',
  attended: 'InitiateCheckout',
  won: 'Purchase',
};
