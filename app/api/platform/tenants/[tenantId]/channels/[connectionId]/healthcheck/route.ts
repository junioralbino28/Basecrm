import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { fetchEvolutionConnectionState } from '@/lib/channels/evolution';

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
    .select('id, provider, name, status, config, metadata')
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
    return json({ error: 'Connection requires apiUrl, instanceName and apiKey before healthcheck.' }, 400);
  }

  const checkedAt = new Date().toISOString();

  try {
    const result = await fetchEvolutionConnectionState({
      apiUrl,
      instanceName,
      apiKey,
    });

    const nextMetadata = {
      ...((connection.metadata as Record<string, unknown> | null) || {}),
      lastHealthcheckState: result.stateLabel,
      lastHealthcheckRaw: result.raw,
      apiKeyLast4: String(apiKey).slice(-4) || (connection.metadata as any)?.apiKeyLast4,
    };

    const { data: updated, error: updateError } = await admin
      .from('channel_connections')
      .update({
        status: result.normalizedStatus,
        metadata: nextMetadata,
        last_healthcheck_at: checkedAt,
        updated_at: checkedAt,
      })
      .eq('id', connectionId)
      .eq('organization_id', tenantId)
      .select('id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at')
      .single();

    if (updateError) return json({ error: updateError.message }, 500);

    return json({
      ok: true,
      channel: updated,
      healthcheck: {
        state: result.stateLabel,
        checkedAt,
      },
    });
  } catch (healthError) {
    const message = healthError instanceof Error ? healthError.message : 'Healthcheck failed.';

    const { data: updated } = await admin
      .from('channel_connections')
      .update({
        status: 'error',
        metadata: {
          ...((connection.metadata as Record<string, unknown> | null) || {}),
          lastHealthcheckError: message,
          apiKeyLast4: String(apiKey).slice(-4) || (connection.metadata as any)?.apiKeyLast4,
        },
        last_healthcheck_at: checkedAt,
        updated_at: checkedAt,
      })
      .eq('id', connectionId)
      .eq('organization_id', tenantId)
      .select('id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at')
      .single();

    return json(
      {
        error: message,
        channel: updated || null,
      },
      502
    );
  }
}
