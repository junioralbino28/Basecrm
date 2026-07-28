'use client';

/**
 * Agenda NOSSA — fatia 1 (Junior, 28/07/2026: "a agenda vai ser nossa").
 * Visão de DIA no padrão do Clinicorp (referência pedida por ele): colunas por
 * dentista, grade de meia em meia hora. Marcar/remarcar/cancelar vive no NOSSO
 * banco; nesta fatia nada toca o Clinicorp — o espelho (ida) e a volta são as
 * fatias 2 e 3, depois do parecer do Codex.
 */
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useProfessionals } from '@/lib/query/hooks';
import { useContacts } from '@/lib/query/hooks/useContactsQuery';
import { useAgendaLocalController } from './hooks/useAgendaLocalController';
import { AgendaGradeDia } from './components/AgendaGradeDia';
import { MarcarConsultaModal, DetalheConsultaModal } from './components/MarcarConsultaModal';
import type { AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';

export function AgendaPage() {
  const controller = useAgendaLocalController();
  const { data: professionals = [] } = useProfessionals();
  const { data: contacts = [] } = useContacts();

  const [marcando, setMarcando] = React.useState<{ professionalId: string; hora: string } | null>(null);
  const [aberta, setAberta] = React.useState<AppointmentDoDia | null>(null);

  const ativos = React.useMemo(() => professionals.filter((p) => p.active !== false), [professionals]);
  const profDaMarcacao = marcando ? ativos.find((p) => p.id === marcando.professionalId) : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Agenda</h1>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => controller.irParaDia(-1)} aria-label="Dia anterior" className="rounded-lg p-2 text-slate-500 hover:bg-surface hover:text-ink">
            <ChevronLeft size={18} />
          </button>
          <input
            type="date"
            value={controller.date}
            onChange={(e) => controller.setDate(e.target.value)}
            aria-label="Data da agenda"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-line dark:bg-card/50 dark:text-white"
          />
          <button type="button" onClick={() => controller.irParaDia(1)} aria-label="Próximo dia" className="rounded-lg p-2 text-slate-500 hover:bg-surface hover:text-ink">
            <ChevronRight size={18} />
          </button>
          <button type="button" onClick={controller.voltarPraHoje} className="ml-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:text-slate-300">
            Hoje
          </button>
        </div>
        {controller.isLoading ? <span className="text-xs text-slate-400">Carregando…</span> : null}
      </header>

      {controller.error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-900/20 dark:text-red-400">
          Não deu pra carregar a agenda: {controller.error.message}
        </p>
      ) : null}

      <AgendaGradeDia
        appointments={controller.appointments}
        professionals={ativos}
        onMarcar={(professionalId, hora) => setMarcando({ professionalId, hora })}
        onAbrirConsulta={setAberta}
      />

      {marcando && profDaMarcacao ? (
        <MarcarConsultaModal
          professionalId={marcando.professionalId}
          professionalName={profDaMarcacao.name}
          hora={marcando.hora}
          contacts={contacts}
          salvando={controller.criando}
          onConfirmar={controller.criar}
          onFechar={() => setMarcando(null)}
        />
      ) : null}

      {aberta ? (
        <DetalheConsultaModal
          appt={aberta}
          professionals={ativos}
          date={controller.date}
          remarcando={controller.remarcando}
          mudandoStatus={controller.mudandoStatus}
          onRemarcar={controller.remarcar}
          onMudarStatus={controller.mudarStatus}
          onFechar={() => setAberta(null)}
        />
      ) : null}
    </div>
  );
}
