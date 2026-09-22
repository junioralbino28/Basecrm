'use client';

import React from 'react';
import { CalendarClock, Check, ChevronDown, Loader2 } from 'lucide-react';
import type { ConversationCalendarConfig } from '@/lib/conversations/meetingAvailability';
import { CalendarBlocksPanel } from './CalendarBlocksPanel';
import { FIELD_CLASS, readInitialCalendar } from './calendarSettingsForm';
import { WeeklyAvailabilityEditor } from './WeeklyAvailabilityEditor';

type CalendarAssignee = { id: string; display_name: string };

type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  googleAccountEmail: string | null;
  status: 'connected' | 'reconnect_required' | 'revoked' | null;
  connectedAt: string | null;
};

/**
 * Google Agenda (SPEC-google-agenda.md, Fatia 1). So faz a chamada de status quando o
 * proprio painel e aberto (nao quando "Agenda da IA" expande) — mesmo padrao lazy do
 * CalendarBlocksPanel, para nao disparar rede sem o usuario pedir.
 */
function GoogleCalendarConnect({ tenantId, connectionId, disabled }: { tenantId: string; connectionId: string; disabled: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const [status, setStatus] = React.useState<GoogleCalendarStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const endpoint = `/api/platform/tenants/${tenantId}/channels/${connectionId}/google-calendar`;

  async function loadStatus() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`${endpoint}/status`, { credentials: 'include', headers: { accept: 'application/json' } });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Falha ao consultar o Google Agenda.');
      setStatus(body);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao consultar o Google Agenda.');
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !status) await loadStatus();
  }

  async function connect() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`${endpoint}/connect`, {
        method: 'POST', credentials: 'include', headers: { accept: 'application/json' },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Falha ao iniciar a conexão com o Google.');
      window.location.href = body.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao iniciar a conexão com o Google.');
      setLoading(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`${endpoint}/disconnect`, {
        method: 'POST', credentials: 'include', headers: { accept: 'application/json' },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Falha ao desconectar o Google Agenda.');
      setMessage(body.warning || 'Google Agenda desconectado.');
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao desconectar o Google Agenda.');
    } finally {
      setLoading(false);
    }
  }

  const needsReconnect = status?.status === 'reconnect_required';

  return (
    <section className="mt-5 rounded-xl border border-slate-200 dark:border-white/10">
      <button type="button" onClick={() => void toggleExpanded()} className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm font-semibold text-slate-800 dark:text-slate-100" aria-expanded={expanded}>
        Google Agenda
        <ChevronDown className={`h-4 w-4 transition ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="space-y-3 border-t border-slate-200 p-3 dark:border-white/10">
          {loading && !status ? <p className="text-xs text-slate-500">Consultando…</p> : null}
          {status && !status.configured ? (
            <p className="text-xs text-slate-500">Integração do Google Agenda ainda não configurada.</p>
          ) : null}
          {status?.configured ? (
            status.connected ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <Check className="h-4 w-4 text-emerald-500" aria-hidden="true" /> Google conectado: {status.googleAccountEmail}
                </span>
                <button type="button" disabled={disabled || loading} onClick={() => void disconnect()} className="min-h-11 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
                  Desconectar
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                {needsReconnect ? (
                  <span className="text-xs text-rose-500">Google {status.googleAccountEmail} precisa reconectar.</span>
                ) : null}
                <button type="button" disabled={disabled || loading} onClick={() => void connect()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {needsReconnect ? 'Reconectar' : 'Conectar Google Agenda'}
                </button>
              </div>
            )
          ) : null}
          {message ? <p role="status" className="text-xs text-slate-500">{message}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

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

          <GoogleCalendarConnect key={`google-${initial.ownerId || 'sem-responsavel'}`} tenantId={tenantId} connectionId={connectionId} disabled={disabled || saving} />

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
