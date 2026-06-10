import React from 'react';
import { BellRing, Bot, CalendarClock, MessageCircle, Phone, Trash2 } from 'lucide-react';
import { Task, TaskType } from '@/types';

interface TaskRowProps {
  task: Task;
  contactName?: string;
  /** Seção "Próximas" mostra chip de data em vez do círculo de concluir. */
  variant: 'today' | 'upcoming';
  onComplete: (task: Task) => void;
  onSnooze: (task: Task) => void;
  onDelete: (id: string) => void;
}

const TYPE_META: Record<TaskType, { label: string; chipClass: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
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

const formatDateChip = (dueDate: string): string => {
  const [, m, d] = dueDate.split('-');
  return `${d}/${m}`;
};

/**
 * Linha de tarefa — espelho das linhas do mockup (tela "Tarefas").
 * Tipo (ligação/lembrete/whatsapp) · paciente — motivo · nota · hora/data ·
 * ações concluir/adiar/excluir.
 */
export const TaskRow: React.FC<TaskRowProps> = ({
  task,
  contactName,
  variant,
  onComplete,
  onSnooze,
  onDelete,
}) => {
  const meta = TYPE_META[task.type] || TYPE_META.reminder;
  const Icon = meta.icon;
  const heading = contactName ? `${contactName} — ${task.title}` : task.title;

  return (
    <div className="flex items-center gap-3 px-5 py-4">
      {variant === 'today' ? (
        <button
          type="button"
          aria-label={`Concluir: ${heading}`}
          title="Concluir"
          onClick={() => onComplete(task)}
          className="grid place-items-center w-6 h-6 rounded-full border-2 border-line hover:border-brand-500 transition shrink-0"
        />
      ) : (
        <span className="text-[11px] font-semibold text-ink bg-surface border border-line rounded-full px-2.5 py-1 shrink-0">
          {formatDateChip(task.dueDate)}
        </span>
      )}

      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 ${meta.chipClass}`}>
        <Icon size={12} aria-hidden="true" />
        {meta.label}
      </span>

      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm text-ink truncate">{heading}</div>
        {task.note && <div className="text-xs text-muted truncate italic">&quot;{task.note}&quot;</div>}
      </div>

      {task.dueTime && (
        <span className="text-[11px] font-semibold text-ink bg-surface border border-line rounded-full px-2.5 py-1 shrink-0">
          {task.dueTime}
        </span>
      )}

      {task.juliaFirst && (
        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium text-brand-700 bg-brand-50 dark:text-brand-300 dark:bg-brand-500/15 rounded-full px-2 py-0.5 shrink-0">
          <Bot size={12} aria-hidden="true" />
          Julia avisa antes
        </span>
      )}

      {variant === 'today' && (
        <button
          type="button"
          onClick={() => onSnooze(task)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line text-muted text-xs font-semibold hover:bg-surface active:scale-95 transition shrink-0"
        >
          <CalendarClock size={14} aria-hidden="true" />
          Adiar
        </button>
      )}
      {variant === 'upcoming' && (
        <button
          type="button"
          aria-label={`Concluir: ${heading}`}
          title="Concluir"
          onClick={() => onComplete(task)}
          className="grid place-items-center w-6 h-6 rounded-full border-2 border-line hover:border-brand-500 transition shrink-0"
        />
      )}

      <button
        type="button"
        aria-label={`Excluir: ${heading}`}
        title="Excluir"
        onClick={() => onDelete(task.id)}
        className="grid place-items-center w-8 h-8 rounded-lg text-faint hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition shrink-0"
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
};
