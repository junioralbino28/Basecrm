import { describe, expect, it } from 'vitest';
import {
  ConversationCalendarConfigSchema,
  MEETING_START_INTERVAL_MINUTES,
  MEETING_TARGET_DURATION_MINUTES,
  buildMeetingConflictWindow,
  buildMeetingSlots,
  formatMeetingAvailabilityContext,
  isHumanConfirmationMeetingRequest,
  isMeetingStartConflict,
  resolveConversationCalendarConfig,
} from './meetingAvailability';

const configuredCalendar = {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  ownerId: '11111111-1111-4111-8111-111111111111',
  minimumNoticeMinutes: 60,
  schedulingHorizonDays: 7,
  humanConfirmationWeekdays: ['saturday'],
  weeklyHours: {
    monday: [{ start: '09:00', end: '12:00' }],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  },
};

describe('meeting availability', () => {
  it('reserva 40 minutos de reuniao em inicios separados por 60 minutos', () => {
    expect(MEETING_TARGET_DURATION_MINUTES).toBe(40);
    expect(MEETING_START_INTERVAL_MINUTES).toBe(60);
  });

  it('constroi uma janela exclusiva de conflito em torno do inicio proposto', () => {
    expect(buildMeetingConflictWindow('2026-09-21T17:00:00.000Z')).toEqual({
      startsAfter: '2026-09-21T16:00:00.000Z',
      startsBefore: '2026-09-21T18:00:00.000Z',
    });
  });

  it.each([
    ['2026-09-21T16:30:00.000Z', true],
    ['2026-09-21T17:00:00.000Z', true],
    ['2026-09-21T17:59:59.999Z', true],
    ['2026-09-21T16:00:00.000Z', false],
    ['2026-09-21T18:00:00.000Z', false],
  ])('classifica %s como conflito=%s', (existingAt, expected) => {
    expect(isMeetingStartConflict('2026-09-21T17:00:00.000Z', existingAt)).toBe(expected);
  });

  it('rejeita data invalida', () => {
    expect(() => buildMeetingConflictWindow('invalida')).toThrow('Horario de reuniao invalido.');
  });

  it('falha fechado quando a agenda nao esta habilitada ou esta invalida', () => {
    expect(resolveConversationCalendarConfig({ calendar: { ...configuredCalendar, enabled: false } })).toBeNull();
    expect(resolveConversationCalendarConfig({ calendar: { ...configuredCalendar, timezone: 'Fuso/Inexistente' } })).toBeNull();
    expect(resolveConversationCalendarConfig({ calendar: { ...configuredCalendar, ownerId: null } })).toBeNull();
  });

  it('valida a configuracao completa da agenda', () => {
    expect(ConversationCalendarConfigSchema.parse(configuredCalendar)).toEqual(configuredCalendar);
  });

  it('gera somente slots livres de 40 minutos em inicios separados por 60 minutos', () => {
    expect(buildMeetingSlots({
      calendar: configuredCalendar,
      now: '2026-09-20T10:00:00.000Z',
      busyStarts: ['2026-09-21T13:00:00.000Z'],
      maxSlots: 10,
    }).map(slot => slot.startAt)).toEqual([
      '2026-09-21T12:00:00.000Z',
      '2026-09-21T14:00:00.000Z',
    ]);
  });

  it('remove almoço recorrente e folga pontual sem abrir horários no sábado', () => {
    const calendar = {
      ...configuredCalendar,
      weeklyHours: {
        ...configuredCalendar.weeklyHours,
        monday: [{ start: '09:00', end: '15:00' }],
        tuesday: [{ start: '09:00', end: '12:00' }],
        saturday: [{ start: '09:00', end: '12:00' }],
      },
    };

    expect(buildMeetingSlots({
      calendar,
      now: '2026-09-20T10:00:00.000Z',
      busyStarts: [],
      calendarBlocks: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Almoço',
          kind: 'lunch',
          recurrence: 'weekly',
          blockDate: null,
          weekdays: ['monday'],
          start: '12:00',
          end: '13:00',
          allDay: false,
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          title: 'Folga',
          kind: 'day_off',
          recurrence: 'once',
          blockDate: '2026-09-22',
          weekdays: [],
          start: '00:00',
          end: '23:59',
          allDay: true,
        },
      ],
      maxSlots: 20,
    }).map(slot => slot.startAt)).toEqual([
      '2026-09-21T12:00:00.000Z',
      '2026-09-21T13:00:00.000Z',
      '2026-09-21T14:00:00.000Z',
      '2026-09-21T16:00:00.000Z',
      '2026-09-21T17:00:00.000Z',
    ]);
  });

  it('mantem horários em ordem cronológica e informa a prioridade mais próxima no contexto', () => {
    const slots = buildMeetingSlots({
      calendar: {
        ...configuredCalendar,
        weeklyHours: {
          ...configuredCalendar.weeklyHours,
          monday: [{ start: '17:00', end: '19:00' }],
          tuesday: [{ start: '09:00', end: '11:00' }],
        },
      },
      now: '2026-09-21T18:00:00.000Z',
      busyStarts: [],
      maxSlots: 20,
    });

    expect(slots.map(slot => slot.startAt)).toEqual([
      '2026-09-21T20:00:00.000Z',
      '2026-09-21T21:00:00.000Z',
      '2026-09-22T12:00:00.000Z',
      '2026-09-22T13:00:00.000Z',
    ]);
    expect(formatMeetingAvailabilityContext(slots, configuredCalendar.timezone)).toMatch(
      /ofereca primeiro o horario livre mais proximo/i,
    );
  });

  it('encaminha pedidos de sábado para confirmação humana', () => {
    expect(isHumanConfirmationMeetingRequest({
      calendar: configuredCalendar,
      requestedScheduleAt: '2026-09-26T13:00:00.000Z',
      requestedScheduleText: null,
    })).toBe(true);
    expect(isHumanConfirmationMeetingRequest({
      calendar: configuredCalendar,
      requestedScheduleAt: null,
      requestedScheduleText: 'Pode ser sábado pela manhã',
    })).toBe(true);
    expect(isHumanConfirmationMeetingRequest({
      calendar: configuredCalendar,
      requestedScheduleAt: '2026-09-25T13:00:00.000Z',
      requestedScheduleText: 'sexta às 10h',
    })).toBe(false);
  });
});
