// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setEvolutionWebhookMock = vi.fn();
const findEvolutionWebhookMock = vi.fn();

vi.mock('@/lib/channels/evolution', () => ({
  setEvolutionWebhook: (...args: unknown[]) => setEvolutionWebhookMock(...args),
  findEvolutionWebhook: (...args: unknown[]) => findEvolutionWebhookMock(...args),
}));

import { registerCrmWebhook } from './evolutionWebhookRegistration';

const params = {
  apiUrl: 'https://evolution.example.com',
  apiKey: 'CHAVE',
  instanceName: 'inst',
  requestOrigin: 'https://crm.example.com',
  connectionId: '22222222-2222-4222-8222-222222222222',
  webhookSecret: 'SEGREDO-32',
};
const baseUrl = `https://crm.example.com/api/public/channels/evolution/${params.connectionId}/webhook`;

beforeEach(() => {
  vi.clearAllMocks();
  setEvolutionWebhookMock.mockResolvedValue({ raw: { ok: true } });
});

describe('registerCrmWebhook (parecer do Codex, I7: segredo no cabeçalho, não na URL)', () => {
  it('registra a URL SEM segredo e o segredo no cabeçalho; confere que a Evolution guardou', async () => {
    findEvolutionWebhookMock.mockResolvedValue({
      raw: {}, enabled: true, url: baseUrl, headers: { 'x-webhook-secret': 'SEGREDO-32' }, events: [],
    });

    const result = await registerCrmWebhook(params);

    expect(result).toEqual({ transport: 'header', warning: null });
    expect(setEvolutionWebhookMock).toHaveBeenCalledTimes(1);
    expect(setEvolutionWebhookMock).toHaveBeenCalledWith({
      apiUrl: params.apiUrl,
      apiKey: params.apiKey,
      instanceName: params.instanceName,
      webhookUrl: baseUrl,
      headers: { 'x-webhook-secret': 'SEGREDO-32' },
    });
    const registeredUrl = String(setEvolutionWebhookMock.mock.calls[0]?.[0]?.webhookUrl);
    expect(registeredUrl).not.toContain('secret=');
  });

  it('Evolution antiga (não guarda cabeçalho): registra de novo com o segredo na URL e avisa', async () => {
    findEvolutionWebhookMock.mockResolvedValue({ raw: {}, enabled: true, url: baseUrl, headers: null, events: [] });

    const result = await registerCrmWebhook(params);

    expect(result.transport).toBe('query');
    expect(result.warning).toMatch(/segredo ficou na URL/);
    expect(setEvolutionWebhookMock).toHaveBeenCalledTimes(2);
    expect(setEvolutionWebhookMock.mock.calls[1]?.[0]).toMatchObject({
      webhookUrl: `${baseUrl}?secret=SEGREDO-32`,
    });
  });

  it('cabeçalho guardado com valor diferente conta como não guardado (não confia em eco parcial)', async () => {
    findEvolutionWebhookMock.mockResolvedValue({
      raw: {}, enabled: true, url: baseUrl, headers: { 'x-webhook-secret': 'OUTRO' }, events: [],
    });

    const result = await registerCrmWebhook(params);
    expect(result.transport).toBe('query');
  });

  it('erro da Evolution sobe para o chamador (que redige e vira aviso)', async () => {
    setEvolutionWebhookMock.mockRejectedValueOnce(new Error('HTTP 500'));
    await expect(registerCrmWebhook(params)).rejects.toThrow(/HTTP 500/);
    expect(findEvolutionWebhookMock).not.toHaveBeenCalled();
  });
});
