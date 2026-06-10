import React from 'react';
import { Plus } from 'lucide-react';
import { useTarefasController } from './hooks/useTarefasController';
import { TasksList } from './components/TasksList';
import { TaskFormDrawer } from './components/TaskFormDrawer';

/**
 * Tela "Tarefas & lembretes" (N2) — espelho do mockup aprovado.
 * Seções "Vence hoje" (inclui atrasadas) e "Próximas"; drawer "Nova tarefa"
 * com o toggle "Julia avisa primeiro no WhatsApp" (v1 só persiste julia_first).
 */
export const TarefasPage: React.FC = () => {
  const {
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
  } = useTarefasController();

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-ink font-display">Tarefas &amp; lembretes</h1>
          <p className="text-muted text-sm mt-1.5">
            ligações, retornos e avisos — nada de paciente esquecido
          </p>
        </div>
        <button
          type="button"
          onClick={handleNew}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold shadow-lg shadow-gold-600/20 active:scale-[.98] transition-all"
        >
          <Plus size={18} aria-hidden="true" />
          Nova tarefa
        </button>
      </div>

      <TasksList
        dueToday={dueToday}
        upcoming={upcoming}
        isLoading={isLoading}
        getContactName={getContactName}
        onComplete={handleComplete}
        onSnooze={handleSnooze}
        onDelete={handleDelete}
      />

      <TaskFormDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onSubmit={handleSubmit}
        formData={formData}
        setFormData={setFormData}
        contacts={contacts}
      />
    </div>
  );
};
