import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenantAccessMock = vi.fn();
const updateMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const currentConfig = {
  apiUrl: 'https://evolution.example.com',
  instanceName: 'comercial-vitoria-a1b2c3d4',
  webhookSecret: 'WEBHOOK-SECRET',
  apiKey: 'EVOLUTION-KEY',
  sendMode: 'number_text',
};

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/auth/scope', () => ({ isAgencyAdminRole: () => false }));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  ensureTenantAgencyBinding: vi.fn(),
  resolveEvolutionCredentials: vi.fn(),
}));
vi.mock('@/lib/channels/evolution', () => ({ logoutEvolutionInstance: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: { id: CONNECTION, config: currentConfig, metadata: { phoneNumber: '5511999' } },
              error: null,
            }),
          }),
        }),
      }),
      update: (updates: Record<string, unknown>) => {
        updateMock(updates);
        return {
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({
                  data: {
                    id: CONNECTION,
                    provider: 'evolution',
                    channel_type: 'whatsapp',
                    name: 'Comercial',
                    status: 'connected',
                    config: updates.config,
                    metadata: { phoneNumber: '5511999' },
                  },
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

import { PATCH } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({
    profile: { role: 'clinic_admin', organization_id: TENANT },
    canManageChannelConfig: true,
  });
});

describe('PATCH channel connection — aiEnabled', () => {
  it('altera somente o gate de IA e preserva toda a configuração da Evolution', async () => {
    const response = await PATCH(
      new Request(`http://localhost:3000/api/platform/tenants/${TENANT}/channels/${CONNECTION}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: { aiEnabled: false } }),
      }),
      { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) },
    );

    expect(response.status).toBe(200);
    expect(requireTenantAccessMock).toHaveBeenCalledWith(TENANT, {
      requiredPermissions: ['whatsapp.manage_connection'],
    });
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({
      config: { ...currentConfig, aiEnabled: false },
    });
  });
});
