import { createStaticAdminClient } from '@/lib/supabase/server';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { ConversationCalendarConfigSchema } from '@/lib/conversations/meetingAvailability';
import { redactChannelSecrets } from '@/lib/channels/redactChannelSecrets';
import { getGoogleCalendarConnection } from '@/lib/googleCalendar/connectionStore';
import { getGoogleCalendarAccessToken } from '@/lib/googleCalendar/oauth';
import { scopeCoversCalendarList } from '@/lib/googleCalendar/oauth';
import { GoogleApiError, listGoogleCalendars } from '@/lib/googleCalendar/googleApiClient';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Agendas da conta conectada, para a tela oferecer a escolha (Fatia 5).
 *
 * Nunca devolve token. Quem conectou antes do escopo `calendar.calendarlist.readonly` recebe
 * `needsReconnect: true` em vez de erro: a tela pede um clique de reconexao e segue.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  const { tenantId, connectionId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['whatsapp.manage_connection'],
  });
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();
  const connection = await admin
    .from('channel_connections')
    .select('id, config')
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .maybeSingle();
  if (connection.error) return json({ error: connection.error.message }, 500);
  if (!connection.data) return json({ error: 'Channel not found' }, 404);

  const calendar = ConversationCalendarConfigSchema.safeParse(
    (connection.data.config as Record<string, unknown> | null)?.calendar,
  );
  const ownerId = calendar.success ? calendar.data.ownerId : null;
  if (!ownerId) return json({ connected: false, needsReconnect: false, calendars: [] });

  const googleConnection = await getGoogleCalendarConnection({ admin, organizationId: tenantId, ownerId });
  if (!googleConnection || googleConnection.status !== 'connected') {
    return json({ connected: false, needsReconnect: false, calendars: [] });
  }
  // Sem o escopo novo nem adianta chamar: o Google responderia 403 (medido em 22/09).
  if (!scopeCoversCalendarList(googleConnection.scope)) {
    return json({ connected: true, needsReconnect: true, calendars: [] });
  }

  let accessToken: string | null = null;
  try {
    accessToken = await getGoogleCalendarAccessToken({ admin, organizationId: tenantId, ownerId });
    if (!accessToken) return json({ connected: true, needsReconnect: true, calendars: [] });

    const calendars = await listGoogleCalendars({ accessToken });
    return json({
      connected: true,
      needsReconnect: false,
      writeCalendarId: googleConnection.googleCalendarId,
      // O nome salvo vem junto: a tela consegue mostrar a agenda escolhida sem depender de
      // casar o id com a lista (achado do pareamento com a interface).
      writeCalendarSummary: googleConnection.googleCalendarSummary,
      busyCalendarIds: googleConnection.busyCalendarIds,
      calendars,
    });
  } catch (error) {
    const semPermissao = error instanceof GoogleApiError && (error.status === 403 || error.code === 'invalid_grant');
    if (semPermissao) return json({ connected: true, needsReconnect: true, calendars: [] });
    return json({
      error: redactChannelSecrets(error, [accessToken], 'Falha ao listar as agendas do Google.'),
    }, 502);
  }
}
