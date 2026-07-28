import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveEvolutionCredentialsMock = vi.fn();
const createEvolutionInstanceMock = vi.fn();
const fetchEvolutionPairingCodeMock = vi.fn();
const setEvolutionWebhookMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const API_KEY = 'API-KEY-SENTINELA-CONNECT';
const WEBHOOK_SECRET = 'WEBHOOK-SECRET-SENTINELA-CONNECT';
let connectionRow: Record<string, unknown>;
let persistedUpdate: Record<string, unknown> | null;
let updateSelect: string | null;
let persistenceError: { message: string } | null;

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: (...args: unknown[]) => resolveEvolutionCredentialsMock(...args),
}));
vi.mock('@/lib/channels/evolution', () => ({
  createEvolutionInstance: (...args: unknown[]) => createEvolutionInstanceMock(...args),
  fetchEvolutionPairingCode: (...args: unknown[]) => fetchEvolutionPairingCodeMock(...args),
  setEvolutionWebhook: (...args: unknown[]) => setEvolutionWebhookMock(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: connectionRow, error: null }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        persistedUpdate = payload;
        return {
          eq: () => ({
            eq: () => ({
              select: (columns: string) => {
                updateSelect = columns;
                return {
                single: () => Promise.resolve({
                  data: { ...connectionRow, ...payload },
                  error: persistenceError,
                }),
                };
              },
            }),
          }),
        };
      },
    }),
  }),
}));

import { POST } from './route';

const ctx = {
  params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }),
};

function request() {
  return new Request(
    `http://localhost:3000/api/platform/tenants/${TENANT}/channels/${CONNECTION}/connect`,
    { method: 'POST' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  persistedUpdate = null;
  updateSelect = null;
  persistenceError = null;
  connectionRow = {
    id: CONNECTION,
    organization_id: TENANT,
    provider: 'evolution',
    channel_type: 'whatsapp',
    name: 'Comercial Vitória',
    status: 'pending',
    config: {
      instanceName: 'comercial-vitoria-a1b2c3d4',
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      aiEnabled: false,
    },
    metadata: { phoneNumber: '5511999990000' },
  };
  requireTenantAccessMock.mockResolvedValue({
    profile: { role: 'clinic_admin', organization_id: TENANT },
    canManageChannelConfig: true,
  });
  resolveEvolutionCredentialsMock.mockResolvedValue({
    apiUrl: 'https://evolution.example.com',
    apiKey: API_KEY,
    source: 'agency_default',
  });
  setEvolutionWebhookMock.mockResolvedValue({ raw: { ok: true } });
});

describe('POST connect', () => {
  it('cria a instancia, configura webhook e devolve/persiste o QR da criacao', async () => {
    createEvolutionInstanceMock.mockResolvedValue({
      raw: {
        qrcode: { base64: 'data:image/png;base64,NEW_QR', code: 'PAIR-NEW' },
        apiKey: API_KEY,
        nested: { webhookSecret: WEBHOOK_SECRET },
      },
      qrBase64: 'data:image/png;base64,NEW_QR',
      pairingCode: 'PAIR-NEW',
      instanceName: 'comercial-vitoria-a1b2c3d4',
    });

    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireTenantAccessMock).toHaveBeenCalledWith(TENANT, {
      requiredPermissions: ['whatsapp.manage_connection'],
    });
    expect(createEvolutionInstanceMock).toHaveBeenCalledWith({
      apiUrl: 'https://evolution.example.com',
      apiKey: API_KEY,
      instanceName: 'comercial-vitoria-a1b2c3d4',
    });
    expect(fetchEvolutionPairingCodeMock).not.toHaveBeenCalled();
    expect(setEvolutionWebhookMock).toHaveBeenCalledWith({
      apiUrl: 'https://evolution.example.com',
      apiKey: API_KEY,
      instanceName: 'comercial-vitoria-a1b2c3d4',
      webhookUrl: `http://localhost:3000/api/public/channels/evolution/${CONNECTION}/webhook?secret=${WEBHOOK_SECRET}`,
    });
    expect(body.pairing).toMatchObject({
      qrBase64: 'data:image/png;base64,NEW_QR',
      pairingCode: 'PAIR-NEW',
    });
    expect(persistedUpdate?.metadata).toMatchObject({
      lastPairingCode: 'PAIR-NEW',
      lastPairingPayload: { qrcode: { base64: 'data:image/png;base64,NEW_QR', code: 'PAIR-NEW' } },
    });
    expect(JSON.stringify(persistedUpdate?.metadata)).not.toContain(API_KEY);
    expect(JSON.stringify(persistedUpdate?.metadata)).not.toContain(WEBHOOK_SECRET);
    expect(updateSelect).toBe('id');
    expect(body).not.toHaveProperty('channel');
    expect(JSON.stringify(body)).not.toContain(API_KEY);
    expect(JSON.stringify(body)).not.toContain(WEBHOOK_SECRET);
    expect(JSON.stringify(body)).not.toMatch(/apiKey|webhookSecret/i);
  });

  it('reconhece o "ja existe" com a frase REAL da Evolution v2 (name ... already in use)', async () => {
    // Mensagem literal de produção (28/07): não contém a palavra "instance", só o
    // nome. O padrão antigo exigia "instance|instancia" e deixava esse caso virar
    // erro 502 "Forbidden" na tela em vez de buscar o QR da instância existente.
    createEvolutionInstanceMock.mockRejectedValue(
      new Error('This name "whatsapp-ia-4abae75a" is already in use.'),
    );
    fetchEvolutionPairingCodeMock.mockResolvedValue({
      raw: { base64: 'iVBOR_REPAIR2', pairingCode: 'PAIR-REPAIR2' },
      pairingCode: 'PAIR-REPAIR2',
      code: null,
      count: 1,
    });

    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchEvolutionPairingCodeMock).toHaveBeenCalledTimes(1);
    expect(body.pairing).toMatchObject({ pairingCode: 'PAIR-REPAIR2' });
  });

  it('se a instancia ja existe, busca novo pareamento sem falhar', async () => {
    createEvolutionInstanceMock.mockRejectedValue(new Error('Instance already exists'));
    fetchEvolutionPairingCodeMock.mockResolvedValue({
      raw: { base64: 'iVBOR_REPAIR', pairingCode: 'PAIR-REPAIR' },
      pairingCode: 'PAIR-REPAIR',
      code: null,
      count: 1,
    });

    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createEvolutionInstanceMock).toHaveBeenCalledTimes(1);
    expect(fetchEvolutionPairingCodeMock).toHaveBeenCalledWith({
      apiUrl: 'https://evolution.example.com',
      apiKey: API_KEY,
      instanceName: 'comercial-vitoria-a1b2c3d4',
    });
    expect(setEvolutionWebhookMock).toHaveBeenCalledTimes(1);
    expect(body.pairing).toMatchObject({
      pairingCode: 'PAIR-REPAIR',
      count: 1,
    });
    expect(persistedUpdate?.metadata).toMatchObject({
      lastPairingCode: 'PAIR-REPAIR',
      lastPairingPayload: { base64: 'iVBOR_REPAIR', pairingCode: 'PAIR-REPAIR' },
    });
  });

  it('redige segredos ecoados no warning do webhook', async () => {
    createEvolutionInstanceMock.mockResolvedValue({
      raw: { ok: true },
      qrBase64: 'data:image/png;base64,NEW_QR',
      pairingCode: 'PAIR-NEW',
      instanceName: 'comercial-vitoria-a1b2c3d4',
    });
    setEvolutionWebhookMock.mockRejectedValue(
      new Error(`webhookSecret=${WEBHOOK_SECRET}; apiKey=${API_KEY}`),
    );

    const response = await POST(request(), ctx);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.webhook.warning).toContain('[redigido]');
    expect(body).not.toHaveProperty('channel');
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(WEBHOOK_SECRET);
    expect(serialized).not.toMatch(/apiKey|webhookSecret/i);
  });

  it('não devolve a mensagem do resolvedor quando ela contém segredo externo', async () => {
    const agencySecret = 'AGENCY-SECRET-NOT-IN-CONNECTION-CONNECT';
    resolveEvolutionCredentialsMock.mockRejectedValue(
      new Error(`Falha interna usando ${agencySecret}`),
    );

    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to resolve Evolution credentials for pairing.');
    expect(JSON.stringify(body)).not.toContain(agencySecret);
  });

  it('redige segredos ecoados no erro de persistência', async () => {
    createEvolutionInstanceMock.mockResolvedValue({
      raw: { ok: true },
      qrBase64: 'data:image/png;base64,NEW_QR',
      pairingCode: 'PAIR-NEW',
      instanceName: 'comercial-vitoria-a1b2c3d4',
    });
    persistenceError = {
      message: `persist apiKey=${API_KEY} webhookSecret=${WEBHOOK_SECRET}`,
    };

    const response = await POST(request(), ctx);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(body.error).toContain('[redigido]');
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(WEBHOOK_SECRET);
    expect(body).not.toHaveProperty('channel');
  });

  it('redige segredos ecoados no erro do provedor', async () => {
    createEvolutionInstanceMock.mockRejectedValue(
      new Error(`Falha Evolution apiKey=${API_KEY} webhookSecret=${WEBHOOK_SECRET}`),
    );

    const response = await POST(request(), ctx);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(502);
    expect(body.error).toContain('[redigido]');
    expect(body).not.toHaveProperty('channel');
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(WEBHOOK_SECRET);
    expect(serialized).not.toMatch(/apiKey|webhookSecret/i);
  });
});
