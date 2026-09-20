import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ tenantId: string; connectionId: string; blockId: string }> },
) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const { tenantId, connectionId, blockId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['whatsapp.manage_connection'],
  });
  if ('error' in auth) return auth.error;

  const result = await createStaticAdminClient()
    .from('conversation_calendar_blocks')
    .delete()
    .eq('id', blockId)
    .eq('organization_id', tenantId)
    .eq('channel_connection_id', connectionId)
    .select('id');
  if (result.error) return json({ error: result.error.message }, 500);
  if (!result.data?.length) return json({ error: 'Bloqueio não encontrado.' }, 404);
  return json({ ok: true, deleted: { id: blockId } });
}
