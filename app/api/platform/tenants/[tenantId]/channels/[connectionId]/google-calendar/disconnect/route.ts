import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { ConversationCalendarConfigSchema } from '@/lib/conversations/meetingAvailability';
import { revokeGoogleCalendarToken, clearGoogleCalendarAccessTokenCache } from '@/lib/googleCalendar/oauth';
import {
  deleteGoogleCalendarConnection,
  readGoogleCalendarRefreshToken,
} from '@/lib/googleCalendar/connectionStore';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

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
  if (!ownerId) return json({ error: 'Nenhuma agenda configurada para desconectar.' }, 400);

  // Revogar no Google e melhor esforco: a desconexao local acontece de qualquer jeito
  // (mesmo idioma do logout best-effort da Evolution nesta mesma rota de canais).
  let revokeWarning: string | null = null;
  try {
    const refreshToken = await readGoogleCalendarRefreshToken({ admin, organizationId: tenantId, ownerId });
    if (refreshToken) {
      const revoked = await revokeGoogleCalendarToken(refreshToken);
      if (!revoked) revokeWarning = 'Não foi possível confirmar a revogação no Google; a conexão local foi removida.';
    }
  } catch (error) {
    revokeWarning = error instanceof Error ? error.message : 'Falha ao revogar no Google.';
  }

  try {
    await deleteGoogleCalendarConnection({ admin, organizationId: tenantId, ownerId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao desconectar o Google Agenda.' }, 500);
  }

  clearGoogleCalendarAccessTokenCache(tenantId, ownerId);

  return json({ ok: true, warning: revokeWarning });
}
