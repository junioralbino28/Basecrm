import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

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
  status: z.enum(['open', 'waiting', 'closed']).optional(),
  channel_connection_id: z.string().uuid().nullable().optional(),
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

export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const { tenantId } = await ctx.params;
  const admin = createStaticAdminClient();

  const { data, error } = await admin
    .from('conversation_threads')
    .select(`
      id,
      organization_id,
      channel_connection_id,
      contact_id,
      deal_id,
      title,
      contact_name,
      contact_phone,
      assigned_user_id,
      status,
      metadata,
      last_message_at,
      created_at,
      updated_at
    `)
    .eq('organization_id', tenantId)
    .order('updated_at', { ascending: false });

  if (error) return json({ error: error.message }, 500);
  return json({ threads: data || [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const { tenantId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = ThreadSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const now = new Date().toISOString();
  const admin = createStaticAdminClient();

  const { data, error } = await admin
    .from('conversation_threads')
    .insert({
      organization_id: tenantId,
      channel_connection_id: parsed.data.channel_connection_id ?? null,
      title: parsed.data.title.trim(),
      contact_name: parsed.data.contact_name?.trim() || null,
      contact_phone: parsed.data.contact_phone?.trim() || null,
      status: parsed.data.status ?? 'open',
      metadata: parsed.data.metadata ?? {},
      created_at: now,
      updated_at: now,
    })
    .select(`
      id,
      organization_id,
      channel_connection_id,
      contact_id,
      deal_id,
      title,
      contact_name,
      contact_phone,
      assigned_user_id,
      status,
      metadata,
      last_message_at,
      created_at,
      updated_at
    `)
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, thread: data }, 201);
}
