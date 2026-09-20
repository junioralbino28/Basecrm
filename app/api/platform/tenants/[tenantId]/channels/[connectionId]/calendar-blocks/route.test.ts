import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenantAccessMock = vi.fn();
const insertMock = vi.fn();
const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';

const calendar = {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  ownerId: OWNER,
  minimumNoticeMinutes: 60,
  schedulingHorizonDays: 14,
  humanConfirmationWeekdays: ['saturday'],
  weeklyHours: {
    monday: [{ start: '09:00', end: '19:00' }],
    tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
  },
};

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: (table: string) => {
      if (table === 'channel_connections') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: CONNECTION, config: { calendar } }, error: null }),
              }),
            }),
          }),
        };
      }
      return {
        insert: (row: Record<string, unknown>) => {
          insertMock(row);
          return {
            select: () => ({
              single: () => Promise.resolve({
                data: {
                  id: '44444444-4444-4444-8444-444444444444',
                  ...row,
                },
                error: null,
              }),
            }),
          };
        },
      };
    },
  }),
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({
    profile: { id: '55555555-5555-4555-8555-555555555555', organization_id: TENANT },
  });
});

describe('calendar blocks route', () => {
  it('cria bloqueio no tenant, conexão e responsável obtidos no servidor', async () => {
    const response = await POST(new Request('http://localhost/calendar-blocks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Almoço', kind: 'lunch', recurrence: 'weekly', blockDate: null,
        weekdays: ['monday', 'tuesday'], start: '12:00', end: '13:00', allDay: false,
      }),
    }), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });

    expect(response.status).toBe(201);
    expect(requireTenantAccessMock).toHaveBeenCalledWith(TENANT, {
      requiredPermissions: ['whatsapp.manage_connection'],
    });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: TENANT,
      channel_connection_id: CONNECTION,
      owner_id: OWNER,
      start_time: '12:00',
      end_time: '13:00',
    }));
  });

  it('rejeita campos inesperados antes de acessar o banco', async () => {
    const response = await POST(new Request('http://localhost/calendar-blocks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Ataque', kind: 'busy', recurrence: 'once', blockDate: '2026-09-20',
        weekdays: [], start: '10:00', end: '11:00', allDay: false,
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    }), { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) });

    expect(response.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
