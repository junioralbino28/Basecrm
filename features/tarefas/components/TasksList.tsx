import React from 'react';
import { AlarmClock, CalendarClock } from 'lucide-react';
import { Task } from '@/types';
import { TaskRow } from './TaskRow';

interface TasksListProps {
  dueToday: Task[];
  upcoming: Task[];
  isLoading: boolean;
  getContactName: (contactId?: string) => string;
  onComplete: (task: Task) => void;
  onSnooze: (task: Task) => void;
  onDelete: (id: string) => void;
}

/**
 * Seções "Vence hoje" e "Próximas" — espelho da tela Tarefas do mockup.
 * "Vence hoje" inclui as atrasadas (tarefa vencida não pode sumir).
 */
export const TasksList: React.FC<TasksListProps> = ({
  dueToday,
  upcoming,
  isLoading,
  getContactName,
  onComplete,
  onSnooze,
  onDelete,
}) => {
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-line bg-card p-8 text-center text-sm text-muted">
        Carregando tarefas...
      </div>
    );
  }

  const rowProps = { onComplete, onSnooze, onDelete };

  return (
    <div className="space-y-6">
      <section aria-label="Vence hoje" className="rounded-2xl border border-line bg-card shadow-lg shadow-black/[.04] overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-line">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-gold-50 text-gold-600">
            <AlarmClock size={18} aria-hidden="true" />
          </span>
          <h2 className="font-display font-semibold text-base text-ink">Vence hoje</h2>
          <span className="text-xs text-gold-700 font-semibold bg-gold-50 rounded-full px-2 py-0.5">
            {dueToday.length}
          </span>
          <span className="ml-auto text-[11px] text-faint hidden sm:block">
            as de hoje também aparecem no &quot;Seguir hoje&quot;
          </span>
        </div>
        <div className="divide-y divide-line">
          {dueToday.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">
              Nada vencendo hoje — caixa limpa.
            </p>
          ) : (
            dueToday.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                contactName={getContactName(task.contactId)}
                variant="today"
                {...rowProps}
              />
            ))
          )}
        </div>
      </section>

      <section aria-label="Próximas" className="rounded-2xl border border-line bg-card shadow-lg shadow-black/[.04] overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-line">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <CalendarClock size={18} aria-hidden="true" />
          </span>
          <h2 className="font-display font-semibold text-base text-ink">Próximas</h2>
        </div>
        <div className="divide-y divide-line">
          {upcoming.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">
              Nenhuma tarefa futura — crie uma com o botão acima.
            </p>
          ) : (
            upcoming.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                contactName={getContactName(task.contactId)}
                variant="upcoming"
                {...rowProps}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
};
