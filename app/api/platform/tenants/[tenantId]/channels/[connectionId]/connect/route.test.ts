import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveEvolutionCredentialsMock = vi.fn();
const createEvolutionInstanceMock = vi.fn();
const fetchEvolutionPairingCodeMock = vi.fn();
const setEvolutionWebhookMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
let connectionRow: Record<string, unknown>;
let persistedUpdate: Record<string, unknown> | null;

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
              select: () => ({
                single: () => Promise.resolve({
                  data: { ...connectionRow, ...payload },
                  error: null,
                }),
              }),
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
  connectionRow = {
    id: CONNECTION,
    organization_id: TENANT,
    provider: 'evolution',
    channel_type: 'whatsapp',
    name: 'Comercial Vitória',
    status: 'pending',
    config: {
      instanceName: 'comercial-vitoria-a1b2c3d4',
      webhookSecret: 'webhook-secret',
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
    apiKey: 'GLOBAL-KEY',
    source: 'agency_default',
  });
  setEvolutionWebhookMock.mockResolvedValue({ raw: { ok: true } });
});

describe('POST connect', () => {
  it('cria a instancia, configura webhook e devolve/persiste o QR da criacao', async () => {
    createEvolutionInstanceMock.mockResolvedValue({
      raw: { qrcode: { base64: 'data:image/png;base64,NEW_QR', code: 'PAIR-NEW' } },
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
      apiKey: 'GLOBAL-KEY',
      instanceName: 'comercial-vitoria-a1b2c3d4',
    });
    expect(fetchEvolutionPairingCodeMock).not.toHaveBeenCalled();
    expect(setEvolutionWebhookMock).toHaveBeenCalledWith({
      apiUrl: 'https://evolution.example.com',
      apiKey: 'GLOBAL-KEY',
      instanceName: 'comercial-vitoria-a1b2c3d4',
      webhookUrl: `http://localhost:3000/api/public/channels/evolution/${CONNECTION}/webhook?secret=webhook-secret`,
    });
    expect(body.pairing).toMatchObject({
      qrBase64: 'data:image/png;base64,NEW_QR',
      pairingCode: 'PAIR-NEW',
    });
    expect(persistedUpdate?.metadata).toMatchObject({
      lastPairingCode: 'PAIR-NEW',
      lastPairingPayload: { qrcode: { base64: 'data:image/png;base64,NEW_QR', code: 'PAIR-NEW' } },
    });
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
      apiKey: 'GLOBAL-KEY',
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
});
