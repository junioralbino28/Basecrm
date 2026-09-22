import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';

const requireTenantAccessMock = vi.fn();
const isAllowedOriginMock = vi.fn(() => true);
const readGoogleCalendarRefreshTokenMock = vi.fn();
const deleteGoogleCalendarConnectionMock = vi.fn();
const revokeGoogleCalendarTokenMock = vi.fn();
const clearGoogleCalendarAccessTokenCacheMock = vi.fn();
let connectionRow: { id: string; config: Record<string, unknown> | null } | null = null;

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: (...args: unknown[]) => isAllowedOriginMock(...args) }));
vi.mock('@/lib/googleCalendar/oauth', () => ({
  revokeGoogleCalendarToken: (...args: unknown[]) => revokeGoogleCalendarTokenMock(...args),
  clearGoogleCalendarAccessTokenCache: (...args: unknown[]) => clearGoogleCalendarAccessTokenCacheMock(...args),
}));
vi.mock('@/lib/googleCalendar/connectionStore', () => ({
  readGoogleCalendarRefreshToken: (...args: unknown[]) => readGoogleCalendarRefreshTokenMock(...args),
  deleteGoogleCalendarConnection: (...args: unknown[]) => deleteGoogleCalendarConnectionMock(...args),
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

import { POST } from './route';

function request() {
  return new Request('http://localhost/google-calendar/disconnect', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  isAllowedOriginMock.mockReturnValue(true);
  requireTenantAccessMock.mockResolvedValue({ profile: { id: 'admin-1', organization_id: TENANT } });
  readGoogleCalendarRefreshTokenMock.mockResolvedValue('rt-1');
  revokeGoogleCalendarTokenMock.mockResolvedValue(true);
  deleteGoogleCalendarConnectionMock.mockResolvedValue(true);
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

describe('POST google-calendar/disconnect', () => {
  it('rejeita origem cross-site', async () => {
    isAllowedOriginMock.mockReturnValue(false);
    const response = await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(403);
  });

  it('revoga no Google (melhor esforco), apaga do Vault e limpa o cache em memoria', async () => {
    const response = await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(200);
    expect(revokeGoogleCalendarTokenMock).toHaveBeenCalledWith('rt-1');
    expect(deleteGoogleCalendarConnectionMock).toHaveBeenCalledWith(expect.objectContaining({ organizationId: TENANT, ownerId: OWNER }));
    expect(clearGoogleCalendarAccessTokenCacheMock).toHaveBeenCalledWith(TENANT, OWNER);
  });

  it('revoke falhando no Google ainda assim desconecta local (best-effort)', async () => {
    revokeGoogleCalendarTokenMock.mockResolvedValue(false);
    const response = await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.warning).toBeTruthy();
    expect(deleteGoogleCalendarConnectionMock).toHaveBeenCalled();
  });

  it('sem responsavel configurado, devolve 400', async () => {
    connectionRow!.config = { calendar: { ...(connectionRow!.config as { calendar: Record<string, unknown> }).calendar, ownerId: null } };
    const response = await POST(request(), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });
    expect(response.status).toBe(400);
    expect(deleteGoogleCalendarConnectionMock).not.toHaveBeenCalled();
  });
});
