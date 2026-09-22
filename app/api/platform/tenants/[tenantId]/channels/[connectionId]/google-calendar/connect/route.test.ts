import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';

const requireTenantAccessMock = vi.fn();
const isAllowedOriginMock = vi.fn(() => true);
const resolveGoogleCalendarOAuthEnvMock = vi.fn();
const isAllowedGoogleOAuthOriginMock = vi.fn(() => true);
const createGoogleOAuthStateMock = vi.fn();
let connectionRow: { id: string; config: Record<string, unknown> | null } | null = null;

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: (...args: unknown[]) => isAllowedOriginMock(...args) }));
vi.mock('@/lib/googleCalendar/oauth', () => ({
  resolveGoogleCalendarOAuthEnv: () => resolveGoogleCalendarOAuthEnvMock(),
  isAllowedGoogleOAuthOrigin: (...args: unknown[]) => isAllowedGoogleOAuthOriginMock(...args),
  buildGoogleCalendarRedirectUri: (origin: string) => `${origin}/api/integrations/google-calendar/callback`,
  buildGoogleCalendarAuthUrl: (input: { clientId: string; redirectUri: string; state: string }) =>
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=${input.clientId}&redirect_uri=${encodeURIComponent(input.redirectUri)}&state=${input.state}`,
}));
vi.mock('@/lib/googleCalendar/oauthState', () => ({
  createGoogleOAuthState: (...args: unknown[]) => createGoogleOAuthStateMock(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'channel_connections') throw new Error(`tabela inesperada: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: connectionRow, error: null }),
            }),
          }),
        }),
      };
    },
  }),
}));

import { POST } from './route';

function request() {
  return new Request('http://localhost/google-calendar/connect', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  isAllowedOriginMock.mockReturnValue(true);
  isAllowedGoogleOAuthOriginMock.mockReturnValue(true);
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
  createGoogleOAuthStateMock.mockResolvedValue({ state: 'state-123' });
});

describe('POST google-calendar/connect', () => {
  it('rejeita origem cross-site (CSRF)', async () => {
    isAllowedOriginMock.mockReturnValue(false);
    const response = await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(403);
    expect(createGoogleOAuthStateMock).not.toHaveBeenCalled();
  });

  it('exige permissao whatsapp.manage_connection', async () => {
    await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(requireTenantAccessMock).toHaveBeenCalledWith(TENANT, { requiredPermissions: ['whatsapp.manage_connection'] });
  });

  it('sem GOOGLE_OAUTH_CLIENT_ID/SECRET, devolve 503 "nao configurado"', async () => {
    resolveGoogleCalendarOAuthEnvMock.mockReturnValue(null);
    const response = await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(503);
    expect(createGoogleOAuthStateMock).not.toHaveBeenCalled();
  });

  it('sem responsavel configurado na agenda, devolve 400 e nao cria state', async () => {
    connectionRow!.config = { calendar: { ...(connectionRow!.config as { calendar: Record<string, unknown> }).calendar, ownerId: null } };
    const response = await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(400);
    expect(createGoogleOAuthStateMock).not.toHaveBeenCalled();
  });

  it('rejeita origem nao cadastrada no client OAuth do Google', async () => {
    isAllowedGoogleOAuthOriginMock.mockReturnValue(false);
    const response = await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(400);
    expect(createGoogleOAuthStateMock).not.toHaveBeenCalled();
  });

  it('canal nao encontrado no tenant, devolve 404', async () => {
    connectionRow = null;
    const response = await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(404);
  });

  it('sucesso: le ownerId do servidor, grava o state e devolve a url de consentimento', async () => {
    const response = await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toContain('state=state-123');
    expect(body.url).toContain(encodeURIComponent('http://localhost/api/integrations/google-calendar/callback'));

    expect(createGoogleOAuthStateMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: TENANT,
      channelConnectionId: CONNECTION,
      ownerId: OWNER,
      requestedBy: 'admin-1',
      redirectOrigin: 'http://localhost',
    }));
  });
});
