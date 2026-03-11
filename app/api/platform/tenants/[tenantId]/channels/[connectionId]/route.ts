import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ChannelUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  status: z.enum(['pending', 'connected', 'disconnected', 'error']).optional(),
  config: z.object({
    apiUrl: z.string().url().optional().or(z.literal('')),
    instanceName: z.string().max(120).optional(),
    webhookUrl: z.string().url().optional().or(z.literal('')),
    webhookSecret: z.string().max(120).optional(),
    apiKey: z.string().max(300).optional(),
    sendMode: z.enum(['auto', 'number_text', 'number_textMessage', 'number_message', 'number_body']).optional(),
  }).optional(),
  metadata: z.object({
    phoneNumber: z.string().max(40).optional(),
    apiKeyLast4: z.string().max(12).optional(),
    notes: z.string().max(500).optional(),
  }).optional(),
  last_healthcheck_at: z.string().datetime().nullable().optional(),
}).strict();

export async function PATCH(req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { tenantId, connectionId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['whatsapp.manage_connection'],
  });
  if ('error' in auth) return auth.error;
  const body = await req.json().catch(() => null);
  const parsed = ChannelUpdateSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const admin = createStaticAdminClient();
  const current = await admin
      .from('channel_connections')
    .select('id, config, metadata')
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (current.error) return json({ error: current.error.message }, 500);
  if (!current.data) return json({ error: 'Channel not found' }, 404);

  const nextConfig = parsed.data.config
    ? {
        ...(current.data.config || {}),
        apiUrl: parsed.data.config.apiUrl?.trim() || undefined,
        instanceName: parsed.data.config.instanceName?.trim() || undefined,
        webhookUrl: parsed.data.config.webhookUrl?.trim() || undefined,
        sendMode: parsed.data.config.sendMode || (current.data.config as any)?.sendMode || 'auto',
        webhookSecret:
          parsed.data.config.webhookSecret?.trim() ||
          (current.data.config as any)?.webhookSecret ||
          crypto.randomUUID().replace(/-/g, ''),
        apiKey: parsed.data.config.apiKey?.trim() || (current.data.config as any)?.apiKey || undefined,
      }
    : current.data.config;

  const nextMetadata = parsed.data.metadata
    ? {
        ...(current.data.metadata || {}),
        phoneNumber: parsed.data.metadata.phoneNumber?.trim() || undefined,
        apiKeyLast4:
          (parsed.data.config?.apiKey?.trim() || '').slice(-4) ||
          parsed.data.metadata.apiKeyLast4?.trim() ||
          (current.data.metadata as any)?.apiKeyLast4 ||
          undefined,
        notes: parsed.data.metadata.notes?.trim() || undefined,
      }
    : current.data.metadata;

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.last_healthcheck_at !== undefined) updates.last_healthcheck_at = parsed.data.last_healthcheck_at;
  if (parsed.data.config !== undefined) updates.config = nextConfig;
  if (parsed.data.metadata !== undefined) updates.metadata = nextMetadata;

  const { data, error } = await admin
    .from('channel_connections')
    .update(updates)
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .select('id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at')
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, channel: data });
}
