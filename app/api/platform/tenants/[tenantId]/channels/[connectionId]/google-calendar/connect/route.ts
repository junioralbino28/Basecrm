import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { ConversationCalendarConfigSchema } from '@/lib/conversations/meetingAvailability';
import {
  buildGoogleCalendarAuthUrl,
  buildGoogleCalendarRedirectUri,
  isAllowedGoogleOAuthOrigin,
  resolveGoogleCalendarOAuthEnv,
} from '@/lib/googleCalendar/oauth';
import { createGoogleOAuthState } from '@/lib/googleCalendar/oauthState';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Inicia o consentimento do Google Agenda. POST (nao GET/302) de proposito: a critica de
 * seguranca do desenho apontou que uma rota GET navegavel de topo grava efeito colateral
 * (o state) sem o Origin real de um fetch same-origin — `isAllowedOrigin` so protege de
 * verdade quando o cliente chama por `fetch`, e o cliente faz `window.location = url`
 * so DEPOIS de receber a resposta.
 */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { tenantId, connectionId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['whatsapp.manage_connection'],
  });
  if ('error' in auth) return auth.error;

  const env = resolveGoogleCalendarOAuthEnv();
  if (!env) return json({ error: 'Integração do Google Agenda não está configurada.' }, 503);

  const admin = createStaticAdminClient();
  const connection = await admin
    .from('channel_connections')
    .select('id, config')
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .maybeSingle();
  if (connection.error) return json({ error: connection.error.message }, 500);
  if (!connection.data) return json({ error: 'Channel not found' }, 404);

  // ownerId SEMPRE lido do config ja salvo no servidor — nunca aceito do cliente.
  const calendar = ConversationCalendarConfigSchema.safeParse(
    (connection.data.config as Record<string, unknown> | null)?.calendar,
  );
  const ownerId = calendar.success ? calendar.data.ownerId : null;
  if (!ownerId) {
    return json({ error: 'Configure o responsável da agenda antes de conectar o Google Agenda.' }, 400);
  }

  const requestOrigin = new URL(req.url).origin;
  if (!isAllowedGoogleOAuthOrigin(requestOrigin)) {
    return json({ error: 'Este ambiente não está autorizado no cliente OAuth do Google.' }, 400);
  }

  let state;
  try {
    state = await createGoogleOAuthState({
      admin,
      organizationId: tenantId,
      channelConnectionId: connectionId,
      ownerId,
      requestedBy: auth.profile.id,
      redirectOrigin: requestOrigin,
    });
  } catch (error) {
    console.warn('[GoogleCalendar] Failed to create OAuth state', {
      tenantId,
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Não foi possível iniciar a conexão com o Google Agenda.' }, 500);
  }

  const url = buildGoogleCalendarAuthUrl({
    clientId: env.clientId,
    redirectUri: buildGoogleCalendarRedirectUri(requestOrigin),
    state: state.state,
  });

  return json({ url });
}
