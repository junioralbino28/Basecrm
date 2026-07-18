import { z } from 'zod';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { createStaticAdminClient } from '@/lib/supabase/server';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const TemplateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  body: z.string().trim().min(1).max(4096),
}).strict();

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
  const parsed = TemplateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Mensagem da biblioteca inválida.' }, 400);

  const inserted = await createStaticAdminClient()
    .from('message_templates')
    .insert({
      organization_id: tenantId,
      name: parsed.data.name,
      body: parsed.data.body,
      channel: 'whatsapp',
      variables: [],
      created_by: auth.profile.id,
    })
    .select('id, name, channel, body, revision, updated_at')
    .single();
  if (inserted.error) return json({ error: inserted.error.message }, 500);
  return json({
    template: {
      id: inserted.data.id,
      name: inserted.data.name,
      channel: inserted.data.channel,
      body: inserted.data.body,
      revision: inserted.data.revision,
      updatedAt: inserted.data.updated_at,
    },
  }, 201);
}
