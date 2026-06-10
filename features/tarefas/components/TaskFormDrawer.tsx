import React from 'react';
import { AlarmClockPlus, BellRing, Check, MessageCircle, Phone, X } from 'lucide-react';
import { Contact, TaskType } from '@/types';
import type { TaskFormState } from '../hooks/useTarefasController';

interface TaskFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  formData: TaskFormState;
  setFormData: (data: TaskFormState) => void;
  contacts: Contact[];
}

const TYPE_OPTIONS: { value: TaskType; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { value: 'call', label: 'Ligação', icon: Phone },
  { value: 'reminder', label: 'Lembrete', icon: BellRing },
  { value: 'message', label: 'Mensagem', icon: MessageCircle },
];

/**
 * Drawer "Nova tarefa / lembrete" — espelho do mockup `drawer-task`.
 * Paciente opcional ("tarefa geral da recepção") · tipo (ligação/lembrete/
 * mensagem) · motivo · nota · data · hora opcional · toggle "Julia avisa
 * primeiro no WhatsApp" (v1 só persiste `julia_first` — automação é posterior).
 */
export const TaskFormDrawer: React.FC<TaskFormDrawerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  contacts,
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // passive: true porque não usamos preventDefault() - permite scroll mais fluido
    document.addEventListener('keydown', handleEscape, { passive: true });
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const inputClass =
    'w-full h-11 px-3 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40';
  const labelClass = 'block text-xs font-medium text-muted mb-1.5';

  return (
    <div
      className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] bg-slate-900/60 backdrop-blur-sm"
      onClick={(e) => {
        // Fecha só ao clicar no backdrop (fora do painel).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="absolute top-0 right-0 h-full w-full sm:w-[440px] bg-card border-l border-line shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 h-16 border-b border-line shrink-0">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-gold-50 text-gold-600">
            <AlarmClockPlus size={20} aria-hidden="true" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-semibold text-base text-ink">
              Nova tarefa / lembrete
            </h2>
            <p className="text-xs text-muted">pra você não precisar lembrar de nada</p>
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="grid place-items-center w-9 h-9 rounded-lg text-faint hover:bg-surface transition"
          >
            <X size={20} />
          </button>
        </div>

        <form id="task-form" onSubmit={onSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 pb-[calc(1.25rem+var(--app-safe-area-bottom,0px))]">
          <div>
            <label htmlFor="task-paciente" className={labelClass}>Paciente</label>
            <select
              id="task-paciente"
              className={inputClass}
              value={formData.contactId}
              onChange={e => setFormData({ ...formData, contactId: e.target.value })}
            >
              <option value="">Sem paciente</option>
              {contacts.map(contact => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-faint mt-1.5">pode ficar vazio — tarefa geral da recepção</p>
          </div>

          <fieldset>
            <legend className={labelClass}>O que é</legend>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => {
                const selected = formData.type === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setFormData({ ...formData, type: value })}
                    className={`h-10 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition ${
                      selected
                        ? 'border-gold-500 ring-2 ring-gold-500/15 text-gold-700'
                        : 'border-line text-muted hover:border-brand-200 hover:text-brand-700'
                    }`}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="task-motivo" className={labelClass}>Motivo</label>
            <input
              id="task-motivo"
              required
              type="text"
              className={inputClass}
              placeholder="Ex: Retorno do raio-X — marcar consulta de retorno"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
            />
          </div>

          <div>
            <label htmlFor="task-nota" className={labelClass}>Nota (opcional)</label>
            <textarea
              id="task-nota"
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              placeholder='Ex: "tava no trabalho, pediu pra ligar à tarde"'
              value={formData.note}
              onChange={e => setFormData({ ...formData, note: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="task-data" className={labelClass}>Quando</label>
              <input
                id="task-data"
                required
                type="date"
                className={inputClass}
                value={formData.dueDate}
                onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="task-hora" className={labelClass}>Hora (opcional)</label>
              <input
                id="task-hora"
                type="time"
                className={inputClass}
                value={formData.dueTime}
                onChange={e => setFormData({ ...formData, dueTime: e.target.value })}
              />
            </div>
          </div>

          <div className="rounded-xl border border-brand-200 bg-brand-50 p-3.5 dark:border-brand-500/30 dark:bg-brand-500/10">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.juliaFirst}
                onChange={e => setFormData({ ...formData, juliaFirst: e.target.checked })}
                className="w-4 h-4 accent-brand-600 shrink-0"
              />
              <span className="text-[13px] font-semibold text-brand-700 dark:text-brand-300">
                Julia avisa primeiro no WhatsApp
              </span>
            </label>
            <p className="text-xs text-muted mt-2 leading-relaxed pl-7">
              Na data, a Julia manda a mensagem pro paciente.{' '}
              <b>Se ele não responder em 24h, vira tarefa de ligação</b> na sua lista —
              ninguém fica esquecido.
            </p>
          </div>
        </form>

        <div className="p-4 border-t border-line shrink-0">
          <button
            type="submit"
            form="task-form"
            className="w-full h-12 rounded-xl bg-gold-600 text-white font-semibold text-[15px] inline-flex items-center justify-center gap-2 hover:bg-gold-700 active:scale-[.99] transition shadow-lg shadow-gold-600/20"
          >
            <Check size={20} aria-hidden="true" />
            Criar
          </button>
        </div>
      </aside>
    </div>
  );
};
