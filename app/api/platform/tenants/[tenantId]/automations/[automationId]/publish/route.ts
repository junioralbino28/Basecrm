import { AutomationCompileError } from '@/lib/automations/compiler';
import { publishAutomationDraft } from '@/lib/automations/publication';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { createStaticAdminClient } from '@/lib/supabase/server';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ tenantId: string; automationId: string }> },
) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const { tenantId, automationId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['automation.edit'],
  });
  if ('error' in auth) return auth.error;

  const db = createStaticAdminClient();
  const owned = await db
    .from('automations')
    .select('id')
    .eq('id', automationId)
    .eq('organization_id', tenantId)
    .maybeSingle();
  if (owned.error) return json({ error: owned.error.message }, 500);
  if (!owned.data) return json({ error: 'Automação não encontrada.' }, 404);

  try {
    const published = await publishAutomationDraft({
      db,
      automationId,
      actorId: auth.profile.id,
    });
    return json({
      ok: true,
      version: published.version.version,
      publishedAt: published.version.published_at,
    });
  } catch (error) {
    if (error instanceof AutomationCompileError) {
      return json({
        error: 'Revise o fluxo antes de publicar.',
        issues: error.issues,
      }, 422);
    }
    return json({
      error: error instanceof Error ? error.message : 'Falha ao publicar.',
    }, 500);
  }
}
