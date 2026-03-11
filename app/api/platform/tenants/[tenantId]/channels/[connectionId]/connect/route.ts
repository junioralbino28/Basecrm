import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { fetchEvolutionPairingCode } from '@/lib/channels/evolution';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { tenantId, connectionId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['whatsapp.access'],
  });
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();

  const { data: connection, error } = await admin
    .from('channel_connections')
    .select('id, provider, config, metadata')
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!connection) return json({ error: 'Connection not found' }, 404);
  if (connection.provider !== 'evolution') return json({ error: 'Unsupported provider' }, 400);

  const apiUrl = (connection.config as any)?.apiUrl;
  const instanceName = (connection.config as any)?.instanceName;
  const apiKey = (connection.config as any)?.apiKey;
  const phoneNumber = (connection.metadata as any)?.phoneNumber;

  if (!apiUrl || !instanceName || !apiKey) {
    return json({ error: 'Connection requires apiUrl, instanceName and apiKey before pairing.' }, 400);
  }

  const requestedAt = new Date().toISOString();

  try {
    const pairing = await fetchEvolutionPairingCode({
      apiUrl,
      instanceName,
      apiKey,
      number: typeof phoneNumber === 'string' ? phoneNumber : undefined,
    });

    const nextMetadata = {
      ...((connection.metadata as Record<string, unknown> | null) || {}),
      lastPairingCode: pairing.pairingCode,
      lastPairingPayload: pairing.raw,
      lastPairingRequestedAt: requestedAt,
      apiKeyLast4: String(apiKey).slice(-4) || (connection.metadata as any)?.apiKeyLast4,
    };

    const { data: updated, error: updateError } = await admin
      .from('channel_connections')
      .update({
        metadata: nextMetadata,
        updated_at: requestedAt,
      })
      .eq('id', connectionId)
      .eq('organization_id', tenantId)
      .select('id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at')
      .single();

    if (updateError) return json({ error: updateError.message }, 500);

    return json({
      ok: true,
      channel: updated,
      pairing: {
        pairingCode: pairing.pairingCode,
        code: pairing.code,
        count: pairing.count,
        requestedAt,
      },
    });
  } catch (pairingError) {
    const message = pairingError instanceof Error ? pairingError.message : 'Pairing failed.';

    await admin
      .from('channel_connections')
      .update({
        metadata: {
          ...((connection.metadata as Record<string, unknown> | null) || {}),
          lastPairingError: message,
          lastPairingRequestedAt: requestedAt,
          apiKeyLast4: String(apiKey).slice(-4) || (connection.metadata as any)?.apiKeyLast4,
        },
        updated_at: requestedAt,
      })
      .eq('id', connectionId)
      .eq('organization_id', tenantId);

    return json({ error: message }, 502);
  }
}
