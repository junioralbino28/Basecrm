import { describe, expect, it, vi, beforeEach } from 'vitest';

// Regressão do achado Critical 2: a LISTA de canais vazava config.apiKey/webhookSecret
// para quem só tinha whatsapp.access (agency_staff). Após o DTO, secrets são redigidos
// para não-managers e preservados para managers.

const requireTenantAccessMock = vi.fn();
let channelsData: unknown[] = [];

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccessMock(...a),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/auth/scope', () => ({ isAgencyAdminRole: () => false }));
vi.mock('@/lib/channels/evolutionCredentials', () => ({ ensureTenantAgencyBinding: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: channelsData, error: null }),
        }),
      }),
    }),
  }),
}));

import { GET } from './route';

const TENANT = '11111111-1111-4111-8111-111111111111';
const makeCtx = () => ({ params: Promise.resolve({ tenantId: TENANT }) });
const makeReq = () => new Request(`http://localhost:3000/api/platform/tenants/${TENANT}/channels`);

const channelWithSecret = {
  id: 'c1',
  provider: 'evolution',
  channel_type: 'whatsapp',
  name: 'WA',
  status: 'connected',
  config: { instanceName: 'i1', apiKey: 'EVO-SECRET-1234', webhookSecret: 'whk-secret' },
  metadata: { apiKeyLast4: '1234' },
};

beforeEach(() => {
  vi.clearAllMocks();
  channelsData = [channelWithSecret];
});

describe('GET /api/platform/tenants/[tenantId]/channels', () => {
  it('agency_staff (whatsapp.access sem manage_connection) NÃO recebe apiKey/webhookSecret', async () => {
    requireTenantAccessMock.mockResolvedValue({
      profile: { role: 'agency_staff', organization_id: 'org-1' },
      permissions: {},
      canManageChannelConfig: false,
    });
    const res = await GET(makeReq(), makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channels[0].config.apiKey).toBeUndefined();
    expect(body.channels[0].config.webhookSecret).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('EVO-SECRET-1234');
    expect(JSON.stringify(body)).not.toContain('whk-secret');
    expect(body.channels[0].config.hasApiKey).toBe(true);
    expect(body.channels[0].config.apiKeyLast4).toBe('1234');
  });

  it('manager (canManageChannelConfig) recebe os secrets — fluxo de config preservado', async () => {
    requireTenantAccessMock.mockResolvedValue({
      profile: { role: 'agency_admin', organization_id: 'org-1' },
      permissions: {},
      canManageChannelConfig: true,
    });
    const res = await GET(makeReq(), makeCtx());
    const body = await res.json();
    expect(body.channels[0].config.apiKey).toBe('EVO-SECRET-1234');
  });
});
