import 'server-only';

/**
 * Unico ponto de fetch para o Google (token endpoint, revoke, userinfo, freeBusy).
 * Todos os testes desta integracao mockam este arquivo — nenhum teste chama o Google real.
 */

const DEFAULT_TIMEOUT_MS = 8_000;
const FREEBUSY_DEFAULT_TIMEOUT_MS = 2_500;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';

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
