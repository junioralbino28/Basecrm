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
  // Fatia 5: opcionais porque uma resposta antiga (sem esses campos) nao pode quebrar a tela.
  writeCalendarId?: string | null;
  writeCalendarSummary?: string | null;
  busyCalendarIds?: string[];
  watchCalendarIds?: string[];
  canListCalendars?: boolean;
};

/**
 * O que cada agenda da conta faz pela IA. Tres estados exclusivos, porque "bloqueia" e "so
 * avisa" sao decisoes diferentes: a agenda principal de uma equipe costuma ter compromissos
 * de OUTRAS pessoas — bloquear ali tira horario do closer sem motivo (pedido do Junior, 22/09).
 */
type PapelDaAgenda = 'ignora' | 'bloqueia' | 'avisa';

/**
 * Nao reusa FIELD_CLASS aqui: ela traz `w-full`, e juntar `w-auto` na mesma string nao vence a
 * disputa (as duas tem a mesma especificidade; quem manda e a ordem no CSS gerado, nao a ordem
 * das classes). Este seletor fica ao lado do nome da agenda, entao precisa de largura propria.
 */
const SELETOR_PAPEL_CLASS =
  'min-h-11 min-w-0 max-w-[12rem] shrink-0 rounded-xl border border-slate-300 bg-white px-2 text-xs '
  + 'text-slate-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 '
  + 'disabled:opacity-60 dark:border-slate-600 dark:bg-[#111b21] dark:text-slate-100';

type GoogleCalendarItem = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  backgroundColor: string | null;
};

/** So da para MARCAR onde a conta conectada tem permissao de escrever. */
const PAPEIS_DE_ESCRITA = new Set(['owner', 'writer']);

function agendasDeEscrita(lista: GoogleCalendarItem[]) {
  return lista.filter(agenda => PAPEIS_DE_ESCRITA.has(agenda.accessRole));
}

/**
 * O padrao guardado no banco e o literal `primary`, que NAO aparece como id na lista do
 * Google (la a agenda principal vem com o id real e `primary: true`). Sem essa traducao o
 * seletor abriria em uma agenda que o usuario nunca escolheu.
 */
function resolverAgendaDeEscrita(atual: string | null | undefined, lista: GoogleCalendarItem[]): string | null {
  const gravaveis = agendasDeEscrita(lista);
  if (atual && gravaveis.some(agenda => agenda.id === atual)) return atual;
  const principal = gravaveis.find(agenda => agenda.primary);
  return principal?.id ?? gravaveis[0]?.id ?? null;
}

/**
 * Google Agenda (SPEC-google-agenda.md, Fatias 1 e 5). So faz a chamada de status quando o
 * proprio painel e aberto (nao quando "Agenda da IA" expande) — mesmo padrao lazy do
 * CalendarBlocksPanel, para nao disparar rede sem o usuario pedir. A lista de agendas segue
 * a mesma regra: so sai da rede com o painel aberto E a conta conectada.
 */
function GoogleCalendarConnect({ tenantId, connectionId, disabled }: { tenantId: string; connectionId: string; disabled: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const [status, setStatus] = React.useState<GoogleCalendarStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [calendars, setCalendars] = React.useState<GoogleCalendarItem[] | null>(null);
  const [loadingCalendars, setLoadingCalendars] = React.useState(false);
  const [calendarsNeedReconnect, setCalendarsNeedReconnect] = React.useState(false);
  const [writeCalendarId, setWriteCalendarId] = React.useState<string | null>(null);
  const [busyCalendarIds, setBusyCalendarIds] = React.useState<string[]>([]);
  const [watchCalendarIds, setWatchCalendarIds] = React.useState<string[]>([]);
  const [savingSelection, setSavingSelection] = React.useState(false);
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

  async function loadCalendars() {
    setLoadingCalendars(true);
    try {
      const response = await fetch(`${endpoint}/calendars`, { credentials: 'include', headers: { accept: 'application/json' } });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Falha ao listar as agendas do Google.');
      const lista: GoogleCalendarItem[] = Array.isArray(body?.calendars) ? body.calendars : [];
      setCalendarsNeedReconnect(body?.needsReconnect === true);
      setCalendars(lista);
      setWriteCalendarId(resolverAgendaDeEscrita(body?.writeCalendarId ?? status?.writeCalendarId ?? null, lista));
      const ocupadas = Array.isArray(body?.busyCalendarIds) ? body.busyCalendarIds : (status?.busyCalendarIds ?? []);
      setBusyCalendarIds(ocupadas);
      const observadas = Array.isArray(body?.watchCalendarIds) ? body.watchCalendarIds : (status?.watchCalendarIds ?? []);
      setWatchCalendarIds(observadas);
    } catch (error) {
      // Lista vazia (e nao `null`) encerra a tentativa: sem isso o efeito pediria de novo a cada render.
      setCalendars([]);
      setMessage(error instanceof Error ? error.message : 'Falha ao listar as agendas do Google.');
    } finally {
      setLoadingCalendars(false);
    }
  }

  // Lazy de verdade: painel aberto + conta conectada + permissao de listar ja concedida.
  React.useEffect(() => {
    if (!expanded) return;
    if (!status?.connected || status.canListCalendars !== true) return;
    if (calendars !== null || loadingCalendars) return;
    void loadCalendars();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, status, calendars, loadingCalendars]);

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !status) await loadStatus();
  }

  function papelDaAgenda(calendarId: string): PapelDaAgenda {
    if (busyCalendarIds.includes(calendarId)) return 'bloqueia';
    if (watchCalendarIds.includes(calendarId)) return 'avisa';
    return 'ignora';
  }

  /** Exclusivo de proposito: a mesma agenda nunca fica nas duas listas. */
  function definirPapel(calendarId: string, papel: PapelDaAgenda) {
    setBusyCalendarIds(current => (papel === 'bloqueia'
      ? [...new Set([...current, calendarId])]
      : current.filter(id => id !== calendarId)));
    setWatchCalendarIds(current => (papel === 'avisa'
      ? [...new Set([...current, calendarId])]
      : current.filter(id => id !== calendarId)));
  }

  async function saveSelection() {
    if (!writeCalendarId) {
      setMessage('Escolha a agenda onde a IA marca as reuniões.');
      return;
    }
    setSavingSelection(true);
    setMessage(null);
    try {
      const escolhida = (calendars ?? []).find(agenda => agenda.id === writeCalendarId) ?? null;
      const response = await fetch(`${endpoint}/selection`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          writeCalendarId,
          writeCalendarSummary: escolhida?.summary ?? null,
          busyCalendarIds: busyCalendarIds.filter(id => id !== writeCalendarId),
          watchCalendarIds: watchCalendarIds.filter(id => id !== writeCalendarId),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Falha ao salvar a escolha de agendas.');
      const salvo = typeof body?.writeCalendarId === 'string' ? body.writeCalendarId : writeCalendarId;
      const ocupadas = Array.isArray(body?.busyCalendarIds) ? body.busyCalendarIds : busyCalendarIds;
      const observadas = Array.isArray(body?.watchCalendarIds) ? body.watchCalendarIds : watchCalendarIds;
      setWriteCalendarId(salvo);
      setBusyCalendarIds(ocupadas);
      setWatchCalendarIds(observadas);
      setStatus(current => (current
        ? {
            ...current,
            writeCalendarId: salvo,
            writeCalendarSummary: escolhida?.summary ?? null,
            busyCalendarIds: ocupadas,
            watchCalendarIds: observadas,
          }
        : current));
      setMessage('Agendas salvas.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar a escolha de agendas.');
    } finally {
      setSavingSelection(false);
    }
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
      // A lista pertence a conexao que acabou de cair; zerar evita mostrar agenda de conta antiga.
      setCalendars(null);
      setCalendarsNeedReconnect(false);
      setWriteCalendarId(null);
      setBusyCalendarIds([]);
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao desconectar o Google Agenda.');
    } finally {
      setLoading(false);
    }
  }

  const needsReconnect = status?.status === 'reconnect_required';
  // Conexao feita antes do escopo de listar agendas: um clique em Reconectar resolve.
  const conexaoAntiga = Boolean(status?.connected) && (status?.canListCalendars !== true || calendarsNeedReconnect);
  const gravaveis = agendasDeEscrita(calendars ?? []);

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
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <Check className="h-4 w-4 text-emerald-500" aria-hidden="true" /> Google conectado: {status.googleAccountEmail}
                  </span>
                  <button type="button" disabled={disabled || loading} onClick={() => void disconnect()} className="min-h-11 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
                    Desconectar
                  </button>
                </div>

                {conexaoAntiga ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                    <p className="max-w-md text-xs text-slate-600 dark:text-slate-300">
                      Para escolher em qual agenda a IA marca, reconecte uma vez: só assim o Google libera a lista de agendas desta conta.
                    </p>
                    <button type="button" disabled={disabled || loading} onClick={() => void connect()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Reconectar
                    </button>
                  </div>
                ) : null}

                {!conexaoAntiga && loadingCalendars && calendars === null ? (
                  <p className="text-xs text-slate-500">Carregando agendas…</p>
                ) : null}

                {!conexaoAntiga && calendars && calendars.length > 0 ? (
                  <div className="space-y-4">
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Agenda onde a IA marca as reuniões
                      <select
                        className={`${FIELD_CLASS} mt-1`}
                        value={writeCalendarId ?? ''}
                        disabled={disabled || savingSelection}
                        onChange={event => setWriteCalendarId(event.target.value)}
                      >
                        {gravaveis.map(agenda => (
                          <option key={agenda.id} value={agenda.id}>
                            {agenda.summary}{agenda.primary ? ' (principal)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>

                    {/* `min-w-0`: sem ele o <fieldset> herda `min-inline-size: min-content` do
                        navegador e estica a tela no celular (mesmo defeito medido no editor de
                        expediente, 22/09). */}
                    <fieldset className="min-w-0 border-0 p-0">
                      <legend className="text-xs font-semibold text-slate-600 dark:text-slate-300">O que as outras agendas fazem</legend>
                      <p className="mt-1 text-xs text-slate-500">
                        <strong>Bloquear</strong> tira o horário do lead. <strong>Só avisar</strong> não tira nada: a IA
                        continua oferecendo e você recebe um aviso se houver algo no mesmo horário — para agenda usada
                        por mais de uma pessoa, é o que você quer.
                      </p>
                      <div className="mt-2 space-y-1">
                        {calendars.map(agenda => {
                          const ehAgendaDeEscrita = agenda.id === writeCalendarId;
                          return (
                            <div key={agenda.id} className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-2 text-sm text-slate-700 dark:text-slate-200">
                              <span className="min-w-0 break-words">
                                {agenda.summary}
                                {ehAgendaDeEscrita ? ' — é onde a IA marca, sempre conta como ocupado' : ''}
                              </span>
                              {ehAgendaDeEscrita ? null : (
                                <select
                                  aria-label={`O que a agenda ${agenda.summary} faz`}
                                  className={SELETOR_PAPEL_CLASS}
                                  value={papelDaAgenda(agenda.id)}
                                  disabled={disabled || savingSelection}
                                  onChange={event => definirPapel(agenda.id, event.target.value as PapelDaAgenda)}
                                >
                                  <option value="ignora">Ignorar</option>
                                  <option value="bloqueia">Bloquear horário</option>
                                  <option value="avisa">Só avisar</option>
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </fieldset>

                    <button type="button" disabled={disabled || savingSelection} onClick={() => void saveSelection()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
                      {savingSelection ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Salvar escolha de agendas
                    </button>
                  </div>
                ) : null}
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
