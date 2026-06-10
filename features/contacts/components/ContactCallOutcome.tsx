import React, { useMemo, useState } from 'react';
import { MessageCircle, PhoneForwarded } from 'lucide-react';
import { Activity, Contact } from '@/types';
import { useCreateActivity } from '@/lib/query/hooks/useActivitiesQuery';
import { useUpdateContact } from '@/lib/query/hooks/useContactsQuery';
import { useCreateTask } from '@/lib/query/hooks/useTasksQuery';
import { useToast } from '@/context/ToastContext';
import { addDaysIso, localTodayIso } from '@/features/tarefas/hooks/useTarefasController';

interface ContactCallOutcomeProps {
    contact: Contact;
    /** Deal aberto na ficha (activities têm deal_id). */
    dealId: string;
    dealTitle: string;
    /** Atividades do deal — usadas pra mostrar a última ligação registrada. */
    activities: Activity[];
}

/**
 * Bloco "Última ligação — marcar resultado" da ficha do contato (N2 — mockup).
 *
 * Convenção de resultado: activity type CALL com `description` prefixada pelo
 * resultado ("Atendeu", "Não atendeu", ...) — MESMO padrão do CallModal
 * (handleCallLogSave) já existente no repo; activities não têm coluna metadata.
 *
 * - Atendeu / Não atendeu → registra a activity CALL.
 * - Ligar depois → cria task type 'call' com data (e hora opcional) + activity.
 * - Só WhatsApp → seta contacts.contact_preference = 'whatsapp_only' (sai da
 *   call-list, badge na ficha) + activity.
 */
export const ContactCallOutcome: React.FC<ContactCallOutcomeProps> = ({
    contact,
    dealId,
    dealTitle,
    activities,
}) => {
    const createActivity = useCreateActivity();
    const updateContact = useUpdateContact();
    const createTask = useCreateTask();
    const { showToast } = useToast();

    const [note, setNote] = useState('');
    const [isSchedulingCall, setIsSchedulingCall] = useState(false);
    const [callDate, setCallDate] = useState(() => addDaysIso(localTodayIso(), 1));
    const [callTime, setCallTime] = useState('');

    const lastCall = useMemo(
        () =>
            [...activities]
                .filter(a => a.type === 'CALL')
                .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0],
        [activities]
    );

    const buildDescription = (outcome: string) => (note.trim() ? `${outcome} - ${note.trim()}` : outcome);

    const logCall = (outcome: string, onSuccess?: () => void) => {
        createActivity.mutate(
            {
                activity: {
                    dealId,
                    dealTitle,
                    contactId: contact.id,
                    type: 'CALL',
                    title: `Ligação - ${contact.name}`,
                    description: buildDescription(outcome),
                    date: new Date().toISOString(),
                    completed: true,
                    user: { name: 'Eu', avatar: '' },
                },
            },
            {
                onSuccess: () => {
                    setNote('');
                    onSuccess?.();
                },
                onError: (error: Error) => {
                    showToast(`Erro ao registrar resultado: ${error.message}`, 'error');
                },
            }
        );
    };

    const handleAtendeu = () => logCall('Atendeu', () => showToast('Resultado: atendeu', 'success'));
    const handleNaoAtendeu = () =>
        logCall('Não atendeu', () => showToast('Resultado: não atendeu', 'success'));

    const handleLigarDepois = () => {
        createTask.mutate(
            {
                task: {
                    contactId: contact.id,
                    type: 'call',
                    title: `Ligar pra ${contact.name}`,
                    note: note.trim() || undefined,
                    dueDate: callDate,
                    dueTime: callTime || undefined,
                    status: 'open',
                    juliaFirst: false,
                },
            },
            {
                onSuccess: () => {
                    logCall('Ligar depois');
                    setIsSchedulingCall(false);
                    showToast('Tarefa de ligação criada', 'success');
                },
                onError: (error: Error) => {
                    showToast(`Erro ao criar tarefa de ligação: ${error.message}`, 'error');
                },
            }
        );
    };

    const handleSoWhatsapp = () => {
        updateContact.mutate(
            { id: contact.id, updates: { contactPreference: 'whatsapp_only' } },
            {
                onSuccess: () => {
                    logCall('Só WhatsApp');
                    showToast('Preferência salva: só WhatsApp — sai da lista de ligações', 'success');
                },
                onError: (error: Error) => {
                    showToast(`Erro ao salvar preferência: ${error.message}`, 'error');
                },
            }
        );
    };

    const chipClass =
        'h-7 px-2.5 rounded-full border border-slate-700 text-[11px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-white transition';

    return (
        <div className="p-4 border-b border-dark-border">
            <h3 className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-2.5 flex items-center gap-1.5">
                <PhoneForwarded size={11} aria-hidden="true" />
                Última ligação — marcar resultado
            </h3>

            <div className="flex items-center gap-1.5 flex-wrap">
                <button type="button" onClick={handleAtendeu} className={chipClass}>
                    Atendeu
                </button>
                <button type="button" onClick={handleNaoAtendeu} className={chipClass}>
                    Não atendeu
                </button>
                <button
                    type="button"
                    onClick={() => setIsSchedulingCall(v => !v)}
                    className={chipClass}
                >
                    Ligar depois
                </button>
                <button type="button" onClick={handleSoWhatsapp} className={chipClass}>
                    <span className="inline-flex items-center gap-1">
                        <MessageCircle size={11} aria-hidden="true" />
                        Só WhatsApp
                    </span>
                </button>
            </div>

            {isSchedulingCall && (
                <div className="mt-2.5 flex items-center gap-2">
                    <input
                        type="date"
                        aria-label="Data da ligação"
                        value={callDate}
                        onChange={e => setCallDate(e.target.value)}
                        className="h-8 px-2 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <input
                        type="time"
                        aria-label="Hora da ligação (opcional)"
                        value={callTime}
                        onChange={e => setCallTime(e.target.value)}
                        className="h-8 px-2 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <button
                        type="button"
                        onClick={handleLigarDepois}
                        className="h-8 px-3 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-[11px] font-semibold transition"
                    >
                        Criar tarefa
                    </button>
                </div>
            )}

            {lastCall?.description && (
                <div className="mt-2.5 rounded-xl bg-slate-800/60 px-3 py-2.5 text-[11px] text-slate-400 italic">
                    &quot;{lastCall.description}&quot;
                    {lastCall.date && (
                        <span className="not-italic text-[10px] text-slate-600">
                            {' '}· {new Date(lastCall.date).toLocaleDateString('pt-BR')}
                        </span>
                    )}
                </div>
            )}

            <input
                aria-label="Anotação da ligação"
                placeholder="+ anotar (ex.: pediu pra ligar depois das 18h)"
                value={note}
                onChange={e => setNote(e.target.value)}
                className="mt-2 w-full h-9 px-3 rounded-xl bg-slate-800/60 border border-slate-700 text-[12px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500 transition"
            />
        </div>
    );
};
