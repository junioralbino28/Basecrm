import 'server-only';

import { randomUUID } from 'node:crypto';
import type { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

export type GoogleOAuthState = {
  state: string;
  organizationId: string;
  channelConnectionId: string;
  ownerId: string;
  requestedBy: string | null;
  redirectOrigin: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

function mapStateRow(row: Record<string, unknown>): GoogleOAuthState {
  return {
    state: String(row.state),
    organizationId: String(row.organization_id),
    channelConnectionId: String(row.channel_connection_id),
    ownerId: String(row.owner_id),
    requestedBy: (row.requested_by as string | null) ?? null,
    redirectOrigin: String(row.redirect_origin),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    consumedAt: (row.consumed_at as string | null) ?? null,
  };
}

const STATE_TTL_MS = 10 * 60_000;

/** Cria o state (uso unico, expira em 10 min — gravado explicitamente, nao so via default da coluna). */
export async function createGoogleOAuthState(input: {
  admin: AdminClient;
  organizationId: string;
  channelConnectionId: string;
  ownerId: string;
  requestedBy: string;
  redirectOrigin: string;
}): Promise<GoogleOAuthState> {
  const result = await input.admin
    .from('google_oauth_states')
    .insert({
      state: randomUUID(),
      organization_id: input.organizationId,
      channel_connection_id: input.channelConnectionId,
      owner_id: input.ownerId,
      requested_by: input.requestedBy,
      redirect_origin: input.redirectOrigin,
      expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    })
    .select('state, organization_id, channel_connection_id, owner_id, requested_by, redirect_origin, created_at, expires_at, consumed_at')
    .single();
  if (result.error) throw new Error(result.error.message);
  return mapStateRow(result.data as Record<string, unknown>);
}

/** So para saber ONDE redirecionar de volta em caso de erro — nao valida expiracao/consumo. */
export async function peekGoogleOAuthState(input: {
  admin: AdminClient;
  state: string;
}): Promise<GoogleOAuthState | null> {
  const result = await input.admin
    .from('google_oauth_states')
    .select('state, organization_id, channel_connection_id, owner_id, requested_by, redirect_origin, created_at, expires_at, consumed_at')
    .eq('state', input.state)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? mapStateRow(result.data as Record<string, unknown>) : null;
}

/**
 * Reivindica o state atomicamente: marca `consumed_at` ANTES de trocar o code, e so tem
 * sucesso se o state existir, nao estiver expirado e nao tiver sido consumido ainda. Um
 * UPDATE condicional numa unica linha e seguro contra corrida sem precisar de advisory lock.
 */
export async function claimGoogleOAuthState(input: {
  admin: AdminClient;
  state: string;
}): Promise<GoogleOAuthState | null> {
  const now = new Date().toISOString();
  const result = await input.admin
    .from('google_oauth_states')
    .update({ consumed_at: now })
    .eq('state', input.state)
    .is('consumed_at', null)
    .gt('expires_at', now)
    .select('state, organization_id, channel_connection_id, owner_id, requested_by, redirect_origin, created_at, expires_at, consumed_at')
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? mapStateRow(result.data as Record<string, unknown>) : null;
}
