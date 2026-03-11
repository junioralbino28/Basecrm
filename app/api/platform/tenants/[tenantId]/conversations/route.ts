import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';
import { loadConversationInbox, loadConversationThreadInboxItem } from '@/lib/conversations/server';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ThreadSchema = z.object({
  title: z.string().min(2).max(160),
  contact_name: z.string().max(160).optional(),
  contact_phone: z.string().max(40).optional(),
  status: z.enum(['ai_active', 'human_queue', 'human_active', 'resolved', 'closed']).optional(),
  channel_connection_id: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['conversations.access'],
  });
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();
  try {
    const inbox = await loadConversationInbox(admin, tenantId);
    return json(inbox);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao carregar conversations.' }, 500);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { tenantId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['conversations.access'],
  });
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = ThreadSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const now = new Date().toISOString();
  const admin = createStaticAdminClient();

  const metadata = buildConversationThreadMetadataUpdate(parsed.data.metadata ?? {}, {
    unreadCount: 0,
    provider: null,
    routingMode: 'ai',
    humanLocked: false,
  });

  const { data, error } = await admin
    .from('conversation_threads')
    .insert({
      organization_id: tenantId,
      channel_connection_id: parsed.data.channel_connection_id ?? null,
      title: parsed.data.title.trim(),
      contact_name: parsed.data.contact_name?.trim() || null,
      contact_phone: parsed.data.contact_phone?.trim() || null,
      status: parsed.data.status ?? 'ai_active',
      metadata,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (error) return json({ error: error.message }, 500);

  try {
    const thread = await loadConversationThreadInboxItem(admin, tenantId, data.id);
    return json({ ok: true, thread }, 201);
  } catch (loadError) {
    return json({ error: loadError instanceof Error ? loadError.message : 'Falha ao carregar conversa criada.' }, 500);
  }
}
