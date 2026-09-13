/**
 * Conversions API for Business Messaging (Meta) — parte pura, sem banco.
 *
 * Doc lida na fonte em 13/09/2026 (developers.facebook.com/docs/marketing-api/
 * conversions-api/business-messaging): POST /{DATASET_ID}/events com
 * action_source 'business_messaging', messaging_channel 'whatsapp' e
 * user_data.ctwa_clid (nunca hasheado). event_time pode ter até 7 dias. A Meta NÃO
 * deduplica eventos de mensageria: o event_id vai sempre e quem garante "uma vez só"
 * é o nosso meta_event_id + status 'sent'.
 *
 * O que NUNCA sai daqui: telefone, nome, procedimento, texto de mensagem. Só a
 * etiqueta do clique, o nome do evento, a hora, o id e (opcional) valor + moeda.
 */

export const META_GRAPH_API_VERSION = (process.env.META_GRAPH_API_VERSION ?? '').trim() || 'v21.0';

/** Janela em que a Meta ainda aceita event_time (doc) e atribui o clique (7 dias). */
export const CTWA_ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Eventos aceitos pela Conversions API for Business Messaging (lista da doc, 13/09/2026). */
export const BUSINESS_MESSAGING_EVENT_NAMES = [
  'Purchase',
  'LeadSubmitted',
  'InitiateCheckout',
  'AddToCart',
  'ViewContent',
  'OrderCreated',
  'OrderShipped',
  'OrderDelivered',
  'OrderCanceled',
  'OrderReturned',
  'CartAbandoned',
  'QualifiedLead',
  'RatingProvided',
  'ReviewProvided',
] as const;

export type BusinessMessagingEventName = (typeof BUSINESS_MESSAGING_EVENT_NAMES)[number];

export function isBusinessMessagingEventName(value: unknown): value is BusinessMessagingEventName {
  return typeof value === 'string' && (BUSINESS_MESSAGING_EVENT_NAMES as readonly string[]).includes(value);
}

export type BusinessMessagingEvent = {
  event_name: BusinessMessagingEventName;
  /** Unix, em segundos, GMT. */
  event_time: number;
  event_id: string;
  action_source: 'business_messaging';
  messaging_channel: 'whatsapp';
  user_data: { ctwa_clid: string };
  custom_data?: { currency: string; value: number };
};

export function toUnixSeconds(value: string | Date) {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new Error('Data do evento inválida.');
  return Math.floor(ms / 1000);
}

export function buildBusinessMessagingEvent(input: {
  eventName: BusinessMessagingEventName;
  occurredAt: string | Date;
  eventId: string;
  ctwaClid: string;
  value?: number | null;
  currency?: string;
}): BusinessMessagingEvent {
  const ctwaClid = input.ctwaClid.trim();
  if (!ctwaClid) throw new Error('Etiqueta do clique vazia.');

  const event: BusinessMessagingEvent = {
    event_name: input.eventName,
    event_time: toUnixSeconds(input.occurredAt),
    event_id: input.eventId,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: { ctwa_clid: ctwaClid },
  };

  if (typeof input.value === 'number' && Number.isFinite(input.value) && input.value > 0) {
    event.custom_data = {
      currency: (input.currency ?? 'BRL').toUpperCase(),
      value: Math.round(input.value * 100) / 100,
    };
  }

  return event;
}

export type SendResult =
  | { ok: true; eventsReceived: number; fbtraceId: string | null }
  | { ok: false; permanent: boolean; status: number | null; code: number | null; message: string };

/**
 * Classifica o erro do Graph. Permanente = não adianta repetir (token, dataset,
 * parâmetro); transitório = repetir com espera (limite de taxa, 5xx, rede).
 */
export function classifyGraphError(status: number | null, body: unknown): { permanent: boolean; code: number | null; message: string } {
  const error =
    body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
      ? (body.error as Record<string, unknown>)
      : null;
  const code = typeof error?.code === 'number' ? error.code : null;
  const message =
    (typeof error?.message === 'string' && error.message) ||
    (status ? `HTTP ${status}` : 'Falha de rede ao falar com a Meta');

  if (error?.is_transient === true) return { permanent: false, code, message };
  if (status !== null && status >= 500) return { permanent: false, code, message };
  if (status === 429) return { permanent: false, code, message };
  // Limites de taxa do Graph vêm como 400 com estes códigos.
  if (code !== null && [2, 4, 17, 32, 341, 613].includes(code)) return { permanent: false, code, message };
  if (status === null) return { permanent: false, code, message };
  return { permanent: true, code, message };
}

export async function sendBusinessMessagingEvents(params: {
  datasetId: string;
  accessToken: string;
  events: BusinessMessagingEvent[];
  testEventCode?: string | null;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
}): Promise<SendResult> {
  const datasetId = params.datasetId.trim();
  const accessToken = params.accessToken.trim();
  if (!datasetId || !accessToken) {
    return { ok: false, permanent: true, status: null, code: null, message: 'Dataset ou token da Meta não configurado.' };
  }
  if (params.events.length === 0) return { ok: true, eventsReceived: 0, fbtraceId: null };

  const version = (params.graphVersion ?? META_GRAPH_API_VERSION).trim();
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(datasetId)}/events`;
  const body: Record<string, unknown> = {
    data: params.events,
    partner_agent: 'basecrm',
    // O token vai no corpo, nunca na URL: URL aparece em log de proxy e de servidor.
    access_token: accessToken,
  };
  const testEventCode = params.testEventCode?.trim();
  if (testEventCode) body.test_event_code = testEventCode;

  const doFetch = params.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      permanent: false,
      status: null,
      code: null,
      message: error instanceof Error ? error.message : 'Falha de rede ao falar com a Meta',
    };
  }

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const classified = classifyGraphError(response.status, json);
    return { ok: false, status: response.status, ...classified };
  }

  const received = typeof json?.events_received === 'number' ? json.events_received : params.events.length;
  return {
    ok: true,
    eventsReceived: received,
    fbtraceId: typeof json?.fbtrace_id === 'string' ? json.fbtrace_id : null,
  };
}
