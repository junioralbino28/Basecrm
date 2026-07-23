import { useCallback, useMemo, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { useActivities, useToggleActivity, useUpdateActivity } from '@/lib/query/hooks/useActivitiesQuery';
import { useTasks, useUpdateTask } from '@/lib/query/hooks/useTasksQuery';
import type { CallLogData } from '@/features/inbox/components/CallModal';
import { useContacts } from '@/lib/query/hooks/useContactsQuery';
import { useDeals } from '@/lib/query/hooks/useDealsQuery';
import { useBoards } from '@/lib/query/hooks/useBoardsQuery';
import { useRealtimeSync } from '@/lib/realtime/useRealtimeSync';
import { buildCallList, type CallListEntry } from '@/lib/utils/callList';

/**
 * Controller da Home "Hoje" / call-list ("quem ligar/seguir hoje").
 *
 * NÃO cria tabela nova: deriva, no client, a lista de pendências a partir das
 * activities (type 'CALL', !completed) + tasks do N2 vencendo hoje, cruzadas
 * com os contatos (phone + preferência — whatsapp_only sai da lista de ligar).
 * Deals+boards entram SÓ pra resolver a etiqueta de cadência F1-F9 (fallback
 * honesto: sem estágio F, sem badge).
 *
 * Guardrail do playbook: "marcar feito" SÓ conclui a activity (useToggleActivity)
 * ou a task (useUpdateTask status done) — NUNCA move o deal no funil.
 *
 * @param now "Agora" — injetável para testes determinísticos.
 */
export const useCallListController = (now: Date = new Date()) => {
  const { data: activities = [], isLoading: activitiesLoading, error: activitiesError } = useActivities();
  const { data: tasks = [], isLoading: tasksLoading, error: tasksError } = useTasks();
  const { data: contacts = [], isLoading: contactsLoading, error: contactsError } = useContacts();
  // Deals + boards SÓ pra etiqueta F1-F9 — erro/loading deles não trava a lista.
  const { data: deals = [] } = useDeals();
  const { data: boards = [] } = useBoards();
  const toggleActivityMutation = useToggleActivity();
  const updateActivityMutation = useUpdateActivity();
  const updateTaskMutation = useUpdateTask();

  // Realtime: caminho simples de invalidate para as duas fontes da lista.
  useRealtimeSync(['activities', 'tasks']);

  const { showToast } = useToast();

  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [activeEntry, setActiveEntry] = useState<CallListEntry | null>(null);

  const isLoading = activitiesLoading || tasksLoading || contactsLoading;
  const error = activitiesError || tasksError || contactsError;

  /** dealId → label do estágio atual (boards reais — etiqueta F1-F9 honesta). */
  const dealStageLabelById = useMemo(() => {
    const labelByStageId = new Map<string, string>();
    for (const board of boards) {
      for (const stage of board.stages || []) {
        labelByStageId.set(stage.id, stage.label);
      }
    }
    const byDeal = new Map<string, string>();
    for (const deal of deals) {
      const label = labelByStageId.get(deal.status);
      if (label) byDeal.set(deal.id, label);
    }
    return byDeal;
  }, [boards, deals]);

  const buckets = useMemo(
    () => buildCallList({ activities, tasks, contacts, dealStageLabelById }, now),
    [activities, tasks, contacts, dealStageLabelById, now]
  );

  const totalPending = useMemo(
    () => buckets.overdue.length + buckets.today.length + buckets.upcoming.length,
    [buckets]
  );

  const openCall = useCallback((entry: CallListEntry) => {
    setActiveEntry(entry);
    setIsCallModalOpen(true);
  }, []);

  const closeCall = useCallback(() => {
    setIsCallModalOpen(false);
    setActiveEntry(null);
  }, []);

  /**
   * Conclui a entrada: activity via toggle, task via status done (o service
   * carimba completed_at). Toast onError em TODA mutation (regra do plano).
   */
  const handleMarkDone = useCallback(
    (entry: CallListEntry) => {
      if (entry.kind === 'activity') {
        toggleActivityMutation.mutate(entry.activity.id, {
          onSuccess: () => showToast('Ligação marcada como feita', 'success'),
          onError: (mutationError: Error) => {
            showToast(`Erro ao marcar ligação: ${mutationError.message}`, 'error');
          },
        });
        return;
      }
      updateTaskMutation.mutate(
        { id: entry.task.id, updates: { status: 'done' } },
        {
          onSuccess: () => showToast('Tarefa concluída', 'success'),
          onError: (mutationError: Error) => {
            showToast(`Erro ao concluir tarefa: ${mutationError.message}`, 'error');
          },
        }
      );
    },
    [showToast, toggleActivityMutation, updateTaskMutation]
  );

  /**
   * Conclui a entrada PERSISTINDO o resultado da ligação (parecer §5.2: o
   * modal coleta outcome/duração/notas e nada disso podia ser descartado).
   * Activity: completed + resultado na description. Task: done + resultado
   * na note. Guardrail mantido: NUNCA move o deal no funil.
   */
  const handleSaveCallResult = useCallback(
    (entry: CallListEntry, log: CallLogData) => {
      const note = buildCallResultNote(log, now);
      if (entry.kind === 'activity') {
        const existing = entry.activity.description?.trim();
        updateActivityMutation.mutate(
          {
            id: entry.activity.id,
            updates: {
              completed: true,
              description: existing ? `${existing}\n${note}` : note,
            },
          },
          {
            onSuccess: () => showToast('Ligação registrada', 'success'),
            onError: (mutationError: Error) => {
              showToast(`Erro ao registrar ligação: ${mutationError.message}`, 'error');
            },
          }
        );
        return;
      }
      const existing = entry.task.note?.trim();
      updateTaskMutation.mutate(
        {
          id: entry.task.id,
          updates: {
            status: 'done',
            note: existing ? `${existing}\n${note}` : note,
          },
        },
        {
          onSuccess: () => showToast('Ligação registrada', 'success'),
          onError: (mutationError: Error) => {
            showToast(`Erro ao registrar ligação: ${mutationError.message}`, 'error');
          },
        }
      );
    },
    [now, showToast, updateActivityMutation, updateTaskMutation]
  );

  return {
    buckets,
    totalPending,
    isLoading,
    error,
    isCallModalOpen,
    activeEntry,
    openCall,
    closeCall,
    handleMarkDone,
    handleSaveCallResult,
  };
};

const CALL_OUTCOME_LABELS: Record<CallLogData['outcome'], string> = {
  connected: 'Atendeu',
  no_answer: 'Não atendeu',
  voicemail: 'Caixa postal',
  busy: 'Ocupado',
};

/** Linha única e legível pra description/note: resultado + duração + notas. */
export const buildCallResultNote = (log: CallLogData, when: Date): string => {
  const parts = [`[Ligação ${when.toLocaleDateString('pt-BR')}] ${CALL_OUTCOME_LABELS[log.outcome]}`];
  if (log.duration > 0) {
    const minutes = Math.floor(log.duration / 60);
    const seconds = log.duration % 60;
    parts.push(minutes > 0 ? `${minutes}min${seconds > 0 ? ` ${seconds}s` : ''}` : `${seconds}s`);
  }
  if (log.notes.trim()) parts.push(log.notes.trim());
  return parts.join(' · ');
};
