import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveEvolutionCredentialsMock = vi.fn();
const sendEvolutionTextMessageMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const API_KEY = 'API-KEY-SENTINELA-SEND';
const WEBHOOK_SECRET = 'WEBHOOK-SECRET-SENTINELA-SEND';
let connectionRow: Record<string, unknown>;
let updateSelect: string | null;
let persistedUpdate: Record<string, unknown> | null;
let persistenceError: { message: string } | null;

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: (...args: unknown[]) => resolveEvolutionCredentialsMock(...args),
}));
vi.mock('@/lib/channels/evolution', () => ({
  sendEvolutionTextMessage: (...args: unknown[]) => sendEvolutionTextMessageMock(...args),
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
                    data: { id: CONNECTION },
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
    `http://localhost:3000/api/platform/tenants/${TENANT}/channels/${CONNECTION}/send-test`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '5511999990000', text: 'Teste seguro' }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateSelect = null;
  persistedUpdate = null;
  persistenceError = null;
  connectionRow = {
    id: CONNECTION,
    provider: 'evolution',
    channel_type: 'whatsapp',
    name: 'Comercial',
    config: {
      instanceName: 'comercial-a1b2c3d4',
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
    },
    metadata: {},
  };
  requireTenantAccessMock.mockResolvedValue({
    profile: { role: 'clinic_admin', organization_id: TENANT },
  });
  resolveEvolutionCredentialsMock.mockResolvedValue({
    apiUrl: 'https://evolution.example.com',
    apiKey: API_KEY,
    source: 'connection',
  });
  sendEvolutionTextMessageMock.mockResolvedValue({
    attemptLabel: 'sendText:text',
    providerMessageId: 'message-1',
  });
});

function expectNoSecrets(body: unknown) {
  const serialized = JSON.stringify(body);
  expect(body).not.toHaveProperty('channel');
  expect(serialized).not.toContain(API_KEY);
  expect(serialized).not.toContain(WEBHOOK_SECRET);
  expect(serialized).not.toMatch(/apiKey|webhookSecret/i);
}

describe('POST send-test', () => {
  it('devolve somente o resultado público e usa select mínimo', async () => {
    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.send_test).toMatchObject({
      phone: '5511999990000',
      text: 'Teste seguro',
      attempt: 'sendText:text',
      providerMessageId: 'message-1',
    });
    expect(updateSelect).toBe('id');
    expect(persistedUpdate?.metadata).toMatchObject({
      lastSendTestAttempt: 'sendText:text',
    });
    expectNoSecrets(body);
  });

  it('não devolve a mensagem do resolvedor quando ela contém segredo externo', async () => {
    const agencySecret = 'AGENCY-SECRET-NOT-IN-CONNECTION-SEND';
    resolveEvolutionCredentialsMock.mockRejectedValue(
      new Error(`Falha interna usando ${agencySecret}`),
    );

    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to resolve Evolution credentials for send test.');
    expect(JSON.stringify(body)).not.toContain(agencySecret);
    expectNoSecrets(body);
  });

  it('redige segredos ecoados no erro de persistência', async () => {
    persistenceError = {
      message: `persist apiKey=${API_KEY} webhookSecret=${WEBHOOK_SECRET}`,
    };

    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain('[redigido]');
    expectNoSecrets(body);
  });

  it('redige segredos ecoados no erro do provedor', async () => {
    sendEvolutionTextMessageMock.mockRejectedValue(
      new Error(`send apiKey=${API_KEY} webhookSecret=${WEBHOOK_SECRET}`),
    );

    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toContain('[redigido]');
    expectNoSecrets(body);
  });
});
