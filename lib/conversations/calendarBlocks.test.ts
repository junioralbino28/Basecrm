import { describe, expect, it } from 'vitest';
import {
  ConversationCalendarBlockInputSchema,
  mapConversationCalendarBlockRow,
} from './calendarBlocks';

describe('calendar blocks', () => {
  it('aceita almoço semanal e normaliza horários vindos do Postgres', () => {
    const input = ConversationCalendarBlockInputSchema.parse({
      title: 'Almoço',
      kind: 'lunch',
      recurrence: 'weekly',
      blockDate: null,
      weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      start: '12:00',
      end: '13:00',
      allDay: false,
    });
    expect(input.weekdays).toHaveLength(5);

    expect(mapConversationCalendarBlockRow({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Almoço',
      kind: 'lunch',
      recurrence: 'weekly',
      block_date: null,
      weekdays: ['monday'],
      start_time: '12:00:00',
      end_time: '13:00:00',
      all_day: false,
    })).toMatchObject({ start: '12:00', end: '13:00' });
  });

  it('exige data em bloqueio pontual e ao menos um dia no recorrente', () => {
    expect(ConversationCalendarBlockInputSchema.safeParse({
      title: 'Folga', kind: 'day_off', recurrence: 'once', blockDate: null,
      weekdays: [], start: '00:00', end: '23:59', allDay: true,
    }).success).toBe(false);
    expect(ConversationCalendarBlockInputSchema.safeParse({
      title: 'Almoço', kind: 'lunch', recurrence: 'weekly', blockDate: null,
      weekdays: [], start: '12:00', end: '13:00', allDay: false,
    }).success).toBe(false);
  });
});
