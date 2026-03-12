import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { fetchEvolutionConnectionState, setEvolutionWebhook } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
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
    .select('id, provider, name, status, config, metadata')
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!connection) return json({ error: 'Connection not found' }, 404);
  if (connection.provider !== 'evolution') return json({ error: 'Unsupported provider' }, 400);

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
  } catch (resolveError) {
    return json(
      {
        error:
          resolveError instanceof Error
            ? resolveError.message
            : 'Failed to resolve Evolution credentials for healthcheck.',
      },
      500
    );
  }

  if (!instanceName || !resolved?.apiUrl || !resolved.apiKey) {
    return json(
      {
        error:
          'Connection requires instanceName and Evolution credentials (connection config or agency defaults) before healthcheck.',
      },
      400
    );
  }

  const checkedAt = new Date().toISOString();
  const requestOrigin = new URL(req.url).origin;

  try {
    const result = await fetchEvolutionConnectionState({
      apiUrl: resolved.apiUrl,
      instanceName,
      apiKey: resolved.apiKey,
    });

    const webhookSecret = String((connection.config as any)?.webhookSecret || '').trim();
    let webhookWarning: string | null = null;
    let webhookConfigured = false;
    if (webhookSecret) {
      const crmWebhookUrl = `${requestOrigin}/api/public/channels/evolution/${connectionId}/webhook?secret=${encodeURIComponent(webhookSecret)}`;
      try {
        await setEvolutionWebhook({
          apiUrl: resolved.apiUrl,
          instanceName,
          apiKey: resolved.apiKey,
          webhookUrl: crmWebhookUrl,
        });
        webhookConfigured = true;
      } catch (webhookError) {
        webhookWarning =
          webhookError instanceof Error
            ? `Webhook CRM nao configurado automaticamente: ${webhookError.message}`
            : 'Webhook CRM nao configurado automaticamente.';
      }
    } else {
      webhookWarning = 'Webhook secret ausente na conexao.';
    }

    const nextMetadata = {
      ...((connection.metadata as Record<string, unknown> | null) || {}),
      lastHealthcheckState: result.stateLabel,
      lastHealthcheckRaw: result.raw,
      lastWebhookConfiguredAt: webhookConfigured ? checkedAt : (connection.metadata as any)?.lastWebhookConfiguredAt || null,
      lastWebhookConfigError: webhookWarning,
      apiKeyLast4: String(resolved.apiKey).slice(-4) || (connection.metadata as any)?.apiKeyLast4,
      evolutionCredentialSource: resolved.source,
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
      webhook: {
        configured: webhookConfigured,
        warning: webhookWarning,
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
          apiKeyLast4: String(resolved.apiKey).slice(-4) || (connection.metadata as any)?.apiKeyLast4,
          evolutionCredentialSource: resolved.source,
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
