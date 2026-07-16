import { describe, expect, it, vi, beforeEach } from 'vitest';

// Regressão do achado Critical 2: a LISTA de canais vazava config.apiKey/webhookSecret
// para quem só tinha whatsapp.access (agency_staff). Após o DTO, secrets são redigidos
// para qualquer resposta enviada ao browser, inclusive managers.

const requireTenantAccessMock = vi.fn();
let channelsData: unknown[] = [];
let insertedChannel: Record<string, unknown> | null = null;

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
      insert: (payload: Record<string, unknown>) => {
        insertedChannel = payload;
        return {
          select: () => ({
            single: () => Promise.resolve({
              data: { id: 'channel-new', ...payload },
              error: null,
            }),
          }),
        };
      },
    }),
  }),
}));

import { GET, POST } from './route';

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
  insertedChannel = null;
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

  it('manager também recebe secrets redigidos', async () => {
    requireTenantAccessMock.mockResolvedValue({
      profile: { role: 'agency_admin', organization_id: 'org-1' },
      permissions: {},
      canManageChannelConfig: true,
    });
    const res = await GET(makeReq(), makeCtx());
    const body = await res.json();
    expect(body.channels[0].config.apiKey).toBeUndefined();
    expect(body.channels[0].config.webhookSecret).toBeUndefined();
    expect(body.channels[0].config.hasApiKey).toBe(true);
    expect(body.channels[0].config.hasWebhookSecret).toBe(true);
    expect(body.channels[0].config.apiKeyLast4).toBe('1234');
  });
});

describe('POST /api/platform/tenants/[tenantId]/channels', () => {
  it('aceita cadastro simples e gera instanceName, segredo e aiEnabled=true', async () => {
    requireTenantAccessMock.mockResolvedValue({
      profile: { role: 'clinic_admin', organization_id: TENANT },
      permissions: { 'whatsapp.manage_connection': true },
      canManageChannelConfig: true,
    });

    const req = new Request(`http://localhost:3000/api/platform/tenants/${TENANT}/channels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: 'Comercial – Vitória',
        metadata: { phoneNumber: '  +55 11 99999-0000  ' },
      }),
    });

    const res = await POST(req, makeCtx());

    expect(res.status).toBe(201);
    expect(requireTenantAccessMock).toHaveBeenCalledWith(TENANT, {
      requiredPermissions: ['whatsapp.manage_connection'],
    });
    expect(insertedChannel).toMatchObject({
      organization_id: TENANT,
      provider: 'evolution',
      channel_type: 'whatsapp',
      name: 'Comercial – Vitória',
      status: 'pending',
      metadata: { phoneNumber: '+55 11 99999-0000' },
    });

    const config = insertedChannel?.config as Record<string, unknown>;
    expect(config.instanceName).toMatch(/^comercial-vitoria-[a-f0-9]{8}$/);
    expect(config.webhookSecret).toMatch(/^[a-f0-9]{32}$/);
    expect(config.sendMode).toBe('auto');
    expect(config.aiEnabled).toBe(true);
  });
});
