import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTasks } from '@/lib/query/hooks/useTasksQuery';
import { useContacts } from '@/lib/query/hooks/useContactsQuery';
import { useTaskNudgeInterval } from '@/lib/query/hooks/useOrganizationSettingsQuery';
import { useTenantScopedHrefBuilder } from '@/components/navigation/useTenantScopedHref';
import { localTodayIso, splitTasks } from '../hooks/useTarefasController';

const MINUTE_MS = 60_000;
const SNOOZE_MS = 30 * MINUTE_MS;
const MAX_PREVIEW = 3;

/**
 * Nudge pop-up de tarefas (N3 — adendo 2026-06-10, espelho do mockup).
 *
 * Card dourado fixo bottom-right que aparece a cada N minutos (intervalo em
 * `organization_settings.task_nudge_interval_minutes`; null = desligado) com
 * "N tarefas de hoje em aberto" (inclui atrasadas — splitTasks do N2).
 *
 * Ações: "Ver tarefas" (rota tenant-scoped), "+30 min" (snooze) e fechar.
 * Snooze/fechar são ESTADO LOCAL — nada persiste; o lembrete volta no
 * próximo tick (fechar) ou após 30 min (snooze). Montado SÓ no workspace
 * clínica (Layout) — não pisca pra agência fora dele.
 */
export const TaskNudge: React.FC = () => {
  const { data: tasks = [] } = useTasks();
  const { data: contacts = [] } = useContacts();
  const { data: interval = null } = useTaskNudgeInterval();
  const getScopedHref = useTenantScopedHrefBuilder();
  const router = useRouter();

  const [isVisible, setIsVisible] = useState(false);
  const snoozedUntilRef = useRef<number | null>(null);

  const dueToday = useMemo(() => splitTasks(tasks, localTodayIso()).dueToday, [tasks]);

  const contactsById = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);

  // Refs lidas no tick — o timer só reinstala quando o INTERVALO muda.
  const dueTodayCountRef = useRef(dueToday.length);
  dueTodayCountRef.current = dueToday.length;

  useEffect(() => {
    if (!interval) return; // null = desligado

    const timer = setInterval(() => {
      if (dueTodayCountRef.current === 0) return;
      const snoozedUntil = snoozedUntilRef.current;
      if (snoozedUntil !== null && Date.now() < snoozedUntil) return;
      snoozedUntilRef.current = null;
      setIsVisible(true);
    }, interval * MINUTE_MS);

    return () => clearInterval(timer);
  }, [interval]);

  if (!interval || !isVisible || dueToday.length === 0) return null;

  const preview = dueToday
    .slice(0, MAX_PREVIEW)
    .map(task => {
      const contactName = task.contactId ? contactsById.get(task.contactId)?.name : '';
      return contactName ? `${contactName} (${task.title})` : task.title;
    })
    .join(' · ');
  const previewSuffix = dueToday.length > MAX_PREVIEW ? ' · …' : '';

  const intervalLabel = interval === 60 ? '1 h' : `${interval} min`;

  const handleSeeTasks = () => {
    setIsVisible(false);
    router.push(getScopedHref('/tarefas'));
  };

  const handleSnooze = () => {
    snoozedUntilRef.current = Date.now() + SNOOZE_MS;
    setIsVisible(false);
  };

  const handleClose = () => {
    setIsVisible(false);
  };

  return (
    <div
      role="status"
      className="fixed bottom-6 right-6 z-[55] w-[340px] max-w-[calc(100vw-3rem)]"
    >
      <div className="rounded-2xl border border-gold-500/40 bg-card shadow-2xl overflow-hidden">
        <span className="block h-[3px] bg-gradient-to-r from-gold-500 to-gold-500/30" aria-hidden="true" />
        <div className="flex items-start gap-3 p-4">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gold-50 text-gold-600 dark:bg-gold-500/15 dark:text-gold-500 shrink-0">
            <AlarmClock size={20} aria-hidden="true" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-display font-semibold text-sm text-ink">
              {dueToday.length === 1
                ? '1 tarefa de hoje em aberto'
                : `${dueToday.length} tarefas de hoje em aberto`}
            </p>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              {preview}
              {previewSuffix}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={handleSeeTasks}
                className="h-8 px-3 rounded-lg bg-gold-600 text-white text-xs font-semibold hover:bg-gold-700 active:scale-95 transition"
              >
                Ver tarefas
              </button>
              <button
                type="button"
                onClick={handleSnooze}
                className="h-8 px-3 rounded-lg border border-line text-muted text-xs font-semibold hover:bg-surface transition"
              >
                +30 min
              </button>
            </div>
            <p className="text-[10px] text-faint mt-2.5">aviso a cada {intervalLabel}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar aviso"
            className="grid place-items-center w-7 h-7 rounded-lg text-faint hover:bg-surface transition shrink-0"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
