import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';

const requireTenantAccessMock = vi.fn();
const resolveGoogleCalendarOAuthEnvMock = vi.fn();
const getGoogleCalendarConnectionMock = vi.fn();
let connectionRow: { id: string; config: Record<string, unknown> | null } | null = null;

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/googleCalendar/oauth', () => ({
  resolveGoogleCalendarOAuthEnv: () => resolveGoogleCalendarOAuthEnvMock(),
}));
vi.mock('@/lib/googleCalendar/connectionStore', () => ({
  getGoogleCalendarConnection: (...args: unknown[]) => getGoogleCalendarConnectionMock(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: connectionRow, error: null }) }),
        }),
      }),
    }),
  }),
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { id: 'admin-1', organization_id: TENANT } });
  resolveGoogleCalendarOAuthEnvMock.mockReturnValue({ clientId: 'client-1', clientSecret: 'secret-1' });
  connectionRow = {
    id: CONNECTION,
    config: {
      calendar: {
        enabled: true, timezone: 'America/Sao_Paulo', ownerId: OWNER,
        minimumNoticeMinutes: 60, schedulingHorizonDays: 7, humanConfirmationWeekdays: ['saturday'],
        weeklyHours: { monday: [{ start: '09:00', end: '18:00' }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
      },
    },
  };
});

function request() {
  return new Request('http://localhost/google-calendar/status');
}

describe('GET google-calendar/status', () => {
  it('nunca devolve o token — so os campos publicos', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue({
      status: 'connected', googleAccountEmail: 'cenourahub@gmail.com', connectedAt: '2026-09-22T00:00:00.000Z',
    });
    const response = await GET(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    const body = await response.json();
    expect(body).toEqual({
      configured: true, connected: true, googleAccountEmail: 'cenourahub@gmail.com',
      status: 'connected', connectedAt: '2026-09-22T00:00:00.000Z',
    });
    expect(JSON.stringify(body)).not.toMatch(/token|refresh/i);
  });

  it('sem env configurada, configured=false mas nao derruba a tela', async () => {
    resolveGoogleCalendarOAuthEnvMock.mockReturnValue(null);
    getGoogleCalendarConnectionMock.mockResolvedValue(null);
    const response = await GET(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    const body = await response.json();
    expect(body.configured).toBe(false);
    expect(body.connected).toBe(false);
  });

  it('sem responsavel configurado na agenda, devolve connected=false sem consultar a conexao', async () => {
    connectionRow!.config = { calendar: { ...(connectionRow!.config as { calendar: Record<string, unknown> }).calendar, ownerId: null } };
    const response = await GET(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    const body = await response.json();
    expect(body.connected).toBe(false);
    expect(getGoogleCalendarConnectionMock).not.toHaveBeenCalled();
  });

  it('sem conexao Google gravada, devolve connected=false', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(null);
    const response = await GET(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    const body = await response.json();
    expect(body.connected).toBe(false);
    expect(body.status).toBeNull();
  });

  it('canal nao encontrado, devolve 404', async () => {
    connectionRow = null;
    const response = await GET(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(404);
  });
});
