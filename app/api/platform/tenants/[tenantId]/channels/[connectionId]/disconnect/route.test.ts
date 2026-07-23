import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveEvolutionCredentialsMock = vi.fn();
const logoutEvolutionInstanceMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const API_KEY = 'API-KEY-SENTINELA-DISCONNECT';
const WEBHOOK_SECRET = 'WEBHOOK-SECRET-SENTINELA-DISCONNECT';
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
  logoutEvolutionInstance: (...args: unknown[]) => logoutEvolutionInstanceMock(...args),
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
    `http://localhost:3000/api/platform/tenants/${TENANT}/channels/${CONNECTION}/disconnect`,
    { method: 'POST' },
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
  logoutEvolutionInstanceMock.mockResolvedValue({
    ok: true,
    apiKey: API_KEY,
    nested: { webhookSecret: WEBHOOK_SECRET },
  });
});

function expectNoSecrets(body: unknown) {
  const serialized = JSON.stringify(body);
  expect(body).not.toHaveProperty('channel');
  expect(serialized).not.toContain(API_KEY);
  expect(serialized).not.toContain(WEBHOOK_SECRET);
  expect(serialized).not.toMatch(/apiKey|webhookSecret/i);
}

describe('POST disconnect', () => {
  it('devolve somente a confirmação pública e usa select mínimo', async () => {
    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.disconnect.requestedAt).toBeTypeOf('string');
    expect(updateSelect).toBe('id');
    expect(persistedUpdate?.metadata).toMatchObject({
      lastDisconnectPayload: { ok: true, nested: {} },
    });
    expect(JSON.stringify(persistedUpdate?.metadata)).not.toContain(API_KEY);
    expect(JSON.stringify(persistedUpdate?.metadata)).not.toContain(WEBHOOK_SECRET);
    expectNoSecrets(body);
  });

  it('não devolve a mensagem do resolvedor quando ela contém segredo externo', async () => {
    const agencySecret = 'AGENCY-SECRET-NOT-IN-CONNECTION-DISCONNECT';
    resolveEvolutionCredentialsMock.mockRejectedValue(
      new Error(`Falha interna usando ${agencySecret}`),
    );

    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to resolve Evolution credentials for disconnect.');
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
    logoutEvolutionInstanceMock.mockRejectedValue(
      new Error(`disconnect apiKey=${API_KEY} webhookSecret=${WEBHOOK_SECRET}`),
    );

    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toContain('[redigido]');
    expectNoSecrets(body);
  });
});
