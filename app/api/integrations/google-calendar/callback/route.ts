import { NextResponse } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { redactChannelSecrets } from '@/lib/channels/redactChannelSecrets';
import {
  buildGoogleCalendarRedirectUri,
  exchangeGoogleCalendarAuthorizationCode,
  fetchGoogleCalendarAccountEmail,
  resolveGoogleCalendarOAuthEnv,
} from '@/lib/googleCalendar/oauth';
import { claimGoogleOAuthState, peekGoogleOAuthState } from '@/lib/googleCalendar/oauthState';
import { writeGoogleCalendarConnection } from '@/lib/googleCalendar/connectionStore';
import { requeueFailedGoogleMeetingEvents } from '@/lib/googleCalendar/eventSync';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function channelsUrl(origin: string, organizationId: string, query: string): string {
  return `${origin}/platform/tenants/${organizationId}/channels?${query}`;
}

function genericError(): Response {
  return new Response(
    'Link do Google inválido ou expirado. Feche esta aba e conecte novamente pelo CRM.',
    { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
}

/**
 * Callback PUBLICO do OAuth do Google (o Google chama sem cookie de sessao). `state` e a
 * unica coisa em que se confia: organization_id/channel_connection_id/owner_id vem SEMPRE
 * dele, nunca de query string. Uso unico — `claimGoogleOAuthState` marca consumido ANTES
 * de trocar o code. Nunca token na URL de redirecionamento nem em log.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const googleError = url.searchParams.get('error');

  if (!state || !UUID_PATTERN.test(state)) return genericError();

  const admin = createStaticAdminClient();
  const known = await peekGoogleOAuthState({ admin, state }).catch(() => null);
  if (!known) return genericError();

  const backTo = (query: string) => NextResponse.redirect(channelsUrl(origin, known.organizationId, query));

  if (googleError) {
    console.warn('[GoogleCalendar] OAuth consent denied or errored', {
      organizationId: known.organizationId,
      ownerId: known.ownerId,
      error: googleError,
    });
    return backTo('google=erro');
  }
  if (!code) return backTo('google=erro');

  const claimed = await claimGoogleOAuthState({ admin, state }).catch(() => null);
  if (!claimed) {
    // Ausente (nunca existiu), expirado ou ja consumido — mesmo destino, sem detalhar
    // qual dos tres para nao ajudar um ataque de replay a diagnosticar o motivo.
    return backTo('google=erro');
  }

  const env = resolveGoogleCalendarOAuthEnv();
  if (!env) return backTo('google=erro');

  try {
    const redirectUri = buildGoogleCalendarRedirectUri(claimed.redirectOrigin);
    const tokens = await exchangeGoogleCalendarAuthorizationCode({
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      code,
      redirectUri,
    });
    if (!tokens.refresh_token) {
      throw new Error('Google não devolveu refresh_token; reconecte (prompt=consent deveria garantir um novo).');
    }

    const email = await fetchGoogleCalendarAccountEmail(tokens.access_token);
    if (!email) throw new Error('Não foi possível ler o e-mail da conta Google conectada.');

    await writeGoogleCalendarConnection({
      admin,
      organizationId: claimed.organizationId,
      ownerId: claimed.ownerId,
      googleAccountEmail: email,
      googleCalendarId: 'primary',
      refreshToken: tokens.refresh_token,
      scope: tokens.scope || '',
    });

    // Reconectou: as reunioes FUTURAS que morreram como `failed` enquanto o token estava
    // invalido voltam para a fila. Sem isto, `failed` era terminal e cada uma so daria o aviso
    // "sem link do Google" 15 min antes da hora (achado alto da revisao de correcao).
    await requeueFailedGoogleMeetingEvents({
      admin,
      organizationId: claimed.organizationId,
      ownerId: claimed.ownerId,
    });

    return backTo('google=ok');
  } catch (error) {
    console.warn('[GoogleCalendar] OAuth callback failed', {
      organizationId: claimed.organizationId,
      ownerId: claimed.ownerId,
      error: redactChannelSecrets(error, [code], 'Falha ao conectar o Google Agenda.'),
    });
    return backTo('google=erro');
  }
}
