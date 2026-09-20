'use client';

import React from 'react';
import { ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react';
import type { CalendarWeekday, ConversationCalendarBlock } from '@/lib/conversations/calendarBlocks';
import { CALENDAR_DAYS, FIELD_CLASS } from './calendarSettingsForm';

export function CalendarBlocksPanel({ tenantId, connectionId, disabled }: { tenantId: string; connectionId: string; disabled: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const [blocks, setBlocks] = React.useState<ConversationCalendarBlock[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [recurrence, setRecurrence] = React.useState<'once' | 'weekly'>('weekly');
  const [kind, setKind] = React.useState<'busy' | 'lunch' | 'day_off' | 'other'>('lunch');
  const [title, setTitle] = React.useState('Almoço');
  const [blockDate, setBlockDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [weekdays, setWeekdays] = React.useState<CalendarWeekday[]>(CALENDAR_DAYS.map(day => day.key));
  const [start, setStart] = React.useState('12:00');
  const [end, setEnd] = React.useState('13:00');
  const [allDay, setAllDay] = React.useState(false);
  const endpoint = `/api/platform/tenants/${tenantId}/channels/${connectionId}/calendar-blocks`;

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { credentials: 'include', headers: { accept: 'application/json' } });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Falha ao carregar bloqueios.');
      setBlocks(Array.isArray(body?.blocks) ? body.blocks : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao carregar bloqueios.');
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && blocks.length === 0) await load();
  }

  async function createBlock() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ title, kind, recurrence, blockDate: recurrence === 'once' ? blockDate : null, weekdays: recurrence === 'weekly' ? weekdays : [], start, end, allDay }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Falha ao criar bloqueio.');
      setBlocks(current => [...current, body.block]);
      setMessage('Bloqueio adicionado.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao criar bloqueio.');
    } finally {
      setSaving(false);
    }
  }

  async function removeBlock(blockId: string) {
    setSaving(true);
    const response = await fetch(`${endpoint}/${blockId}`, { method: 'DELETE', credentials: 'include', headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => null);
    if (response.ok) setBlocks(current => current.filter(block => block.id !== blockId));
    setMessage(response.ok ? 'Bloqueio removido.' : body?.error || 'Falha ao remover bloqueio.');
    setSaving(false);
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 dark:border-white/10">
      <button type="button" onClick={() => void toggleExpanded()} className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm font-semibold text-slate-800 dark:text-slate-100" aria-expanded={expanded}>
        Bloqueios de almoço, folga e ocupado
        <ChevronDown className={`h-4 w-4 transition ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="space-y-4 border-t border-slate-200 p-3 dark:border-white/10">
          {loading ? <p className="text-xs text-slate-500">Carregando bloqueios…</p> : null}
          {blocks.map(block => (
            <div key={block.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/5">
              <span><strong className="block text-slate-800 dark:text-slate-100">{block.title}</strong><span className="text-xs text-slate-500">{block.recurrence === 'weekly' ? 'Toda semana' : block.blockDate} · {block.allDay ? 'dia inteiro' : `${block.start}–${block.end}`}</span></span>
              <button type="button" aria-label={`Excluir bloqueio ${block.title}`} disabled={disabled || saving} onClick={() => void removeBlock(block.id)} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-slate-300 text-slate-500 hover:text-rose-500 dark:border-slate-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Tipo<select className={`${FIELD_CLASS} mt-1`} value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="lunch">Almoço</option><option value="busy">Ocupado</option><option value="day_off">Folga</option><option value="other">Outro</option></select></label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Nome<input className={`${FIELD_CLASS} mt-1`} value={title} maxLength={80} onChange={event => setTitle(event.target.value)} /></label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Repetição<select className={`${FIELD_CLASS} mt-1`} value={recurrence} onChange={event => setRecurrence(event.target.value as typeof recurrence)}><option value="weekly">Semanal</option><option value="once">Data específica</option></select></label>
            {recurrence === 'once' ? <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Data<input className={`${FIELD_CLASS} mt-1`} type="date" value={blockDate} onChange={event => setBlockDate(event.target.value)} /></label> : null}
          </div>
          {recurrence === 'weekly' ? <div className="flex flex-wrap gap-2">{CALENDAR_DAYS.map(day => <button key={day.key} type="button" aria-pressed={weekdays.includes(day.key)} onClick={() => setWeekdays(current => current.includes(day.key) ? current.filter(item => item !== day.key) : [...current, day.key])} className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${weekdays.includes(day.key) ? 'border-amber-400 bg-amber-400/15 text-amber-500' : 'border-slate-300 text-slate-500 dark:border-slate-600'}`}>{day.label.slice(0, 3)}</button>)}</div> : null}
          <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={allDay} onChange={event => setAllDay(event.target.checked)} className="h-5 w-5" /> Dia inteiro</label>
          {!allDay ? <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-500">Início<input className={`${FIELD_CLASS} mt-1`} type="time" value={start} onChange={event => setStart(event.target.value)} /></label><label className="text-xs text-slate-500">Fim<input className={`${FIELD_CLASS} mt-1`} type="time" value={end} onChange={event => setEnd(event.target.value)} /></label></div> : null}
          <div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-xs text-slate-500">{message}</p><button type="button" disabled={disabled || saving || loading} onClick={() => void createBlock()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Adicionar bloqueio</button></div>
        </div>
      ) : null}
    </section>
  );
}
