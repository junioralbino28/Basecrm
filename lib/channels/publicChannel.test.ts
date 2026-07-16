import { describe, it, expect } from 'vitest';
import { toPublicChannelConnection } from './publicChannel';

// Regressão do achado Critical 2 (auditoria Codex 2026-07-03):
// channel_connections.config.apiKey/webhookSecret vazavam RAW pro browser de quem
// só tinha whatsapp.access (agency_staff) via GET da listagem de canais.
// Fix: redigir os secrets para todo browser; expor só indicadores como hasApiKey/last4.

const connection = {
  id: 'c1',
  provider: 'evolution',
  channel_type: 'whatsapp',
  name: 'WhatsApp Clínica',
  status: 'connected',
  config: {
    apiUrl: 'https://evo.example',
    instanceName: 'clinica-1',
    webhookUrl: 'https://crm/webhook',
    apiKey: 'EVO-SECRET-1234',
    webhookSecret: 'whk-abc-secret',
  },
  metadata: { apiKeyLast4: '1234', phoneNumber: '5511999' },
};

describe('toPublicChannelConnection', () => {
  it('REDIGE apiKey e webhookSecret para quem NÃO gerencia (só whatsapp.access)', () => {
    const dto = toPublicChannelConnection(connection, { canManageChannelConfig: false });
    expect(dto.config.apiKey).toBeUndefined();
    expect(dto.config.webhookSecret).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain('EVO-SECRET-1234');
    expect(JSON.stringify(dto)).not.toContain('whk-abc-secret');
    expect(dto.config.hasApiKey).toBe(true);
    expect(dto.config.hasWebhookSecret).toBe(true);
    expect(dto.config.apiKeyLast4).toBe('1234');
    // dados não-secretos preservados
    expect(dto.config.instanceName).toBe('clinica-1');
    expect(dto.name).toBe('WhatsApp Clínica');
  });

  it('também redige apiKey/webhookSecret para managers porque segredos nunca vão ao browser', () => {
    const dto = toPublicChannelConnection(connection, { canManageChannelConfig: true });
    expect(dto.config.apiKey).toBeUndefined();
    expect(dto.config.webhookSecret).toBeUndefined();
    expect(dto.config.hasApiKey).toBe(true);
    expect(dto.config.hasWebhookSecret).toBe(true);
    expect(dto.config.apiKeyLast4).toBe('1234');
    expect(dto.config.instanceName).toBe('clinica-1');
  });

  it('não quebra quando config/metadata são nulos', () => {
    const dto = toPublicChannelConnection(
      { id: 'c2', name: 'x', config: null, metadata: null },
      { canManageChannelConfig: false }
    );
    expect(dto.config.hasApiKey).toBe(false);
    expect(dto.config.apiKey).toBeUndefined();
  });

  it('expõe aiEnabled para qualquer usuário e aplica default true sem expor segredos', () => {
    const disabled = toPublicChannelConnection(
      { ...connection, config: { ...connection.config, aiEnabled: false } },
      { canManageChannelConfig: false },
    );
    const defaulted = toPublicChannelConnection(
      { ...connection, config: { ...connection.config } },
      { canManageChannelConfig: false },
    );

    expect(disabled.config.aiEnabled).toBe(false);
    expect(defaulted.config.aiEnabled).toBe(true);
    expect(disabled.config.apiKey).toBeUndefined();
    expect(disabled.config.webhookSecret).toBeUndefined();
  });
});
