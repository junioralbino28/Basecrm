import { z } from 'zod';
import { runAutomationSimulationTest } from '@/lib/automations/builder';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { createStaticAdminClient } from '@/lib/supabase/server';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const TestSchema = z.object({
  threadId: z.string().uuid(),
}).strict();

export async function POST(
  req: Request,
  ctx: { params: Promise<{ tenantId: string; automationId: string }> },
) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const { tenantId, automationId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['automation.operate'],
  });
  if ('error' in auth) return auth.error;
  const parsed = TestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Conversa de teste inválida.' }, 400);

  try {
    const result = await runAutomationSimulationTest({
      db: createStaticAdminClient(),
      organizationId: tenantId,
      automationId,
      threadId: parsed.data.threadId,
    });
    return json({ ok: true, result });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'Falha ao testar automação.',
    }, 422);
  }
}
