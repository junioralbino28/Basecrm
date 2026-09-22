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

  it('busyIntervals (Google): evento de 3 horas bloqueia so os inicios que ele sobrepoe', () => {
    // Monday 2026-09-21 09:00-12:00 local (America/Sao_Paulo) = 12:00/13:00/14:00 UTC.
    // Evento 13:30-16:30 UTC: nao toca o bloco [12:00,13:00), toca [13:00,14:00) e [14:00,15:00).
    expect(buildMeetingSlots({
      calendar: configuredCalendar,
      now: '2026-09-20T10:00:00.000Z',
      busyStarts: [],
      busyIntervals: [{ start: '2026-09-21T13:30:00.000Z', end: '2026-09-21T16:30:00.000Z' }],
      maxSlots: 10,
    }).map(slot => slot.startAt)).toEqual(['2026-09-21T12:00:00.000Z']);
  });

  it('busyIntervals (Google): evento de dia inteiro bloqueia todos os horarios do dia', () => {
    expect(buildMeetingSlots({
      calendar: configuredCalendar,
      now: '2026-09-20T10:00:00.000Z',
      busyStarts: [],
      busyIntervals: [{ start: '2026-09-21T00:00:00.000Z', end: '2026-09-22T00:00:00.000Z' }],
      maxSlots: 10,
    })).toEqual([]);
  });

  it('busyIntervals (Google): evento de varios dias bloqueia os dias cobertos e deixa os de fora livres', () => {
    const calendar = { ...configuredCalendar, schedulingHorizonDays: 10 };
    // Cobre a segunda 21/09 e a terca 22/09 (sem horario configurado); a proxima segunda
    // (28/09) fica fora do intervalo e continua livre.
    expect(buildMeetingSlots({
      calendar,
      now: '2026-09-20T10:00:00.000Z',
      busyStarts: [],
      busyIntervals: [{ start: '2026-09-21T00:00:00.000Z', end: '2026-09-23T00:00:00.000Z' }],
      maxSlots: 20,
    }).map(slot => slot.startAt)).toEqual([
      '2026-09-28T12:00:00.000Z',
      '2026-09-28T13:00:00.000Z',
      '2026-09-28T14:00:00.000Z',
    ]);
  });

  it('busyIntervals (Google): intervalo que termina exatamente quando o horario comeca nao conflita (borda exata)', () => {
    expect(buildMeetingSlots({
      calendar: configuredCalendar,
      now: '2026-09-20T10:00:00.000Z',
      busyStarts: [],
      busyIntervals: [{ start: '2026-09-19T00:00:00.000Z', end: '2026-09-21T12:00:00.000Z' }],
      maxSlots: 10,
    }).map(slot => slot.startAt)).toEqual([
      '2026-09-21T12:00:00.000Z',
      '2026-09-21T13:00:00.000Z',
      '2026-09-21T14:00:00.000Z',
    ]);
  });

  it('busyIntervals ausente ou vazio: comportamento byte a byte igual ao de antes (regressao)', () => {
    const base = {
      calendar: configuredCalendar,
      now: '2026-09-20T10:00:00.000Z',
      busyStarts: ['2026-09-21T13:00:00.000Z'],
      maxSlots: 10,
    };
    const withoutParam = buildMeetingSlots(base).map(slot => slot.startAt);
    const withEmptyArray = buildMeetingSlots({ ...base, busyIntervals: [] }).map(slot => slot.startAt);
    expect(withEmptyArray).toEqual(withoutParam);
    expect(withoutParam).toEqual(['2026-09-21T12:00:00.000Z', '2026-09-21T14:00:00.000Z']);
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

describe('convidados fixos do evento do Google (extraAttendees)', () => {
  it('REGRESSAO: configuracao sem o campo continua valida e sem convidado fixo nenhum', () => {
    const parsed = ConversationCalendarConfigSchema.safeParse(configuredCalendar);
    expect(parsed.success).toBe(true);
    expect(resolveConversationCalendarConfig({ calendar: configuredCalendar })?.extraAttendees).toBeUndefined();
  });

  it('aceita ate 5 e-mails e recusa o sexto', () => {
    const cinco = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'];
    expect(ConversationCalendarConfigSchema.safeParse({
      ...configuredCalendar, extraAttendees: cinco,
    }).success).toBe(true);
    expect(ConversationCalendarConfigSchema.safeParse({
      ...configuredCalendar, extraAttendees: [...cinco, 'f@x.com'],
    }).success).toBe(false);
  });

  it('recusa o que nao e e-mail', () => {
    expect(ConversationCalendarConfigSchema.safeParse({
      ...configuredCalendar, extraAttendees: ['nao-e-email'],
    }).success).toBe(false);
  });

  it('devolve os e-mails fixos configurados', () => {
    expect(resolveConversationCalendarConfig({
      calendar: { ...configuredCalendar, extraAttendees: ['junioralbino28@gmail.com'] },
    })?.extraAttendees).toEqual(['junioralbino28@gmail.com']);
  });
});
