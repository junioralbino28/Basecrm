import { z } from 'zod';
import { AUTOMATION_EDGE_OUTCOMES, AUTOMATION_STEP_TYPES } from '@/lib/automations/compiler';
import { saveAutomationDraft } from '@/lib/automations/builder';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { loadAutomationWorkspace } from '@/lib/automations/workspace';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const DraftSchema = z.object({
  name: z.string().trim().min(2).max(160),
  draftRevision: z.number().int().positive(),
  triggerConfig: z.record(z.string(), z.unknown()),
  steps: z.array(z.object({
    stepKey: z.string().uuid(),
    stepType: z.enum(AUTOMATION_STEP_TYPES),
    config: z.record(z.string(), z.unknown()),
    sortKey: z.number().int().nonnegative(),
  }).strict()).max(100),
  edges: z.array(z.object({
    fromStepKey: z.string().uuid(),
    outcome: z.enum(AUTOMATION_EDGE_OUTCOMES),
    toStepKey: z.string().uuid(),
    order: z.number().int().nonnegative(),
  }).strict()).max(300),
}).strict();

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ tenantId: string; automationId: string }> },
) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const { tenantId, automationId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['automation.edit'],
  });
  if ('error' in auth) return auth.error;

  const parsed = DraftSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'Draft inválido.', details: parsed.error.flatten() }, 400);
  }

  try {
    const db = createStaticAdminClient();
    await saveAutomationDraft({
      db,
      organizationId: tenantId,
      actorId: auth.profile.id,
      draft: {
        id: automationId,
        ...parsed.data,
      },
    });
    const workspace = await loadAutomationWorkspace(db, tenantId);
    const automation = workspace.automations.find(
      (item) => item.id === automationId,
    );
    if (!automation) return json({ error: 'Automação não encontrada.' }, 404);
    return json({ automation });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'Falha ao salvar draft.',
    }, 500);
  }
}
