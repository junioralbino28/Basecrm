import 'server-only';

/**
 * Unico ponto de fetch para o Google (token endpoint, revoke, userinfo, freeBusy e eventos).
 * Todos os testes desta integracao mockam este arquivo — nenhum teste chama o Google real.
 */

const DEFAULT_TIMEOUT_MS = 8_000;
const FREEBUSY_DEFAULT_TIMEOUT_MS = 2_500;
/** Cada chamada do passo do tick tem tempo limite proprio: o tick inteiro cabe em 60 s. */
const EVENTS_DEFAULT_TIMEOUT_MS = 6_000;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';
const GOOGLE_CALENDAR_BASE_URL = 'https://www.googleapis.com/calendar/v3/calendars';

function eventsUrl(calendarId: string, eventId?: string): string {
  const base = `${GOOGLE_CALENDAR_BASE_URL}/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

export class GoogleApiError extends Error {
  status: number;
  /** Codigo `error` devolvido pelo Google (ex.: "invalid_grant"), quando houver. */
  code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
    this.code = code;
  }
}

async function requestGoogleApi(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readGoogleErrorBody(response: Response): Promise<{ code: string | null; message: string }> {
  const text = await response.text().catch(() => '');
  if (!text) return { code: null, message: `Google respondeu ${response.status}.` };
  try {
    const body = JSON.parse(text) as { error?: unknown; error_description?: unknown };
    const code = typeof body.error === 'string' ? body.error : null;
    const description = typeof body.error_description === 'string' ? body.error_description : null;
    return { code, message: description || code || `Google respondeu ${response.status}.` };
  } catch {
    return { code: null, message: `Google respondeu ${response.status}.` };
  }
}

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export async function exchangeGoogleAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  timeoutMs?: number;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await requestGoogleApi(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, input.timeoutMs);
  if (!response.ok) {
    const { code, message } = await readGoogleErrorBody(response);
    throw new GoogleApiError(message, response.status, code);
  }
  return response.json() as Promise<GoogleTokenResponse>;
}

export async function refreshGoogleAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  timeoutMs?: number;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await requestGoogleApi(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, input.timeoutMs);
  if (!response.ok) {
    const { code, message } = await readGoogleErrorBody(response);
    throw new GoogleApiError(message, response.status, code);
  }
  return response.json() as Promise<GoogleTokenResponse>;
}

/** Melhor esforço: nunca lança. Usado no disconnect (a desconexão local acontece de qualquer jeito). */
export async function revokeGoogleToken(input: { token: string; timeoutMs?: number }): Promise<boolean> {
  try {
    const response = await requestGoogleApi(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: input.token }).toString(),
    }, input.timeoutMs);
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchGoogleUserInfo(input: {
  accessToken: string;
  timeoutMs?: number;
}): Promise<{ email: string | null }> {
  const response = await requestGoogleApi(GOOGLE_USERINFO_URL, {
    method: 'GET',
    headers: { authorization: `Bearer ${input.accessToken}` },
  }, input.timeoutMs);
  if (!response.ok) {
    const { code, message } = await readGoogleErrorBody(response);
    throw new GoogleApiError(message, response.status, code);
  }
  const body = (await response.json().catch(() => null)) as { email?: unknown } | null;
  const email = body && typeof body.email === 'string' ? body.email : null;
  return { email };
}

export type GoogleFreeBusyInterval = { start: string; end: string };

export async function queryGoogleFreeBusy(input: {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timeoutMs?: number;
}): Promise<GoogleFreeBusyInterval[]> {
  const response = await requestGoogleApi(GOOGLE_FREEBUSY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify({
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      items: [{ id: input.calendarId }],
    }),
  }, input.timeoutMs ?? FREEBUSY_DEFAULT_TIMEOUT_MS);

  if (!response.ok) {
    const { code, message } = await readGoogleErrorBody(response);
    throw new GoogleApiError(message, response.status, code);
  }

  // Sem `.catch` de propósito: um 200 com corpo malformado deve lançar (JSON ruim é um dos
  // casos de teste exigidos) para o chamador cair no mesmo tratamento de falha.
  const body = (await response.json()) as {
    calendars?: Record<string, { busy?: Array<{ start?: unknown; end?: unknown }> }>;
  };
  const busy = body.calendars?.[input.calendarId]?.busy;
  if (!Array.isArray(busy)) return [];

  return busy
    .map((entry) => ({ start: String(entry?.start || ''), end: String(entry?.end || '') }))
    .filter((interval) => interval.start && interval.end);
}

// ------------------------------------------------------------------ eventos (Fatias 3 e 4)

/** So o que a Aurora usa da resposta do Google; o resto do evento e ignorado de proposito. */
export type GoogleCalendarEvent = {
  id: string | null;
  status: string | null;
  hangoutLink: string | null;
  /** `pending` enquanto o Meet nao ficou pronto; `success` quando ficou. */
  conferenceStatus: string | null;
};

function mapGoogleEvent(body: unknown): GoogleCalendarEvent {
  const event = (body || {}) as {
    id?: unknown;
    status?: unknown;
    hangoutLink?: unknown;
    conferenceData?: {
      createRequest?: { status?: { statusCode?: unknown } };
      entryPoints?: Array<{ entryPointType?: unknown; uri?: unknown }>;
    };
  };

  // O link mora em `hangoutLink` e tambem em conferenceData.entryPoints[type=video]; o
  // segundo e o que aparece primeiro em alguns casos, entao vale como reserva.
  const entryPointUri = Array.isArray(event.conferenceData?.entryPoints)
    ? event.conferenceData?.entryPoints.find((entry) => entry?.entryPointType === 'video')?.uri
    : null;

  return {
    id: typeof event.id === 'string' ? event.id : null,
    status: typeof event.status === 'string' ? event.status : null,
    hangoutLink: typeof event.hangoutLink === 'string' && event.hangoutLink
      ? event.hangoutLink
      : typeof entryPointUri === 'string' && entryPointUri
        ? entryPointUri
        : null,
    conferenceStatus: typeof event.conferenceData?.createRequest?.status?.statusCode === 'string'
      ? event.conferenceData.createRequest.status.statusCode
      : null,
  };
}

export type GoogleCalendarEventInput = {
  summary: string;
  description: string;
  startAt: string;
  endAt: string;
  timezone: string;
  /**
   * Convidados do evento: o lead (quando informou e-mail valido) e os fixos da conexao. Lista
   * vazia = nenhum `attendees` no corpo, e o evento entra so na agenda do responsavel.
   */
  attendeeEmails?: string[];
  /** Identificador unico por tentativa de Meet; o Google exige que nao se reuse. */
  conferenceRequestId?: string | null;
  /**
   * Id escolhido por nos para o evento (base32hex, 5-1024 caracteres). Torna o
   * `events.insert` idempotente: a retentativa de um insert que ja tinha dado certo do
   * lado do Google recebe 409 em vez de criar um segundo evento e um segundo convite.
   */
  eventId?: string | null;
};

function buildEventBody(input: GoogleCalendarEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startAt, timeZone: input.timezone },
    end: { dateTime: input.endAt, timeZone: input.timezone },
  };
  if (input.eventId) body.id = input.eventId;
  if (input.attendeeEmails && input.attendeeEmails.length > 0) {
    body.attendees = input.attendeeEmails.map((email) => ({ email }));
  }
  if (input.conferenceRequestId) {
    body.conferenceData = {
      createRequest: {
        requestId: input.conferenceRequestId,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }
  return body;
}

/**
 * Cria o evento com Google Meet. `conferenceDataVersion=1` e obrigatorio na QUERY: sem ele o
 * Google ignora `conferenceData` em silencio. `sendUpdates=all` e o que faz o convite por e-mail
 * sair do proprio Google para o convidado externo.
 */
export async function insertGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  event: GoogleCalendarEventInput;
  sendUpdates: 'all' | 'none';
  timeoutMs?: number;
}): Promise<GoogleCalendarEvent> {
  const url = new URL(eventsUrl(input.calendarId));
  url.searchParams.set('conferenceDataVersion', '1');
  url.searchParams.set('sendUpdates', input.sendUpdates);

  const response = await requestGoogleApi(url.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify(buildEventBody(input.event)),
  }, input.timeoutMs ?? EVENTS_DEFAULT_TIMEOUT_MS);

  if (!response.ok) {
    const { code, message } = await readGoogleErrorBody(response);
    throw new GoogleApiError(message, response.status, code);
  }
  return mapGoogleEvent(await response.json());
}

/** Remarcacao: mesmo evento, horario novo, e o Google avisa o convidado (sendUpdates=all). */
export async function patchGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  event: GoogleCalendarEventInput;
  timeoutMs?: number;
}): Promise<GoogleCalendarEvent> {
  const url = new URL(eventsUrl(input.calendarId, input.eventId));
  url.searchParams.set('conferenceDataVersion', '1');
  url.searchParams.set('sendUpdates', 'all');

  const response = await requestGoogleApi(url.toString(), {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify(buildEventBody(input.event)),
  }, input.timeoutMs ?? EVENTS_DEFAULT_TIMEOUT_MS);

  if (!response.ok) {
    const { code, message } = await readGoogleErrorBody(response);
    throw new GoogleApiError(message, response.status, code);
  }
  return mapGoogleEvent(await response.json());
}

/** Releitura: Meet ainda `pending` (Fatia 3) e conferencia antes do lembrete (Fatia 4). */
export async function getGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  timeoutMs?: number;
}): Promise<GoogleCalendarEvent> {
  const response = await requestGoogleApi(eventsUrl(input.calendarId, input.eventId), {
    method: 'GET',
    headers: { authorization: `Bearer ${input.accessToken}` },
  }, input.timeoutMs ?? EVENTS_DEFAULT_TIMEOUT_MS);

  if (!response.ok) {
    const { code, message } = await readGoogleErrorBody(response);
    throw new GoogleApiError(message, response.status, code);
  }
  return mapGoogleEvent(await response.json());
}

/**
 * Cancelamento. 404/410 (evento ja apagado no Google) NAO e erro: o destino ja e o desejado,
 * entao devolve `true` do mesmo jeito e a linha fecha como `cancelled`.
 */
export async function deleteGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const url = new URL(eventsUrl(input.calendarId, input.eventId));
  url.searchParams.set('sendUpdates', 'all');

  const response = await requestGoogleApi(url.toString(), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${input.accessToken}` },
  }, input.timeoutMs ?? EVENTS_DEFAULT_TIMEOUT_MS);

  if (response.ok || response.status === 404 || response.status === 410) return true;

  const { code, message } = await readGoogleErrorBody(response);
  throw new GoogleApiError(message, response.status, code);
}
