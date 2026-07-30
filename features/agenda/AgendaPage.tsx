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
import { useAgendaLocalController, type VisaoAgenda } from './hooks/useAgendaLocalController';
import { AgendaGradeDia } from './components/AgendaGradeDia';
import { AgendaGradeSemana } from './components/AgendaGradeSemana';
import { AgendaGradeMes } from './components/AgendaGradeMes';
import { rotuloCurtoDoDia, rotuloDoMes } from './components/agendaFormato';
import { MarcarConsultaModal, DetalheConsultaModal } from './components/MarcarConsultaModal';
import type { AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';

const VISOES: { valor: VisaoAgenda; rotulo: string }[] = [
  { valor: 'dia', rotulo: 'Dia' },
  { valor: 'semana', rotulo: 'Semana' },
  { valor: 'mes', rotulo: 'Mês' },
];

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AgendaPage() {
  const controller = useAgendaLocalController();
  const { data: professionals = [] } = useProfessionals();
  const { data: contacts = [] } = useContacts();

  const [marcando, setMarcando] = React.useState<{ professionalId: string; hora: string } | null>(null);
  const [aberta, setAberta] = React.useState<AppointmentDoDia | null>(null);
  const [escolhidoId, setEscolhidoId] = React.useState<string | null>(null);

  const ativos = React.useMemo(() => professionals.filter((p) => p.active !== false), [professionals]);
  const profDaMarcacao = marcando ? ativos.find((p) => p.id === marcando.professionalId) : null;

  // Semana e mês são de UMA pessoa. Ao trocar de visão sem ninguém escolhido,
  // assume o primeiro da lista pra tela não abrir vazia.
  const escolhido = React.useMemo(
    () => ativos.find((p) => p.id === escolhidoId) ?? ativos[0] ?? null,
    [ativos, escolhidoId],
  );
  const individual = controller.visao !== 'dia';
  const consultasDele = React.useMemo(
    () =>
      escolhido
        ? controller.appointments.filter((a) => a.professionalId === escolhido.id)
        : [],
    [controller.appointments, escolhido],
  );

  const tituloDoPeriodo =
    controller.visao === 'mes'
      ? rotuloDoMes(controller.date)
      : controller.visao === 'semana'
        ? `Semana de ${controller.intervalo.de.split('-').reverse().join('/')}`
        : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Agenda</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => controller.avancar(-1)}
            aria-label={controller.visao === 'mes' ? 'Mês anterior' : controller.visao === 'semana' ? 'Semana anterior' : 'Dia anterior'}
            className="rounded-lg p-2 text-slate-500 hover:bg-surface hover:text-ink"
          >
            <ChevronLeft size={18} />
          </button>
          <input
            type="date"
            value={controller.date}
            onChange={(e) => controller.setDate(e.target.value)}
            aria-label="Data da agenda"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-line dark:bg-card/50 dark:text-white"
          />
          <button
            type="button"
            onClick={() => controller.avancar(1)}
            aria-label={controller.visao === 'mes' ? 'Próximo mês' : controller.visao === 'semana' ? 'Próxima semana' : 'Próximo dia'}
            className="rounded-lg p-2 text-slate-500 hover:bg-surface hover:text-ink"
          >
            <ChevronRight size={18} />
          </button>
          <button type="button" onClick={controller.voltarPraHoje} className="ml-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:text-slate-300">
            Hoje
          </button>
        </div>

        <div role="group" aria-label="Como ver a agenda" className="flex items-center gap-0.5 rounded-xl border border-slate-200 p-0.5 dark:border-white/10">
          {VISOES.map((v) => (
            <button
              key={v.valor}
              type="button"
              onClick={() => controller.setVisao(v.valor)}
              aria-pressed={controller.visao === v.valor}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                controller.visao === v.valor
                  ? 'bg-brand-500 text-white'
                  : 'text-slate-600 hover:bg-surface dark:text-slate-300'
              }`}
            >
              {v.rotulo}
            </button>
          ))}
        </div>

        {individual ? (
          <label className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            Profissional
            <select
              value={escolhido?.id ?? ''}
              onChange={(e) => setEscolhidoId(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-line dark:bg-card/50 dark:text-white"
            >
              {ativos.map((pro) => (
                <option key={pro.id} value={pro.id}>
                  {pro.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {tituloDoPeriodo ? (
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{tituloDoPeriodo}</span>
        ) : null}
        {controller.isLoading ? <span className="text-xs text-slate-400">Carregando…</span> : null}
      </header>

      {controller.error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-900/20 dark:text-red-400">
          Não deu pra carregar a agenda: {controller.error.message}
        </p>
      ) : null}

      {individual && !escolhido ? (
        <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
          Cadastre os profissionais em Configurações → Equipe para ver a agenda por semana ou mês.
        </p>
      ) : null}

      {controller.visao === 'dia' ? (
        <AgendaGradeDia
          appointments={controller.appointments}
          professionals={ativos}
          onMarcar={(professionalId, hora) => setMarcando({ professionalId, hora })}
          onAbrirConsulta={setAberta}
        />
      ) : null}

      {controller.visao === 'semana' && escolhido ? (
        <AgendaGradeSemana
          appointments={consultasDele}
          date={controller.date}
          professionalName={escolhido.name}
          hoje={hojeIso()}
          onMarcar={(dataIso, hora) => {
            // A marcação usa a data do controller: mudar pro dia clicado mantém
            // a MESMA semana na tela (a janela é calculada pela segunda-feira).
            controller.setDate(dataIso);
            setMarcando({ professionalId: escolhido.id, hora });
          }}
          onAbrirConsulta={setAberta}
        />
      ) : null}

      {controller.visao === 'mes' && escolhido ? (
        <AgendaGradeMes
          appointments={consultasDele}
          date={controller.date}
          professionalName={escolhido.name}
          hoje={hojeIso()}
          onAbrirDia={(dataIso) => {
            controller.setDate(dataIso);
            controller.setVisao('dia');
          }}
          onAbrirConsulta={setAberta}
        />
      ) : null}

      {marcando && profDaMarcacao ? (
        <MarcarConsultaModal
          professionalId={marcando.professionalId}
          professionalName={profDaMarcacao.name}
          hora={marcando.hora}
          // Fora da visão de dia a vaga clicada pode ser outro dia — dizer qual.
          dia={individual ? rotuloCurtoDoDia(controller.date) : undefined}
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
