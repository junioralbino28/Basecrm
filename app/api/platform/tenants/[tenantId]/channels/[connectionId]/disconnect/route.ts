import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { logoutEvolutionInstance } from '@/lib/channels/evolution';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

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

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const { tenantId, connectionId } = await ctx.params;
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

  if (!apiUrl || !instanceName || !apiKey) {
    return json({ error: 'Connection requires apiUrl, instanceName and apiKey before disconnect.' }, 400);
  }

  const requestedAt = new Date().toISOString();

  try {
    const payload = await logoutEvolutionInstance({
      apiUrl,
      instanceName,
      apiKey,
    });

    const nextMetadata = {
      ...((connection.metadata as Record<string, unknown> | null) || {}),
      lastDisconnectPayload: payload,
      lastDisconnectAt: requestedAt,
      lastPairingCode: null,
      lastPairingPayload: null,
    };

    const { data: updated, error: updateError } = await admin
      .from('channel_connections')
      .update({
        status: 'disconnected',
        metadata: nextMetadata,
        last_healthcheck_at: requestedAt,
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
      disconnect: {
        requestedAt,
      },
    });
  } catch (disconnectError) {
    const message = disconnectError instanceof Error ? disconnectError.message : 'Disconnect failed.';

    await admin
      .from('channel_connections')
      .update({
        metadata: {
          ...((connection.metadata as Record<string, unknown> | null) || {}),
          lastDisconnectError: message,
          lastDisconnectAt: requestedAt,
        },
        updated_at: requestedAt,
      })
      .eq('id', connectionId)
      .eq('organization_id', tenantId);

    return json({ error: message }, 502);
  }
}
