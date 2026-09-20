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
vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  return { lookup, default: { lookup } };
});
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
  delete process.env.EVOLUTION_ALLOW_PRIVATE_HOSTS; // a guarda do B7 tem que estar ligada aqui
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
  it('aceita cadastro simples e gera instanceName, segredo e IA desativada por padrao', async () => {
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
    expect(config.aiEnabled).toBe(false);
  });
});

describe('POST /api/platform/tenants/[tenantId]/channels — regra do par (parecer do Codex, B7)', () => {
  function post(config: Record<string, unknown>) {
    return POST(
      new Request(`http://localhost:3000/api/platform/tenants/${TENANT}/channels`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'evolution', channel_type: 'whatsapp', name: 'Comercial', config }),
      }),
      makeCtx(),
    );
  }

  beforeEach(() => {
    requireTenantAccessMock.mockResolvedValue({
      profile: { role: 'clinic_admin', organization_id: TENANT },
      permissions: { 'whatsapp.manage_connection': true },
      canManageChannelConfig: true,
    });
  });

  it('apiUrl sem apiKey é recusado com 400 e nada é inserido', async () => {
    const res = await post({ apiUrl: 'https://host-do-atacante.example' });
    expect(res.status).toBe(400);
    expect(String((await res.json()).error)).toMatch(/informe também a chave/);
    expect(insertedChannel).toBeNull();
  });

  it('apiUrl de rede interna é recusado mesmo com apiKey', async () => {
    const res = await post({ apiUrl: 'http://127.0.0.1:8080', apiKey: 'k' });
    expect(res.status).toBe(400);
    expect(String((await res.json()).error)).toMatch(/rede interna/);
    expect(insertedChannel).toBeNull();
  });

  it('par completo e público é aceito', async () => {
    const res = await post({ apiUrl: 'https://evolution.example.com', apiKey: 'CHAVE-PROPRIA' });
    expect(res.status).toBe(201);
    expect((insertedChannel?.config as Record<string, unknown>).apiUrl).toBe('https://evolution.example.com');
  });
});
