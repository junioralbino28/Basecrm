import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const MessageSchema = z.object({
  direction: z.enum(['inbound', 'outbound', 'internal']),
  message_type: z.string().min(1).max(50).optional(),
  author_name: z.string().max(160).optional(),
  content: z.string().min(1).max(4000),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

async function requireAdminProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: json({ error: 'Unauthorized' }, 401) };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (error || !profile?.organization_id) return { error: json({ error: 'Profile not found' }, 404) };
  if (profile.role !== 'admin') return { error: json({ error: 'Forbidden' }, 403) };

  return { profile };
}

export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string; threadId: string }> }) {
  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const { tenantId, threadId } = await ctx.params;
  const admin = createStaticAdminClient();

  const { data, error } = await admin
    .from('conversation_messages')
    .select('id, thread_id, organization_id, direction, message_type, author_name, content, metadata, sent_at, created_at')
    .eq('organization_id', tenantId)
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: true });

  if (error) return json({ error: error.message }, 500);
  return json({ messages: data || [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; threadId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const { tenantId, threadId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = MessageSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const now = new Date().toISOString();
  const admin = createStaticAdminClient();

  const thread = await admin
    .from('conversation_threads')
    .select('id')
    .eq('id', threadId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (thread.error) return json({ error: thread.error.message }, 500);
  if (!thread.data) return json({ error: 'Thread not found' }, 404);

  const { data, error } = await admin
    .from('conversation_messages')
    .insert({
      thread_id: threadId,
      organization_id: tenantId,
      direction: parsed.data.direction,
      message_type: parsed.data.message_type ?? 'text',
      author_name: parsed.data.author_name?.trim() || null,
      content: parsed.data.content.trim(),
      metadata: parsed.data.metadata ?? {},
      sent_at: now,
      created_at: now,
    })
    .select('id, thread_id, organization_id, direction, message_type, author_name, content, metadata, sent_at, created_at')
    .single();

  if (error) return json({ error: error.message }, 500);

  const updateThread = await admin
    .from('conversation_threads')
    .update({
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', threadId)
    .eq('organization_id', tenantId);

  if (updateThread.error) return json({ error: updateThread.error.message }, 500);

  return json({ ok: true, message: data }, 201);
}
