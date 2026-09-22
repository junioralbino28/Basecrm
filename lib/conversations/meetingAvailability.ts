import { z } from 'zod';
import {
  CalendarWeekdaySchema,
  type CalendarWeekday,
  type ConversationCalendarBlock,
} from './calendarBlocks';

export const MEETING_TARGET_DURATION_MINUTES = 40;
export const MEETING_START_INTERVAL_MINUTES = 60;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const TimeRangeSchema = z.object({
  start: z.string().regex(TIME_PATTERN),
  end: z.string().regex(TIME_PATTERN),
}).strict().refine(range => range.start < range.end, {
  message: 'O inicio precisa ser anterior ao fim.',
});

const WeeklyHoursSchema = z.object({
  monday: z.array(TimeRangeSchema).max(4),
  tuesday: z.array(TimeRangeSchema).max(4),
  wednesday: z.array(TimeRangeSchema).max(4),
  thursday: z.array(TimeRangeSchema).max(4),
  friday: z.array(TimeRangeSchema).max(4),
  saturday: z.array(TimeRangeSchema).max(4),
  sunday: z.array(TimeRangeSchema).max(4),
}).strict();

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export const ConversationCalendarConfigSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimezone, 'Fuso horario invalido.'),
  ownerId: z.string().uuid().nullable(),
  minimumNoticeMinutes: z.number().int().min(0).max(10_080),
  schedulingHorizonDays: z.number().int().min(1).max(14),
  humanConfirmationWeekdays: z.array(CalendarWeekdaySchema).max(7).default(['saturday']),
  /**
   * Convidados FIXOS do evento do Google, alem do lead. A agenda em que a Aurora escreve pode
   * ser de uma conta (cenourahub@gmail.com) e quem conduz a reuniao usar outra: sem isso o
   * convite so chega na conta dona da agenda. Opcional — conexao sem o campo continua valida e
   * o evento sai exatamente como hoje.
   */
  extraAttendees: z.array(z.string().email()).max(5).optional(),
  /**
   * Nome que aparece no TITULO e na descricao do evento do Google. Por conexao porque o
   * convite sai na agenda do cliente: sem isto, o evento dele sairia com o nome da agencia.
   * Continua FIXO (nunca gerado pelo LLM, G16) — so deixou de ser fixo no CODIGO.
   */
  meetingBrandName: z.string().trim().min(1).max(60).optional(),
  weeklyHours: WeeklyHoursSchema,
}).strict().superRefine((calendar, context) => {
  const ranges = Object.values(calendar.weeklyHours).flat();
  if (calendar.enabled && ranges.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['weeklyHours'],
      message: 'Configure ao menos uma faixa de atendimento.',
    });
  }
  if (calendar.enabled && !calendar.ownerId) {
    context.addIssue({
      code: 'custom',
      path: ['ownerId'],
      message: 'Selecione o responsavel pela agenda.',
    });
  }
});

export type ConversationCalendarConfig = z.infer<typeof ConversationCalendarConfigSchema>;

export type MeetingSlot = {
  startAt: string;
  label: string;
};

/**
 * Intervalo ocupado vindo de fora do CRM (hoje: freeBusy do Google Agenda). Diferente de
 * `busyStarts` (pontos, sempre com janela fixa de 60 min via `isMeetingStartConflict`), um
 * intervalo bloqueia todo horario cujo bloco `[inicio, inicio+60min)` o sobreponha — cobre
 * evento longo, dia inteiro e evento de varios dias sem mudar a semantica de `busyStarts`.
 */
export type BusyInterval = {
  start: string;
  end: string;
};

function parseIsoTimestamp(value: string, message: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(message);
  return timestamp;
}

export function buildMeetingConflictWindow(startAt: string) {
  const timestamp = parseIsoTimestamp(startAt, 'Horario de reuniao invalido.');
  const interval = MEETING_START_INTERVAL_MINUTES * MINUTE_MS;
  return {
    startsAfter: new Date(timestamp - interval).toISOString(),
    startsBefore: new Date(timestamp + interval).toISOString(),
  };
}

export function isMeetingStartConflict(proposedAt: string, existingAt: string) {
  const proposed = parseIsoTimestamp(proposedAt, 'Horario de reuniao invalido.');
  const existing = parseIsoTimestamp(existingAt, 'Horario existente invalido.');
  return Math.abs(proposed - existing) < MEETING_START_INTERVAL_MINUTES * MINUTE_MS;
}

export function resolveConversationCalendarConfig(
  config: Record<string, unknown> | null | undefined,
) {
  const parsed = ConversationCalendarConfigSchema.safeParse(config?.calendar);
  return parsed.success && parsed.data.enabled ? parsed.data : null;
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function localDateAtOffset(now: Date, timezone: string, dayOffset: number) {
  const local = zonedParts(now, timezone);
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function weekdayForDate(year: number, month: number, day: number): CalendarWeekday {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
  }).format(new Date(Date.UTC(year, month - 1, day))).toLowerCase();
  return CalendarWeekdaySchema.parse(weekday);
}

function zonedWallTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone: string;
}) {
  const target = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0);
  let guess = target;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = zonedParts(new Date(guess), input.timezone);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
    );
    const adjustment = target - renderedAsUtc;
    guess += adjustment;
    if (adjustment === 0) break;
  }

  const verified = zonedParts(new Date(guess), input.timezone);
  if (
    verified.year !== input.year
    || verified.month !== input.month
    || verified.day !== input.day
    || verified.hour !== input.hour
    || verified.minute !== input.minute
  ) {
    return null;
  }
  return new Date(guess);
}

function minutesFromTime(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function formatSlot(startAt: string, timezone: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(startAt));
}

export function buildMeetingSlots(input: {
  calendar: ConversationCalendarConfig;
  now: string;
  busyStarts: string[];
  /** Opcional e aditivo: sem ele, comportamento byte a byte igual (Google Agenda, Fatia 2). */
  busyIntervals?: BusyInterval[];
  calendarBlocks?: ConversationCalendarBlock[];
  maxSlots?: number;
}) {
  const calendar = ConversationCalendarConfigSchema.parse(input.calendar);
  if (!calendar.enabled) return [];

  const nowTimestamp = parseIsoTimestamp(input.now, 'Data atual invalida.');
  const earliestStart = nowTimestamp + calendar.minimumNoticeMinutes * MINUTE_MS;
  const horizonEnd = nowTimestamp + calendar.schedulingHorizonDays * DAY_MS;
  const busyStarts = input.busyStarts.filter(value => Number.isFinite(new Date(value).getTime()));
  const busyIntervals = (input.busyIntervals || [])
    .map(interval => ({ start: new Date(interval.start).getTime(), end: new Date(interval.end).getTime() }))
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start);
  const maxSlots = Math.max(1, Math.min(input.maxSlots ?? 200, 500));
  const calendarBlocks = input.calendarBlocks || [];
  const slots: MeetingSlot[] = [];

  for (let offset = 0; offset <= calendar.schedulingHorizonDays && slots.length < maxSlots; offset += 1) {
    const localDate = localDateAtOffset(new Date(nowTimestamp), calendar.timezone, offset);
    const weekday = weekdayForDate(localDate.year, localDate.month, localDate.day);
    if (calendar.humanConfirmationWeekdays.includes(weekday)) continue;
    const localDateKey = [localDate.year, String(localDate.month).padStart(2, '0'), String(localDate.day).padStart(2, '0')].join('-');

    for (const range of calendar.weeklyHours[weekday]) {
      const rangeStart = minutesFromTime(range.start);
      const rangeEnd = minutesFromTime(range.end);

      for (
        let localMinutes = rangeStart;
        localMinutes + MEETING_TARGET_DURATION_MINUTES <= rangeEnd;
        localMinutes += MEETING_START_INTERVAL_MINUTES
      ) {
        const start = zonedWallTimeToUtc({
          ...localDate,
          hour: Math.floor(localMinutes / 60),
          minute: localMinutes % 60,
          timezone: calendar.timezone,
        });
        if (!start) continue;

        const startAt = start.toISOString();
        const startTimestamp = start.getTime();
        if (startTimestamp < earliestStart || startTimestamp > horizonEnd) continue;
        if (busyStarts.some(existing => isMeetingStartConflict(startAt, existing))) continue;
        // Bloco de 60 min (o mesmo espacamento entre inicios) contra o intervalo ocupado do
        // Google: um intervalo que TERMINA exatamente quando o bloco comeca nao conflita.
        const slotBlockEnd = startTimestamp + MEETING_START_INTERVAL_MINUTES * MINUTE_MS;
        if (busyIntervals.some(interval => startTimestamp < interval.end && slotBlockEnd > interval.start)) continue;
        const meetingEnd = localMinutes + MEETING_TARGET_DURATION_MINUTES;
        const hasManualBlock = calendarBlocks.some((block) => {
          const applies = block.recurrence === 'once'
            ? block.blockDate === localDateKey
            : block.weekdays.includes(weekday);
          if (!applies) return false;
          const blockStart = minutesFromTime(block.start);
          const blockEnd = minutesFromTime(block.end);
          return localMinutes < blockEnd && meetingEnd > blockStart;
        });
        if (hasManualBlock) continue;

        slots.push({ startAt, label: formatSlot(startAt, calendar.timezone) });
        if (slots.length >= maxSlots) break;
      }
    }
  }

  return slots;
}

export function formatMeetingAvailabilityContext(
  slots: MeetingSlot[],
  calendarOrTimezone: ConversationCalendarConfig | string,
) {
  if (slots.length === 0) {
    return 'AGENDA_CONFIGURADA_SEM_HORARIOS_LIVRES. Nao confirme horario; registre o pedido para atendimento humano.';
  }

  const timezone = typeof calendarOrTimezone === 'string'
    ? calendarOrTimezone
    : calendarOrTimezone.timezone;
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const humanOnly = typeof calendarOrTimezone === 'string'
    ? ''
    : ' Sabado exige confirmacao humana e nunca pode ser confirmado automaticamente.';

  return `AGENDA_CONFIGURADA. Ofereca primeiro o horario livre mais proximo: mesmo dia, depois dia seguinte, e so avance se o lead nao puder.${humanOnly} Horarios livres validados: ${slots
    .map(slot => `${formatter.format(new Date(slot.startAt))} [${slot.startAt}]`)
    .join('; ')}.`;
}

const WEEKDAY_TEXT: Record<CalendarWeekday, RegExp> = {
  monday: /\bsegunda(?:-feira)?\b/i,
  tuesday: /\bterca(?:-feira)?\b/i,
  wednesday: /\bquarta(?:-feira)?\b/i,
  thursday: /\bquinta(?:-feira)?\b/i,
  friday: /\bsexta(?:-feira)?\b/i,
  saturday: /\bsabado\b/i,
  sunday: /\bdomingo\b/i,
};

function normalizeSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function isHumanConfirmationMeetingRequest(input: {
  calendar: ConversationCalendarConfig;
  requestedScheduleAt: string | null | undefined;
  requestedScheduleText: string | null | undefined;
}) {
  const calendar = ConversationCalendarConfigSchema.parse(input.calendar);
  if (input.requestedScheduleAt) {
    const requested = new Date(input.requestedScheduleAt);
    if (Number.isFinite(requested.getTime())) {
      const parts = zonedParts(requested, calendar.timezone);
      const weekday = weekdayForDate(parts.year, parts.month, parts.day);
      if (calendar.humanConfirmationWeekdays.includes(weekday)) return true;
    }
  }

  const requestedText = normalizeSearchText(input.requestedScheduleText || '');
  return calendar.humanConfirmationWeekdays.some(weekday => WEEKDAY_TEXT[weekday].test(requestedText));
}
