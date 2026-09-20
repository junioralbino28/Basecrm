import { z } from 'zod';

export const CALENDAR_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export const CalendarWeekdaySchema = z.enum(CALENDAR_WEEKDAYS);
export type CalendarWeekday = z.infer<typeof CalendarWeekdaySchema>;

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const ConversationCalendarBlockInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  kind: z.enum(['busy', 'lunch', 'day_off', 'other']),
  recurrence: z.enum(['once', 'weekly']),
  blockDate: z.string().regex(DATE_PATTERN).nullable(),
  weekdays: z.array(CalendarWeekdaySchema).max(7),
  start: z.string().regex(TIME_PATTERN),
  end: z.string().regex(TIME_PATTERN),
  allDay: z.boolean(),
}).strict().superRefine((block, context) => {
  if (block.recurrence === 'once' && !block.blockDate) {
    context.addIssue({ code: 'custom', path: ['blockDate'], message: 'Informe a data do bloqueio.' });
  }
  if (block.recurrence === 'weekly' && block.weekdays.length === 0) {
    context.addIssue({ code: 'custom', path: ['weekdays'], message: 'Selecione ao menos um dia.' });
  }
  if (!block.allDay && block.start >= block.end) {
    context.addIssue({ code: 'custom', path: ['end'], message: 'O fim precisa ser posterior ao início.' });
  }
});

export type ConversationCalendarBlockInput = z.infer<typeof ConversationCalendarBlockInputSchema>;
export type ConversationCalendarBlock = ConversationCalendarBlockInput & { id: string };

type ConversationCalendarBlockRow = {
  id: unknown;
  title: unknown;
  kind: unknown;
  recurrence: unknown;
  block_date: unknown;
  weekdays: unknown;
  start_time: unknown;
  end_time: unknown;
  all_day: unknown;
};

export function mapConversationCalendarBlockRow(row: ConversationCalendarBlockRow) {
  return {
    id: String(row.id),
    title: String(row.title),
    kind: row.kind,
    recurrence: row.recurrence,
    blockDate: row.block_date ? String(row.block_date) : null,
    weekdays: Array.isArray(row.weekdays) ? row.weekdays : [],
    start: String(row.start_time).slice(0, 5),
    end: String(row.end_time).slice(0, 5),
    allDay: row.all_day === true,
  } as ConversationCalendarBlock;
}

export function toConversationCalendarBlockRow(input: ConversationCalendarBlockInput) {
  return {
    title: input.title,
    kind: input.kind,
    recurrence: input.recurrence,
    block_date: input.recurrence === 'once' ? input.blockDate : null,
    weekdays: input.recurrence === 'weekly' ? input.weekdays : [],
    start_time: input.allDay ? '00:00' : input.start,
    end_time: input.allDay ? '23:59' : input.end,
    all_day: input.allDay,
  };
}
