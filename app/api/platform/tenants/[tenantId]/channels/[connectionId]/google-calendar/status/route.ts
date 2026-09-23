import { createStaticAdminClient } from '@/lib/supabase/server';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { ConversationCalendarConfigSchema } from '@/lib/conversations/meetingAvailability';
import { resolveGoogleCalendarOAuthEnv, scopeCoversCalendarList } from '@/lib/googleCalendar/oauth';
import { getGoogleCalendarConnection } from '@/lib/googleCalendar/connectionStore';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Nunca devolve o token — so o que a tela precisa para desenhar o botao. */
export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  const { tenantId, connectionId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['whatsapp.manage_connection'],
  });
  if ('error' in auth) return auth.error;

  const configured = Boolean(resolveGoogleCalendarOAuthEnv());

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
  if (!ownerId) {
    return json({
      configured, connected: false, googleAccountEmail: null, status: null, connectedAt: null,
      writeCalendarId: null, writeCalendarSummary: null, busyCalendarIds: [], watchCalendarIds: [], canListCalendars: false,
    });
  }

  const googleConnection = await getGoogleCalendarConnection({ admin, organizationId: tenantId, ownerId });
  return json({
    configured,
    connected: googleConnection?.status === 'connected',
    googleAccountEmail: googleConnection?.googleAccountEmail ?? null,
    status: googleConnection?.status ?? null,
    connectedAt: googleConnection?.connectedAt ?? null,
    // Fatia 5: a tela precisa saber o que esta escolhido hoje e se da para OFERECER a lista —
    // quem conectou antes do escopo novo tem de reconectar uma vez.
    writeCalendarId: googleConnection?.googleCalendarId ?? null,
    writeCalendarSummary: googleConnection?.googleCalendarSummary ?? null,
    busyCalendarIds: googleConnection?.busyCalendarIds ?? [],
    watchCalendarIds: googleConnection?.watchCalendarIds ?? [],
    canListCalendars: scopeCoversCalendarList(googleConnection?.scope),
  });
}
