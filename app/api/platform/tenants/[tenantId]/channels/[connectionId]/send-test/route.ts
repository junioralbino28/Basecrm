import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { toWhatsAppPhone } from '@/lib/phone';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const SendTestSchema = z.object({
  phone: z.string().min(8).max(40).optional(),
  text: z.string().min(1).max(1000).optional(),
}).strict();

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { tenantId, connectionId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['whatsapp.access'],
  });
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = SendTestSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const admin = createStaticAdminClient();

  const { data: connection, error } = await admin
    .from('channel_connections')
    .select('id, provider, channel_type, name, config, metadata')
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!connection) return json({ error: 'Connection not found' }, 404);
  if (connection.provider !== 'evolution' || connection.channel_type !== 'whatsapp') {
    return json({ error: 'Unsupported provider' }, 400);
  }

  const apiUrl = (connection.config as any)?.apiUrl;
  const instanceName = (connection.config as any)?.instanceName;
  const apiKey = (connection.config as any)?.apiKey;
  const sendMode = (connection.config as any)?.sendMode || 'auto';
  const phone = toWhatsAppPhone(parsed.data.phone || (connection.metadata as any)?.phoneNumber);
  const text =
    parsed.data.text?.trim() ||
    `Teste outbound Basecrm (${new Date().toLocaleString('pt-BR')})`;

  if (!apiUrl || !instanceName || !apiKey) {
    return json({ error: 'Connection requires apiUrl, instanceName and apiKey before send test.' }, 400);
  }
  if (!phone) {
    return json({ error: 'Provide a valid phone or configure a phoneNumber on this connection.' }, 400);
  }

  const attemptedAt = new Date().toISOString();

  try {
    const result = await sendEvolutionTextMessage({
      apiUrl,
      instanceName,
      apiKey,
      phone,
      text,
      sendMode,
    });

    const nextMetadata = {
      ...((connection.metadata as Record<string, unknown> | null) || {}),
      lastSendTestAt: attemptedAt,
      lastSendTestStatus: 'sent',
      lastSendTestError: null,
      lastSendTestAttempt: result.attemptLabel,
    };

    const { data: updated, error: updateError } = await admin
      .from('channel_connections')
      .update({
        metadata: nextMetadata,
        updated_at: attemptedAt,
      })
      .eq('id', connectionId)
      .eq('organization_id', tenantId)
      .select('id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at')
      .single();

    if (updateError) return json({ error: updateError.message }, 500);

    return json({
      ok: true,
      channel: updated,
      send_test: {
        attemptedAt,
        phone,
        text,
        attempt: result.attemptLabel,
        providerMessageId: result.providerMessageId,
      },
    });
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : 'Send test failed.';

    const { data: updated } = await admin
      .from('channel_connections')
      .update({
        metadata: {
          ...((connection.metadata as Record<string, unknown> | null) || {}),
          lastSendTestAt: attemptedAt,
          lastSendTestStatus: 'failed',
          lastSendTestError: message,
          lastSendTestAttempt: 'all-failed',
        },
        updated_at: attemptedAt,
      })
      .eq('id', connectionId)
      .eq('organization_id', tenantId)
      .select('id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at')
      .single();

    return json({ error: message, channel: updated || null }, 502);
  }
}
