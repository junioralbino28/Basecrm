import 'server-only';

import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserInfo,
  refreshGoogleAccessToken,
  revokeGoogleToken,
  type GoogleTokenResponse,
} from './googleApiClient';
import { readGoogleCalendarRefreshToken } from './connectionStore';
import type { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

/**
 * Escopos minimos, todos "sensitive" (nunca "restricted") — pesquisa confirmada na doc oficial.
 *
 * `calendar.calendarlist.readonly` entrou na Fatia 5: sem ele o `calendarList.list` devolve 403
 * (medido na conta real em 22/09) e nao da para OFERECER as agendas da pessoa na tela. Quem
 * conectou antes precisa reconectar uma vez — `scopeCoversCalendarList` e quem detecta isso.
 */
export const GOOGLE_CALENDAR_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

export const GOOGLE_CALENDAR_LIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';

/** A conexao guardada ja tem permissao de LISTAR agendas? (conexao antiga nao tem.) */
export function scopeCoversCalendarList(scope: string | null | undefined): boolean {
  return String(scope || '').split(/\s+/).includes(GOOGLE_CALENDAR_LIST_SCOPE);
}

const GOOGLE_CALENDAR_OAUTH_SCOPE = GOOGLE_CALENDAR_OAUTH_SCOPES.join(' ');

/** O Google exige redirect URI EXATO cadastrado no client OAuth. */
export const GOOGLE_CALENDAR_OAUTH_ALLOWED_ORIGINS = [
  'https://crm.basea2.com',
  'https://teste.crm.basea2.com',
  'http://localhost:3000',
] as const;

export function isAllowedGoogleOAuthOrigin(origin: string): boolean {
  return (GOOGLE_CALENDAR_OAUTH_ALLOWED_ORIGINS as readonly string[]).includes(origin);
}

export function buildGoogleCalendarRedirectUri(origin: string): string {
  return `${origin}/api/integrations/google-calendar/callback`;
}

export type GoogleCalendarOAuthEnv = { clientId: string; clientSecret: string };

/** `null` quando GOOGLE_OAUTH_CLIENT_ID/SECRET nao estao configurados (botao nao aparece, nada muda). */
export function resolveGoogleCalendarOAuthEnv(): GoogleCalendarOAuthEnv | null {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function buildGoogleCalendarAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_CALENDAR_OAUTH_SCOPE);
  // offline + consent: garante refresh_token mesmo numa reconexao (achado da pesquisa).
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', input.state);
  return url.toString();
}

export async function exchangeGoogleCalendarAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  return exchangeGoogleAuthorizationCode(input);
}

export async function fetchGoogleCalendarAccountEmail(accessToken: string): Promise<string | null> {
  const { email } = await fetchGoogleUserInfo({ accessToken });
  return email;
}

export async function revokeGoogleCalendarToken(token: string): Promise<boolean> {
  return revokeGoogleToken({ token });
}

type AccessTokenCacheEntry = { accessToken: string; expiresAt: number };

// Cache em memoria da INSTANCIA, por (organization_id, owner_id). Nunca persistido — a cada
// reinicio do processo o access token e renovado de novo a partir do refresh token (Vault).
const accessTokenCache = new Map<string, AccessTokenCacheEntry>();

function cacheKey(organizationId: string, ownerId: string): string {
  return `${organizationId}:${ownerId}`;
}

/** Só para os testes: evita vazamento de estado entre casos. */
export function clearGoogleCalendarAccessTokenCache(organizationId?: string, ownerId?: string): void {
  if (organizationId && ownerId) {
    accessTokenCache.delete(cacheKey(organizationId, ownerId));
    return;
  }
  accessTokenCache.clear();
}

const ACCESS_TOKEN_SAFETY_MARGIN_MS = 60_000;

/**
 * Devolve um access token valido para (organizationId, ownerId), renovando a partir do
 * refresh token guardado no Vault quando o cache expirou. `null` quando nao ha conexao
 * conectada — o chamador decide o que fazer (nunca lança so por falta de conexao).
 */
export async function getGoogleCalendarAccessToken(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string;
}): Promise<string | null> {
  const key = cacheKey(input.organizationId, input.ownerId);
  const cached = accessTokenCache.get(key);
  if (cached && cached.expiresAt - ACCESS_TOKEN_SAFETY_MARGIN_MS > Date.now()) {
    return cached.accessToken;
  }

  const env = resolveGoogleCalendarOAuthEnv();
  if (!env) return null;

  const refreshToken = await readGoogleCalendarRefreshToken({
    admin: input.admin,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
  });
  if (!refreshToken) return null;

  const token = await refreshGoogleAccessToken({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken,
  });

  accessTokenCache.set(key, {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1_000,
  });
  return token.access_token;
}
