'use client';

import React from 'react';
import { CalendarClock, Check, ChevronDown, Loader2 } from 'lucide-react';
import type { ConversationCalendarConfig } from '@/lib/conversations/meetingAvailability';
import { CalendarBlocksPanel } from './CalendarBlocksPanel';
import { FIELD_CLASS, readInitialCalendar } from './calendarSettingsForm';
import { WeeklyAvailabilityEditor } from './WeeklyAvailabilityEditor';

type CalendarAssignee = { id: string; display_name: string };

export function ChannelCalendarSettings({
  tenantId,
  connectionId,
  initialCalendar,
  assignees,
  disabled,
  onSaved,
}: {
  tenantId: string;
  connectionId: string;
  initialCalendar: unknown;
  assignees: CalendarAssignee[];
  disabled: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const initial = React.useMemo(
    () => readInitialCalendar(initialCalendar, assignees),
    [assignees, initialCalendar],
  );
  const [expanded, setExpanded] = React.useState(false);
  const [form, setForm] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => setForm(initial), [initial]);

  async function save() {
    setMessage(null);
    const ranges = Object.values(form.weeklyHours).flat();
    if (form.enabled && ranges.length === 0) return setMessage('Configure pelo menos uma faixa de atendimento.');
    if (form.enabled && !form.ownerId) return setMessage('Selecione quem ficará responsável pelas reuniões.');
    if (ranges.some(range => range.start >= range.end)) return setMessage('O horário final precisa ser posterior ao inicial.');

    const calendar: ConversationCalendarConfig = {
      enabled: form.enabled,
      timezone: form.timezone.trim(),
      ownerId: form.ownerId,
      minimumNoticeMinutes: form.minimumNoticeMinutes,
      schedulingHorizonDays: form.schedulingHorizonDays,
      humanConfirmationWeekdays: ['saturday'],
      weeklyHours: { ...form.weeklyHours, saturday: [], sunday: [] },
    };

    setSaving(true);
    try {
      const response = await fetch(`/api/platform/tenants/${tenantId}/channels/${connectionId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ config: { calendar } }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Falha ao salvar a agenda.');
      setMessage(form.enabled ? 'Agenda ativa para a IA.' : 'Agenda automática desativada.');
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar a agenda.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-3 rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-card">
      <button type="button" onClick={() => setExpanded(current => !current)} className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={expanded}>
        <span className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-amber-400" aria-hidden="true" />
          <span><span className="block text-sm font-semibold text-slate-900 dark:text-white">Agenda da IA</span><span className="block text-xs text-slate-500 dark:text-slate-400">{initial.enabled ? 'Autonomia ativa' : 'Desativada até configurar'} · 40 min, inícios a cada 60 min</span></span>
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded ? (
        <div className="border-t border-slate-200 p-4 dark:border-white/10">
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-slate-800 dark:text-slate-100">
            Permitir que a IA ofereça e agende horários livres
            <input type="checkbox" checked={form.enabled} disabled={disabled || saving} onChange={event => setForm(current => ({ ...current, enabled: event.target.checked }))} className="h-5 w-5 rounded border-slate-300 text-amber-500 focus:ring-amber-400" />
          </label>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 md:col-span-2">Responsável pelas reuniões<select className={`${FIELD_CLASS} mt-1`} value={form.ownerId || ''} onChange={event => setForm(current => ({ ...current, ownerId: event.target.value || null }))} disabled={disabled || saving}><option value="">Selecione um responsável</option>{assignees.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.display_name}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Fuso horário<input className={`${FIELD_CLASS} mt-1`} value={form.timezone} onChange={event => setForm(current => ({ ...current, timezone: event.target.value }))} disabled={disabled || saving} /></label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Antecedência mínima (min)<input className={`${FIELD_CLASS} mt-1`} type="number" min={0} max={10080} value={form.minimumNoticeMinutes} onChange={event => setForm(current => ({ ...current, minimumNoticeMinutes: Number(event.target.value) }))} disabled={disabled || saving} /></label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 md:col-span-2">Até quantos dias à frente<input className={`${FIELD_CLASS} mt-1 md:max-w-xs`} type="number" min={1} max={14} value={form.schedulingHorizonDays} onChange={event => setForm(current => ({ ...current, schedulingHorizonDays: Number(event.target.value) }))} disabled={disabled || saving} /></label>
          </div>

          <WeeklyAvailabilityEditor value={form.weeklyHours} disabled={disabled || saving} onChange={weeklyHours => setForm(current => ({ ...current, weeklyHours }))} />
          <CalendarBlocksPanel key={initial.ownerId || 'sem-responsavel'} tenantId={tenantId} connectionId={connectionId} disabled={disabled || saving} />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className={`text-xs ${message?.startsWith('Falha') || message?.includes('precisa') || message?.includes('Configure') || message?.includes('Selecione') ? 'text-rose-400' : 'text-emerald-500'}`} role="status">{message}</p>
            <button type="button" onClick={() => void save()} disabled={disabled || saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar agenda
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
