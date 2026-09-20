'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { ConversationCalendarConfig } from '@/lib/conversations/meetingAvailability';
import type { CalendarWeekday } from '@/lib/conversations/calendarBlocks';
import { CALENDAR_DAYS, FIELD_CLASS } from './calendarSettingsForm';

type WeeklyHours = ConversationCalendarConfig['weeklyHours'];

export function WeeklyAvailabilityEditor({
  value,
  disabled,
  onChange,
}: {
  value: WeeklyHours;
  disabled: boolean;
  onChange: (value: WeeklyHours) => void;
}) {
  function setDay(day: CalendarWeekday, ranges: WeeklyHours[CalendarWeekday]) {
    onChange({ ...value, [day]: ranges });
  }

  return (
    <fieldset className="mt-5">
      <legend className="text-xs font-semibold text-slate-600 dark:text-slate-300">Expediente regular</legend>
      <div className="mt-2 space-y-3">
        {CALENDAR_DAYS.map(({ key, label }) => {
          const ranges = value[key];
          return (
            <div key={key} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
              <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                <input
                  type="checkbox"
                  checked={ranges.length > 0}
                  disabled={disabled}
                  onChange={event => setDay(key, event.target.checked ? [{ start: '09:00', end: '19:00' }] : [])}
                  className="h-5 w-5 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
                />
                {label}
              </label>
              {ranges.map((range, index) => (
                <div key={`${key}-${index}`} className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    Início
                    <input className={`${FIELD_CLASS} mt-1`} type="time" value={range.start} disabled={disabled} onChange={event => setDay(key, ranges.map((item, itemIndex) => itemIndex === index ? { ...item, start: event.target.value } : item))} />
                  </label>
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    Fim
                    <input className={`${FIELD_CLASS} mt-1`} type="time" value={range.end} disabled={disabled} onChange={event => setDay(key, ranges.map((item, itemIndex) => itemIndex === index ? { ...item, end: event.target.value } : item))} />
                  </label>
                  <button type="button" aria-label={`Remover faixa de ${label.toLowerCase()}`} disabled={disabled} onClick={() => setDay(key, ranges.filter((_, itemIndex) => itemIndex !== index))} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-slate-300 text-slate-500 hover:text-rose-500 dark:border-slate-600 dark:text-slate-300">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
              {ranges.length > 0 && ranges.length < 4 ? (
                <button type="button" disabled={disabled} onClick={() => setDay(key, [...ranges, { start: '09:00', end: '19:00' }])} className="mt-2 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-amber-500">
                  <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar faixa em {label.toLowerCase()}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Sábados ficam fora da agenda automática e sempre pedem confirmação humana.</p>
    </fieldset>
  );
}
