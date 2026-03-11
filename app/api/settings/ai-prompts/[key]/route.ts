import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const supabase = await createClient();
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const { data, error } = await supabase
    .from('ai_prompt_templates')
    .select('key, content, version, is_active, created_at, updated_at, created_by')
    .eq('organization_id', auth.targetOrganizationId)
    .eq('key', key)
    .order('version', { ascending: false })
    .limit(20);

  if (error) return json({ error: error.message }, 500);

  const active = (data || []).find((row) => row.is_active) || null;
  return json({ key, active, versions: data || [] });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ key: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { key } = await ctx.params;
  const supabase = await createClient();
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const { error } = await supabase
    .from('ai_prompt_templates')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('organization_id', auth.targetOrganizationId)
    .eq('key', key)
    .eq('is_active', true);

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
}
