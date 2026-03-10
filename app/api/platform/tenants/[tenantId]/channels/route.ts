import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ChannelSchema = z.object({
  provider: z.literal('evolution'),
  channel_type: z.literal('whatsapp'),
  name: z.string().min(2).max(120),
  status: z.enum(['pending', 'connected', 'disconnected', 'error']).optional(),
  config: z.object({
    apiUrl: z.string().url().optional().or(z.literal('')),
    instanceName: z.string().max(120).optional(),
    webhookUrl: z.string().url().optional().or(z.literal('')),
    apiKey: z.string().max(300).optional(),
  }).optional(),
  metadata: z.object({
    phoneNumber: z.string().max(40).optional(),
    apiKeyLast4: z.string().max(12).optional(),
    notes: z.string().max(500).optional(),
  }).optional(),
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
    .from('channel_connections')
    .select('id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at')
    .eq('organization_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) return json({ error: error.message }, 500);
  return json({ channels: data || [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const { tenantId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = ChannelSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const now = new Date().toISOString();
  const config = {
    apiUrl: parsed.data.config?.apiUrl?.trim() || undefined,
    instanceName: parsed.data.config?.instanceName?.trim() || undefined,
    webhookUrl: parsed.data.config?.webhookUrl?.trim() || undefined,
    apiKey: parsed.data.config?.apiKey?.trim() || undefined,
  };
  const metadata = {
    phoneNumber: parsed.data.metadata?.phoneNumber?.trim() || undefined,
    apiKeyLast4:
      (parsed.data.config?.apiKey?.trim() || '').slice(-4) ||
      parsed.data.metadata?.apiKeyLast4?.trim() ||
      undefined,
    notes: parsed.data.metadata?.notes?.trim() || undefined,
  };

  const admin = createStaticAdminClient();
  const { data, error } = await admin
    .from('channel_connections')
    .insert({
      organization_id: tenantId,
      provider: parsed.data.provider,
      channel_type: parsed.data.channel_type,
      name: parsed.data.name.trim(),
      status: parsed.data.status ?? 'pending',
      config,
      metadata,
      created_at: now,
      updated_at: now,
    })
    .select('id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at')
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, channel: data }, 201);
}
