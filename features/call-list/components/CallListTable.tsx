import React from 'react';
import {
  AlarmClock,
  AlertTriangle,
  BellRing,
  CalendarDays,
  Check,
  MessageCircle,
  Phone,
} from 'lucide-react';
import { normalizePhoneE164 } from '@/lib/phone';
import type { TaskType } from '@/types';
import type { CallListBuckets, CallListEntry } from '@/lib/utils/callList';

interface CallListTableProps {
  buckets: CallListBuckets;
  onCall: (entry: CallListEntry) => void;
  onMarkDone: (entry: CallListEntry) => void;
}

interface SectionConfig {
  key: keyof CallListBuckets;
  label: string;
  Icon: typeof Phone;
  iconClass: string;
  countClass: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: 'overdue',
    label: 'Atrasadas',
    Icon: AlertTriangle,
    iconClass: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
    countClass: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-500/15',
  },
  {
    key: 'today',
    label: 'Hoje',
    Icon: AlarmClock,
    iconClass: 'bg-gold-50 text-gold-600 dark:bg-gold-500/15 dark:text-gold-500',
    countClass: 'text-gold-700 bg-gold-50 dark:text-gold-500 dark:bg-gold-500/15',
  },
  {
    key: 'upcoming',
    label: 'Próximas',
    Icon: CalendarDays,
    iconClass: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
    countClass: 'text-brand-700 bg-brand-50 dark:text-brand-300 dark:bg-brand-500/15',
  },
];

/** Pill de tipo das tasks — espelha TYPE_META do TaskRow (tela Tarefas). */
const TASK_TYPE_META: Record<TaskType, { label: string; chipClass: string; icon: typeof Phone }> = {
  call: {
    label: 'ligação',
    chipClass: 'text-brand-700 bg-brand-50 dark:text-brand-300 dark:bg-brand-500/15',
    icon: Phone,
  },
  reminder: {
    label: 'lembrete',
    chipClass: 'text-gold-700 bg-gold-50 dark:text-gold-500 dark:bg-gold-500/15',
    icon: BellRing,
  },
  message: {
    label: 'whatsapp',
    chipClass: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/15',
    icon: MessageCircle,
  },
};

function formatActivityDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toUpperCase() || '?';
}

/** Número limpo pro wa.me (sem +, só dígitos) — vazio se não der pra normalizar. */
function waDigits(phone?: string): string {
  if (!phone) return '';
  return normalizePhoneE164(phone).replace(/\D/g, '');
}

/** Título da entrada (motivo da ligação/tarefa) — usado nas ações acessíveis. */
function entryTitle(entry: CallListEntry): string {
  return entry.kind === 'activity' ? entry.activity.title : entry.task.title;
}

/**
 * Tabela da call-list: pendências agrupadas em Atrasadas / Hoje / Próximas no
 * estilo do hero "Seguir hoje" do mockup. Cada linha permite Ligar (CallModal
 * via controller), abrir o WhatsApp (link wa.me) e marcar como feita —
 * concluir NUNCA move o deal no funil (guardrail do playbook).
 */
export const CallListTable: React.FC<CallListTableProps> = ({ buckets, onCall, onMarkDone }) => {
  const isEmpty =
    buckets.overdue.length === 0 && buckets.today.length === 0 && buckets.upcoming.length === 0;

  if (isEmpty) {
    return (
      <div className="rounded-2xl border border-line bg-card p-10 text-center">
        <Phone size={28} className="mx-auto mb-3 text-faint" aria-hidden="true" />
        <p className="text-sm text-muted">Nenhuma ligação pendente por aqui.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {SECTIONS.map(({ key, label, Icon, iconClass, countClass }) => {
        const entries = buckets[key];
        if (entries.length === 0) return null;

        return (
          <section
            key={key}
            aria-label={label}
            className="rounded-2xl border border-line bg-card shadow-lg shadow-black/[.04] overflow-hidden"
          >
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-line">
              <span className={`grid place-items-center w-8 h-8 rounded-lg ${iconClass}`}>
                <Icon size={18} aria-hidden="true" />
              </span>
              <h2 className="font-display font-semibold text-base text-ink">{label}</h2>
              <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${countClass}`}>
                {entries.length}
              </span>
            </div>

            <ul className="divide-y divide-line">
              {entries.map((entry) => {
                const { contact, cadenceStage } = entry;
                const title = entryTitle(entry);
                const heading = contact?.name || title;
                const subtitle = contact ? title : entry.kind === 'task' ? entry.task.note || '' : '';
                const phone = contact?.phone || '';
                const digits = waDigits(phone);
                const taskMeta = entry.kind === 'task' ? TASK_TYPE_META[entry.task.type] : null;
                const TaskIcon = taskMeta?.icon || BellRing;
                const timeChip =
                  entry.kind === 'activity'
                    ? formatActivityDate(entry.activity.date)
                    : entry.task.dueTime || '';
                const rowKey =
                  entry.kind === 'activity' ? `a-${entry.activity.id}` : `t-${entry.task.id}`;

                return (
                  <li key={rowKey} className="flex items-center gap-3 px-5 py-4">
                    <div
                      className="grid place-items-center w-9 h-9 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 font-semibold text-xs shrink-0"
                      aria-hidden="true"
                    >
                      {initials(heading)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-ink truncate">{heading}</span>
                        {cadenceStage && (
                          <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 dark:text-brand-300 dark:bg-brand-500/15 rounded-full px-1.5 py-0.5 shrink-0">
                            {cadenceStage}
                          </span>
                        )}
                        {taskMeta && (
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-1.5 py-0.5 shrink-0 ${taskMeta.chipClass}`}
                          >
                            <TaskIcon size={12} aria-hidden="true" />
                            {taskMeta.label}
                          </span>
                        )}
                      </div>
                      {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
                      <p className="mt-0.5 text-[11px] text-faint truncate">
                        {phone ? `${phone}${timeChip ? ' · ' : ''}` : ''}
                        {timeChip}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {phone && (
                        <button
                          type="button"
                          onClick={() => onCall(entry)}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-brand-200 text-brand-700 dark:border-brand-500/40 dark:text-brand-300 text-xs font-semibold hover:bg-brand-50 dark:hover:bg-brand-500/10 active:scale-95 transition shrink-0"
                          aria-label={`Ligar para ${heading}`}
                        >
                          <Phone size={14} aria-hidden="true" />
                          <span className="hidden sm:inline">Ligar</span>
                        </button>
                      )}
                      {digits && (
                        <a
                          href={`https://wa.me/${digits}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-wa text-white text-xs font-semibold hover:brightness-105 active:scale-95 transition shrink-0"
                          aria-label={`Abrir WhatsApp de ${heading}`}
                        >
                          <MessageCircle size={14} aria-hidden="true" />
                          <span className="hidden sm:inline">WhatsApp</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => onMarkDone(entry)}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line text-muted text-xs font-semibold hover:bg-surface hover:text-ink active:scale-95 transition shrink-0"
                        aria-label={`Marcar ${title} como feita`}
                      >
                        <Check size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">Feita</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
};
