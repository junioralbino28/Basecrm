import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { redactChannelSecrets } from '@/lib/channels/redactChannelSecrets';
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

  const instanceName = (connection.config as any)?.instanceName;
  let resolved: Awaited<ReturnType<typeof resolveEvolutionCredentials>> = null;
  try {
    resolved = await resolveEvolutionCredentials({
      admin,
      tenantId,
      connectionConfig: (connection.config as Record<string, unknown> | null) || {},
      profileRole: auth.profile.role,
      requesterOrganizationId: auth.profile.organization_id,
    });
  } catch {
    return json(
      {
        error: 'Failed to resolve Evolution credentials for send test.',
      },
      500
    );
  }
  const sendMode = (connection.config as any)?.sendMode || 'auto';
  const phone = toWhatsAppPhone(parsed.data.phone || (connection.metadata as any)?.phoneNumber);
  const text =
    parsed.data.text?.trim() ||
    `Teste outbound Basecrm (${new Date().toLocaleString('pt-BR')})`;

  if (!instanceName || !resolved?.apiUrl || !resolved.apiKey) {
    return json(
      {
        error:
          'Connection requires instanceName and Evolution credentials (connection config or agency defaults) before send test.',
      },
      400
    );
  }
  if (!phone) {
    return json({ error: 'Provide a valid phone or configure a phoneNumber on this connection.' }, 400);
  }

  const attemptedAt = new Date().toISOString();

  try {
    const result = await sendEvolutionTextMessage({
      apiUrl: resolved.apiUrl,
      instanceName,
      apiKey: resolved.apiKey,
      phone,
      text,
      sendMode,
    });

    const nextMetadata = {
      ...((connection.metadata as Record<string, unknown> | null) || {}),
      lastSendTestAt: attemptedAt,
      lastSendTestStatus: 'sent',
      lastSendTestError: null,
      lastSendTestAttempt: redactChannelSecrets(
        result.attemptLabel,
        [
          resolved.apiKey,
          (connection.config as any)?.apiKey,
          (connection.config as any)?.webhookSecret,
        ],
        'unknown',
      ),
      apiKeyLast4: String(resolved.apiKey).slice(-4) || (connection.metadata as any)?.apiKeyLast4,
      evolutionCredentialSource: resolved.source,
    };

    const { error: updateError } = await admin
      .from('channel_connections')
      .update({
        metadata: nextMetadata,
        updated_at: attemptedAt,
      })
      .eq('id', connectionId)
      .eq('organization_id', tenantId)
      .select('id')
      .single();

    if (updateError) {
      return json(
        {
          error: redactChannelSecrets(
            updateError,
            [
              resolved.apiKey,
              (connection.config as any)?.apiKey,
              (connection.config as any)?.webhookSecret,
            ],
            'Failed to persist send test state.',
          ),
        },
        500,
      );
    }

    return json({
      ok: true,
      send_test: {
        attemptedAt,
        phone,
        text: redactChannelSecrets(
          text,
          [
            resolved.apiKey,
            (connection.config as any)?.apiKey,
            (connection.config as any)?.webhookSecret,
          ],
          '',
        ),
        attempt: redactChannelSecrets(
          result.attemptLabel,
          [
            resolved.apiKey,
            (connection.config as any)?.apiKey,
            (connection.config as any)?.webhookSecret,
          ],
          'unknown',
        ),
        providerMessageId: result.providerMessageId
          ? redactChannelSecrets(
              result.providerMessageId,
              [
                resolved.apiKey,
                (connection.config as any)?.apiKey,
                (connection.config as any)?.webhookSecret,
              ],
              '',
            )
          : result.providerMessageId,
      },
    });
  } catch (sendError) {
    const message = redactChannelSecrets(
      sendError,
      [
        resolved.apiKey,
        (connection.config as any)?.apiKey,
        (connection.config as any)?.webhookSecret,
      ],
      'Send test failed.',
    );

    await admin
      .from('channel_connections')
      .update({
        metadata: {
          ...((connection.metadata as Record<string, unknown> | null) || {}),
          lastSendTestAt: attemptedAt,
          lastSendTestStatus: 'failed',
          lastSendTestError: message,
          lastSendTestAttempt: 'all-failed',
          apiKeyLast4: String(resolved.apiKey).slice(-4) || (connection.metadata as any)?.apiKeyLast4,
          evolutionCredentialSource: resolved.source,
        },
        updated_at: attemptedAt,
      })
      .eq('id', connectionId)
      .eq('organization_id', tenantId)
      .select('id')
      .single();

    return json({ error: message }, 502);
  }
}
