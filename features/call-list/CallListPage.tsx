import React from 'react';
import { BellRing } from 'lucide-react';
import { useCallListController } from './hooks/useCallListController';
import { CallListTable } from './components/CallListTable';
import { CallModal } from '@/features/inbox/components/CallModal';

interface CallListPageProps {
  /** "Agora" injetável para testes determinísticos (default: relógio real). */
  now?: Date;
}

/**
 * Home "Hoje" / call-list: "quem ligar/seguir hoje" — espelho do hero
 * "Seguir hoje" do mockup aprovado.
 *
 * Deriva client-side das activities (type 'CALL', !completed) + tasks do N2
 * vencendo hoje; contatos whatsapp_only ficam FORA da lista de ligar. Reusa o
 * CallModal já testado para registrar o resultado da ligação. Ao salvar o log,
 * a pendência é concluída (handleMarkDone) — o sistema NÃO move o deal no
 * funil automaticamente (guardrail do playbook).
 */
export const CallListPage: React.FC<CallListPageProps> = ({ now }) => {
  const {
    buckets,
    totalPending,
    isLoading,
    error,
    isCallModalOpen,
    activeEntry,
    openCall,
    closeCall,
    handleMarkDone,
  } = useCallListController(now);

  const activeTitle =
    activeEntry?.kind === 'task' ? activeEntry.task.title : activeEntry?.activity?.title;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-xl bg-gold-50 text-gold-600 dark:bg-gold-500/15 dark:text-gold-500">
          <BellRing size={20} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-ink font-display">Seguir hoje</h1>
          <p className="text-muted text-sm mt-0.5">
            {totalPending === 1
              ? '1 pendência pra cuidar — ligações e lembretes'
              : `${totalPending} pendências pra cuidar — ligações e lembretes`}
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="rounded-2xl border border-line bg-card p-10 text-center text-sm text-muted">
          Carregando ligações...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10 p-10 text-center text-sm text-rose-700 dark:text-rose-300">
          Não foi possível carregar as ligações. Tente novamente.
        </div>
      ) : (
        <CallListTable buckets={buckets} onCall={openCall} onMarkDone={handleMarkDone} />
      )}

      <CallModal
        isOpen={isCallModalOpen}
        onClose={closeCall}
        onSave={() => {
          if (activeEntry) {
            handleMarkDone(activeEntry);
          }
          closeCall();
        }}
        contactName={activeEntry?.contact?.name || 'Contato'}
        contactPhone={activeEntry?.contact?.phone || ''}
        suggestedTitle={activeTitle || 'Ligação'}
      />
    </div>
  );
};
