/**
 * DTO de saída para `channel_connections` enviado ao browser.
 *
 * Fix do achado Critical 2 (auditoria Codex 2026-07-03): as rotas de plataforma leem
 * `channel_connections` via service-role (bypassa RLS) e serializavam `config` cru —
 * incluindo `apiKey` (token Evolution) e `webhookSecret`. Quem só tinha `whatsapp.access`
 * (ex.: agency_staff) recebia esses secrets.
 *
 * Regra: secrets nunca são enviados ao browser, inclusive para managers. A configuração
 * técnica não sensível continua disponível e a presença do token/segredo é indicada por
 * `hasApiKey`, `hasWebhookSecret` e `apiKeyLast4`.
 */
export interface ChannelConnectionRow {
  id: string;
  provider?: string;
  channel_type?: string;
  name?: string;
  status?: string;
  config?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  last_healthcheck_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export function toPublicChannelConnection(
  connection: ChannelConnectionRow,
  _opts: { canManageChannelConfig: boolean }
): ChannelConnectionRow & { config: Record<string, unknown> } {
  const config = (connection.config as Record<string, unknown> | null) || {};

  const metadata = (connection.metadata as Record<string, unknown> | null) || {};
  const { apiKey, webhookSecret, ...safeConfig } = config;

  return {
    ...connection,
    config: {
      ...safeConfig,
      aiEnabled: config.aiEnabled !== false,
      hasApiKey: Boolean(apiKey),
      hasWebhookSecret: Boolean(webhookSecret),
      apiKeyLast4:
        (typeof metadata.apiKeyLast4 === 'string' && metadata.apiKeyLast4) ||
        String(apiKey || '').slice(-4) ||
        undefined,
    },
  };
}
