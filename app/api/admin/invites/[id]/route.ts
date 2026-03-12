import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId');
  const scope = searchParams.get('scope') === 'agency' ? 'agency' : undefined;
  const supabase = await createClient();
  const auth = await requireAdminTenantContext({
    tenantId,
    scope,
  });
  if ('error' in auth) return auth.error;

  const { error } = await supabase
    .from('organization_invites')
    .delete()
    .eq('id', id)
    .eq('organization_id', auth.targetOrganizationId);

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
}
