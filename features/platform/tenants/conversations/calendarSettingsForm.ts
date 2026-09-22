import type { ConversationCalendarConfig } from '@/lib/conversations/meetingAvailability';
import type { CalendarWeekday } from '@/lib/conversations/calendarBlocks';

export const CALENDAR_DAYS: Array<{ key: CalendarWeekday; label: string }> = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
];

/**
 * `min-w-0` nao e enfeite: campo de formulario tem largura MINIMA natural (o `size` padrao do
 * HTML, ~224 px medidos), e `w-full` nao vence isso. Sem ele, no celular o campo empurrava o
 * cartao inteiro e a tela de conexoes ganhava 66 px de rolagem lateral (medido na previa a 390 px).
 */
export const FIELD_CLASS = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 dark:border-slate-600 dark:bg-[#111b21] dark:text-slate-100';

type CalendarAssignee = { id: string; display_name: string };

function defaultWeeklyHours(): ConversationCalendarConfig['weeklyHours'] {
  return {
    monday: [{ start: '09:00', end: '19:00' }],
    tuesday: [{ start: '09:00', end: '19:00' }],
    wednesday: [{ start: '09:00', end: '19:00' }],
    thursday: [{ start: '09:00', end: '19:00' }],
    friday: [{ start: '09:00', end: '19:00' }],
    saturday: [],
    sunday: [],
  };
}

export function readInitialCalendar(value: unknown, assignees: CalendarAssignee[]) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ConversationCalendarConfig>
    : null;
  const fallback = defaultWeeklyHours();
  const weeklyHours = source?.weeklyHours
    ? Object.fromEntries(
        Object.keys(fallback).map(day => [
          day,
          Array.isArray(source.weeklyHours?.[day as CalendarWeekday])
            ? source.weeklyHours[day as CalendarWeekday].map(range => ({ ...range }))
            : [],
        ]),
      ) as ConversationCalendarConfig['weeklyHours']
    : fallback;

  weeklyHours.saturday = [];
  weeklyHours.sunday = [];
  return {
    enabled: source?.enabled === true,
    timezone: typeof source?.timezone === 'string' ? source.timezone : 'America/Sao_Paulo',
    ownerId: typeof source?.ownerId === 'string' ? source.ownerId : assignees[0]?.id || null,
    minimumNoticeMinutes: Number.isInteger(source?.minimumNoticeMinutes)
      ? Number(source?.minimumNoticeMinutes)
      : 60,
    schedulingHorizonDays: Number.isInteger(source?.schedulingHorizonDays)
      ? Number(source?.schedulingHorizonDays)
      : 14,
    humanConfirmationWeekdays: ['saturday'] as CalendarWeekday[],
    weeklyHours,
  };
}

export type CalendarFormState = ReturnType<typeof readInitialCalendar>;
