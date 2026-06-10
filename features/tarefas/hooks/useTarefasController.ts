import React, { useMemo, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { Task, TaskType } from '@/types';
import {
  useTasks,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
} from '@/lib/query/hooks/useTasksQuery';
import { useContacts } from '@/lib/query/hooks/useContactsQuery';
import { useRealtimeSync } from '@/lib/realtime/useRealtimeSync';
import { taskFormSchema } from '@/lib/validations/schemas';

export interface TaskFormState {
  contactId: string;
  type: TaskType;
  title: string;
  note: string;
  dueDate: string;
  dueTime: string;
  juliaFirst: boolean;
}

/** Data local YYYY-MM-DD (due_date é date no banco — sem fuso/UTC). */
export function localTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Soma dias a uma data YYYY-MM-DD (pra "Adiar"). */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + days);
  return localTodayIso(date);
}

/**
 * Divide as tarefas nas seções do mockup: "Vence hoje" (inclui ATRASADAS —
 * tarefa vencida não pode sumir) e "Próximas". Concluídas saem da lista.
 */
export function splitTasks(
  tasks: Task[],
  todayIso: string
): { dueToday: Task[]; upcoming: Task[] } {
  const visible = tasks.filter(t => t.status !== 'done');
  return {
    dueToday: visible.filter(t => t.dueDate <= todayIso),
    upcoming: visible.filter(t => t.dueDate > todayIso),
  };
}

const emptyForm = (): TaskFormState => ({
  contactId: '',
  // Mockup nasce com "Lembrete" selecionado e Julia ligada.
  type: 'reminder',
  title: '',
  note: '',
  dueDate: localTodayIso(),
  dueTime: '',
  juliaFirst: true,
});

/**
 * Hook controlador da tela Tarefas & lembretes (N2).
 * Concluir carimba completed_at via service; "Adiar" empurra a due_date pra
 * amanhã com status snoozed. Toast onError em TODAS as mutations.
 */
export const useTarefasController = () => {
  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const { data: contacts = [], isLoading: contactsLoading } = useContacts();
  const createMutation = useCreateTask();
  const updateMutation = useUpdateTask();
  const deleteMutation = useDeleteTask();

  useRealtimeSync('tasks');

  const { showToast } = useToast();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [formData, setFormData] = useState<TaskFormState>(emptyForm);

  const isLoading = tasksLoading || contactsLoading;

  const contactsById = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);

  const todayIso = localTodayIso();
  const { dueToday, upcoming } = useMemo(
    () => splitTasks(tasks, todayIso),
    [tasks, todayIso]
  );

  const getContactName = (contactId?: string) =>
    contactId ? contactsById.get(contactId)?.name || '' : '';

  const handleNew = () => {
    setFormData(emptyForm());
    setIsDrawerOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // zod LIGADO no submit (regra do provisionamento) — barra antes do insert.
    const parsed = taskFormSchema.safeParse(formData);
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message || 'Dados da tarefa inválidos', 'error');
      return;
    }

    const task: Omit<Task, 'id'> = {
      contactId: parsed.data.contactId || undefined,
      type: parsed.data.type,
      title: parsed.data.title,
      note: parsed.data.note || undefined,
      dueDate: parsed.data.dueDate,
      dueTime: parsed.data.dueTime || undefined,
      status: 'open',
      juliaFirst: parsed.data.juliaFirst,
    };

    createMutation.mutate(
      { task },
      {
        onSuccess: () => {
          showToast('Tarefa criada', 'success');
          setIsDrawerOpen(false);
        },
        onError: (error: Error) => {
          showToast(`Erro ao criar tarefa: ${error.message}`, 'error');
        },
      }
    );
  };

  /** Concluir: status done — o service carimba completed_at (CHECK no banco). */
  const handleComplete = (task: Task) => {
    updateMutation.mutate(
      { id: task.id, updates: { status: 'done' } },
      {
        onSuccess: () => showToast('Tarefa concluída', 'success'),
        onError: (error: Error) => {
          showToast(`Erro ao concluir tarefa: ${error.message}`, 'error');
        },
      }
    );
  };

  /** Adiar: empurra pra amanhã (a partir de hoje) com status snoozed. */
  const handleSnooze = (task: Task) => {
    const base = task.dueDate > todayIso ? task.dueDate : todayIso;
    updateMutation.mutate(
      { id: task.id, updates: { status: 'snoozed', dueDate: addDaysIso(base, 1) } },
      {
        onSuccess: () => showToast('Tarefa adiada pra amanhã', 'success'),
        onError: (error: Error) => {
          showToast(`Erro ao adiar tarefa: ${error.message}`, 'error');
        },
      }
    );
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Tem certeza que deseja excluir esta tarefa?')) {
      deleteMutation.mutate(id, {
        onSuccess: () => showToast('Tarefa excluída', 'success'),
        onError: (error: Error) => {
          showToast(`Erro ao excluir tarefa: ${error.message}`, 'error');
        },
      });
    }
  };

  return {
    tasks,
    dueToday,
    upcoming,
    contacts,
    getContactName,
    isLoading,
    isDrawerOpen,
    setIsDrawerOpen,
    formData,
    setFormData,
    handleNew,
    handleSubmit,
    handleComplete,
    handleSnooze,
    handleDelete,
  };
};
