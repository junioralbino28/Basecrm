import { describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

const loadGoogleBusyIntervalsMock = vi.fn();

// Isola a unidade sob teste (o merge feito em `loadAvailableMeetingSlots`) do resto da
// integracao do Google — freeBusy.ts, oauth.ts e googleApiClient.ts ja tem cobertura
// propria (lib/googleCalendar/*.test.ts), inclusive do caso "sem conexao = zero rede".
vi.mock('@/lib/googleCalendar/freeBusy', () => ({
  loadGoogleBusyIntervals: (...args: unknown[]) => loadGoogleBusyIntervalsMock(...args),
}));

import { loadAvailableMeetingSlots } from './aiReply';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';

const CALENDAR_CONFIG = {
  calendar: {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    ownerId: OWNER,
    minimumNoticeMinutes: 60,
    schedulingHorizonDays: 7,
    humanConfirmationWeekdays: ['saturday'],
    weeklyHours: {
      monday: [{ start: '09:00', end: '12:00' }],
      tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
    },
  },
};

function seedAdmin() {
  return createFakeSupabaseAdmin({ activities: [], conversation_calendar_blocks: [] });
}

describe('loadAvailableMeetingSlots — merge do ocupado do Google (Fatia 2)', () => {
  it('regressao: sem intervalos do Google, a oferta e identica a de hoje', async () => {
    loadGoogleBusyIntervalsMock.mockResolvedValue([]);
    const admin = seedAdmin();

    const result = await loadAvailableMeetingSlots({
      admin: admin as never,
      organizationId: ORG,
      connectionId: CONN,
      connectionConfig: CALENDAR_CONFIG,
      now: '2026-09-20T10:00:00.000Z',
    });

    expect(result.availableMeetingSlots.map(slot => slot.startAt)).toEqual([
      '2026-09-21T12:00:00.000Z',
      '2026-09-21T13:00:00.000Z',
      '2026-09-21T14:00:00.000Z',
    ]);
    expect(loadGoogleBusyIntervalsMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG,
      ownerId: OWNER,
    }));
  });

  it('agenda desativada: nem chama loadGoogleBusyIntervals', async () => {
    loadGoogleBusyIntervalsMock.mockResolvedValue([]);
    const admin = seedAdmin();

    const result = await loadAvailableMeetingSlots({
      admin: admin as never,
      organizationId: ORG,
      connectionId: CONN,
      connectionConfig: { calendar: { ...CALENDAR_CONFIG.calendar, enabled: false } },
      now: '2026-09-20T10:00:00.000Z',
    });

    expect(result.availableMeetingSlots).toEqual([]);
    expect(loadGoogleBusyIntervalsMock).not.toHaveBeenCalled();
  });

  it('evento do Google some da oferta: os horarios que ele cobre desaparecem', async () => {
    loadGoogleBusyIntervalsMock.mockResolvedValue([
      { start: '2026-09-21T13:30:00.000Z', end: '2026-09-21T16:30:00.000Z' },
    ]);
    const admin = seedAdmin();

    const result = await loadAvailableMeetingSlots({
      admin: admin as never,
      organizationId: ORG,
      connectionId: CONN,
      connectionConfig: CALENDAR_CONFIG,
      now: '2026-09-20T10:00:00.000Z',
    });

    expect(result.availableMeetingSlots.map(slot => slot.startAt)).toEqual([
      '2026-09-21T12:00:00.000Z',
    ]);
  });
});
