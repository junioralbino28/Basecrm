import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { saveAutomationDraft } from '@/lib/automations/builder';
import { loadAutomationWorkspace } from '@/lib/automations/workspace';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
}).strict();

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['automation.operate'],
  });
  if ('error' in auth) return auth.error;

  try {
    const workspace = await loadAutomationWorkspace(
      createStaticAdminClient(),
      tenantId,
    );
    return json({
      ...workspace,
      access: {
        canEdit: auth.permissions['automation.edit'],
        canOperate: auth.permissions['automation.operate'],
      },
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'Falha ao carregar automações.',
    }, 500);
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ tenantId: string }> },
) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const { tenantId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['automation.edit'],
  });
  if ('error' in auth) return auth.error;

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'Nome da automação inválido.' }, 400);
  }

  const firstStepKey = randomUUID();
  try {
    const saved = await saveAutomationDraft({
      db: createStaticAdminClient(),
      organizationId: tenantId,
      actorId: auth.profile.id,
      draft: {
        id: null,
        name: parsed.data.name,
        triggerConfig: { tag: '' },
        steps: [{
          stepKey: firstStepKey,
          stepType: 'send_message',
          sortKey: 0,
          config: {
            link_mode: 'copied',
            body_local: '',
            message_kind: 'text',
            channel: 'whatsapp',
          },
        }],
        edges: [],
      },
    });
    const workspace = await loadAutomationWorkspace(
      createStaticAdminClient(),
      tenantId,
    );
    const automation = workspace.automations.find(
      (item) => item.id === saved.automationId,
    );
    return json({ automation }, 201);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'Falha ao criar automação.',
    }, 500);
  }
}
