import 'server-only';

import type { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

export type GoogleCalendarConnectionStatus = 'connected' | 'reconnect_required' | 'revoked';

export type GoogleCalendarConnection = {
  id: string;
  organizationId: string;
  ownerId: string;
  googleAccountEmail: string;
  /** Agenda onde a IA ESCREVE o evento. `primary` ate alguem escolher outra (Fatia 5). */
  googleCalendarId: string;
  googleCalendarSummary: string | null;
  /** Agendas que contam como OCUPADO alem da de escrita. Vazio = so a de escrita. */
  busyCalendarIds: string[];
  status: GoogleCalendarConnectionStatus;
  scope: string;
  lastError: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
};

function mapConnectionRow(row: Record<string, unknown>): GoogleCalendarConnection {
  const status = row.status as GoogleCalendarConnectionStatus;
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    ownerId: String(row.owner_id),
    googleAccountEmail: String(row.google_account_email || ''),
    googleCalendarId: String(row.google_calendar_id || 'primary'),
    googleCalendarSummary: (row.google_calendar_summary as string | null) ?? null,
    busyCalendarIds: Array.isArray(row.busy_calendar_ids)
      ? (row.busy_calendar_ids as unknown[]).map((id) => String(id)).filter(Boolean)
      : [],
    status: status === 'reconnect_required' || status === 'revoked' ? status : 'connected',
    scope: String(row.scope || ''),
    lastError: (row.last_error as string | null) ?? null,
    connectedAt: (row.connected_at as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

/** Leitura simples (metadado publico, nunca o token) — service_role bypassa a RLS deny-all. */
export async function getGoogleCalendarConnection(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string;
}): Promise<GoogleCalendarConnection | null> {
  const result = await input.admin
    .from('google_calendar_connections')
    .select('id, organization_id, owner_id, google_account_email, google_calendar_id, google_calendar_summary, busy_calendar_ids, status, scope, last_error, connected_at, updated_at')
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? mapConnectionRow(result.data as Record<string, unknown>) : null;
}

/** Grava (cria ou atualiza) o refresh token no Vault e faz upsert da conexao — tudo em 1 RPC atomica. */
export async function writeGoogleCalendarConnection(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string;
  googleAccountEmail: string;
  googleCalendarId: string;
  refreshToken: string;
  scope: string;
}): Promise<GoogleCalendarConnection> {
  const result = await input.admin.rpc('write_google_calendar_refresh_token', {
    p_organization_id: input.organizationId,
    p_owner_id: input.ownerId,
    p_google_account_email: input.googleAccountEmail,
    p_google_calendar_id: input.googleCalendarId,
    p_refresh_token: input.refreshToken,
    p_scope: input.scope,
  });
  if (result.error) throw new Error(result.error.message);
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row) throw new Error('Falha ao gravar a conexao do Google Agenda.');
  return mapConnectionRow(row as Record<string, unknown>);
}

/** Le o refresh token do Vault; `null` quando nao ha conexao conectada para (org, owner). */
export async function readGoogleCalendarRefreshToken(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string;
}): Promise<string | null> {
  const result = await input.admin.rpc('read_google_calendar_refresh_token', {
    p_organization_id: input.organizationId,
    p_owner_id: input.ownerId,
  });
  if (result.error) throw new Error(result.error.message);
  return typeof result.data === 'string' && result.data ? result.data : null;
}

/** Apaga o segredo do Vault e marca a conexao como revogada (melhor esforco de revoke no Google é do chamador). */
export async function deleteGoogleCalendarConnection(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string;
}): Promise<boolean> {
  const result = await input.admin.rpc('delete_google_calendar_refresh_token', {
    p_organization_id: input.organizationId,
    p_owner_id: input.ownerId,
  });
  if (result.error) throw new Error(result.error.message);
  return result.data === true;
}

/**
 * Registra falha de leitura/renovacao sem derrubar nada (warn-and-continue). Redige o erro
 * como as rotas de canal ja fazem, para nunca gravar token em `last_error`.
 */
export async function markGoogleCalendarConnectionIssue(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string;
  status?: GoogleCalendarConnectionStatus;
  lastError: string;
}): Promise<void> {
  const updates: Record<string, unknown> = {
    last_error: input.lastError.slice(0, 500),
    last_read_error_at: new Date().toISOString(),
  };
  if (input.status) updates.status = input.status;
  const result = await input.admin
    .from('google_calendar_connections')
    .update(updates)
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId);
  if (result.error) {
    console.warn('[GoogleCalendar] Failed to persist connection issue', {
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      error: result.error.message,
    });
  }
}
