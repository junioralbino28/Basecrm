'use client';

import React from 'react';
import { CalendarClock, Check, Loader2, Pencil, Phone, X } from 'lucide-react';
import type { ConversationHandoff } from '@/lib/conversations/handoff';
import {
  MEETING_START_INTERVAL_MINUTES,
  MEETING_TARGET_DURATION_MINUTES,
} from '@/lib/conversations/meetingAvailability';

function formatSchedule(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function toIsoSchedule(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function statusLabel(handoff: ConversationHandoff) {
  if (handoff.scheduleStatus === 'confirmed') return 'Horário confirmado';
  if (handoff.scheduleStatus === 'adjusted') return 'Horário ajustado';
  if (handoff.type === 'call_accepted') return 'Ligação aceita';
  if (handoff.type === 'human_requested') return 'Atendimento humano';
  return 'Aguardando ação';
}

export function ConversationHandoffCard({
  handoff,
  phone,
  disabled,
  error,
  onConfirm,
  onAdjust,
}: {
  handoff: ConversationHandoff;
  phone: string | null;
  disabled: boolean;
  error?: string | null;
  onConfirm: () => void;
  onAdjust: (scheduledAt: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [localSchedule, setLocalSchedule] = React.useState('');
  const isMeeting = handoff.type === 'meeting_requested' || handoff.type === 'meeting_confirmed';
  const isPendingMeeting = isMeeting && handoff.scheduleStatus === 'pending';
  const HandoffIcon = isMeeting ? CalendarClock : Phone;
  const exactSchedule = formatSchedule(handoff.requestedScheduleAt);
  const normalizedPhone = phone?.trim() || handoff.contactPhone;
  const adjustedIso = toIsoSchedule(localSchedule);

  return (
    <aside className="shrink-0 border-b border-amber-500/20 bg-amber-500/8 px-4 py-3" aria-label="Handoff da Aurora">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">
              <HandoffIcon size={14} aria-hidden="true" />
              Handoff da Aurora
            </span>
            <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
              {statusLabel(handoff)}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-100">
            {handoff.summary || handoff.reason}
          </p>
          {isMeeting ? (
            <>
              <p className="mt-1 text-xs text-slate-300">
                {exactSchedule
                  ? `Horário: ${exactSchedule}`
                  : `Preferência: ${handoff.requestedScheduleText || 'não informada'}`}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Duração prevista: {MEETING_TARGET_DURATION_MINUTES} min · inícios separados por {MEETING_START_INTERVAL_MINUTES} min
              </p>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={disabled || !normalizedPhone ? undefined : `tel:${normalizedPhone}`}
            aria-disabled={disabled || !normalizedPhone}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-200 transition hover:border-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 active:scale-[0.98] aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            <Phone size={16} aria-hidden="true" />
            Ligar agora
          </a>

          {isPendingMeeting && exactSchedule ? (
            <button
              type="button"
              onClick={onConfirm}
              disabled={disabled}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-amber-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {disabled ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Confirmar horário
            </button>
          ) : null}

          {isMeeting ? (
            <button
              type="button"
              onClick={() => setEditing(current => !current)}
              disabled={disabled}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-600 px-4 text-sm font-semibold text-slate-200 transition hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {editing ? <X size={16} /> : <Pencil size={16} />}
              {editing ? 'Cancelar ajuste' : exactSchedule ? 'Ajustar' : 'Definir horário'}
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-amber-400/15 pt-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-xs font-semibold text-slate-300">
            Novo horário da reunião
            <input
              type="datetime-local"
              value={localSchedule}
              onChange={event => setLocalSchedule(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-600 bg-[#111b21] px-3 text-sm text-slate-100 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
            />
          </label>
          <button
            type="button"
            disabled={disabled || !adjustedIso}
            onClick={() => adjustedIso && onAdjust(adjustedIso)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {disabled ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Salvar horário
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs font-medium text-rose-300">{error}</p> : null}
    </aside>
  );
}
