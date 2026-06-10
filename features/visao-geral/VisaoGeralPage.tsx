'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserPlus,
  Hourglass,
  ListChecks,
  Wallet,
  TriangleAlert,
  Sparkles,
} from 'lucide-react';
import { StatCard } from '@/features/dashboard/components/StatCard';
import { LazyLeadsByDayChart, ChartWrapper } from '@/components/charts';
import { useContacts } from '@/lib/query/hooks/useContactsQuery';
import { useDealsView } from '@/lib/query/hooks/useDealsQuery';
import { useTasks, useCreateTask } from '@/lib/query/hooks/useTasksQuery';
import { useLeadSources } from '@/lib/query/hooks/useLeadSourcesQuery';
import { useRevenueReport } from '@/lib/query/hooks/useFinanceReports';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useCRM } from '@/context/CRMContext';
import { canManageClinicSettings } from '@/lib/auth/scope';
import { getFinanceDateRange } from '@/features/reports/utils/financeDateRange';
import {
  contarLeadsNovosDoMes,
  contarTarefasDeHoje,
  leadsPorDia,
  leadsPorOrigem,
  funilDoMes,
  dealsParados,
  paradosPorEtapa,
  notasDeAtencao,
  isoDateLocal,
  type NotaAtencao,
} from './utils/leituraInteligente';

/** Dias sem movimento pra considerar um deal "parado" (mockup: 3+). */
const DIAS_PARADO = 3;
/** Janela da série "Leads por dia". */
const DIAS_SERIE = 14;

const formatBRL = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const MES_LABEL = new Intl.DateTimeFormat('pt-BR', { month: 'long' });

/**
 * Card "Recebido no mês" — componente separado pra montar SÓ pra admin
 * (clinic_staff nem dispara a query financeira; o RPC barra de novo no banco).
 */
const RecebidoNoMesCard: React.FC = () => {
  const { start, end } = useMemo(() => getFinanceDateRange('this_month'), []);
  const { data: revenue, isLoading } = useRevenueReport(start, end);

  return (
    <StatCard
      title="Recebido no mês"
      value={isLoading ? '...' : formatBRL(revenue?.faturamento ?? 0)}
      subtext={`${revenue?.totalAtendimentos ?? 0} atendimentos pagos`}
      subtextPositive
      icon={Wallet}
      color="bg-emerald-500"
      comparisonLabel="líquido no Financeiro"
    />
  );
};

/**
 * Visão Geral (N5) — o mês da clínica num olhar.
 *
 * Acessível a todo o tenant; o card de R$ é gated por role (mockup
 * data-roles="clinica agencia"). Leitura inteligente determinística:
 * leads parados por etapa (last_stage_change_date) com CTA "mandar pra fila"
 * (tasks em lote) e notas de atenção com botão resolver → ação concreta.
 * Insights da Julia (IA) = v1.1, card atrás de flag.
 */
const VisaoGeralPage: React.FC = () => {
  const router = useRouter();
  const { profile } = useAuth();
  const { addToast } = useToast();
  const { lifecycleStages } = useCRM();

  const { data: contactsData, isLoading: contactsLoading } = useContacts();
  const { data: dealsData } = useDealsView();
  const { data: tasksData } = useTasks();
  const { data: leadSourcesData } = useLeadSources();
  const createTask = useCreateTask();

  const [resolvendo, setResolvendo] = useState<string | null>(null);

  const canSeeMoney = canManageClinicSettings(profile?.role);
  const juliaInsightsOn = process.env.NEXT_PUBLIC_FEATURE_JULIA_INSIGHTS === '1';

  const contacts = useMemo(() => contactsData ?? [], [contactsData]);
  const deals = useMemo(() => dealsData ?? [], [dealsData]);
  const tasks = useMemo(() => tasksData ?? [], [tasksData]);

  const leadsNovos = useMemo(() => contarLeadsNovosDoMes(contacts), [contacts]);
  const tarefasHoje = useMemo(() => contarTarefasDeHoje(tasks), [tasks]);
  const seriePorDia = useMemo(() => leadsPorDia(contacts, DIAS_SERIE), [contacts]);
  const origens = useMemo(
    () =>
      leadsPorOrigem(
        contacts,
        (leadSourcesData ?? []).filter((s) => s.active).map((s) => s.name)
      ),
    [contacts, leadSourcesData]
  );
  const funil = useMemo(
    () => funilDoMes(contacts, lifecycleStages ?? []),
    [contacts, lifecycleStages]
  );
  const parados = useMemo(() => dealsParados(deals, new Date(), DIAS_PARADO), [deals]);
  const paradosEtapas = useMemo(() => paradosPorEtapa(parados), [parados]);
  const notas = useMemo(
    () => notasDeAtencao({ contacts, deals, tasks }),
    [contacts, deals, tasks]
  );

  const maxFunil = Math.max(...funil.map((f) => f.count), 1);
  const maxOrigem = Math.max(...origens.map((o) => o.leads), 1);
  const maxParados = Math.max(...paradosEtapas.map((p) => p.count), 1);

  /** Cria tasks de ligação em lote pros alvos (CTA fila / resolver). */
  const criarTasksEmLote = useCallback(
    async (
      alvos: Array<{ contactId?: string; nome: string }>,
      tituloPrefixo: string,
      tipo: 'call' | 'message'
    ) => {
      const hoje = isoDateLocal(new Date());
      const resultados = await Promise.allSettled(
        alvos.map((alvo) =>
          createTask.mutateAsync({
            task: {
              type: tipo,
              title: `${tituloPrefixo}: ${alvo.nome}`,
              contactId: alvo.contactId,
              dueDate: hoje,
              status: 'open',
              juliaFirst: false,
            },
          })
        )
      );
      const ok = resultados.filter((r) => r.status === 'fulfilled').length;
      const falhas = resultados.length - ok;
      if (ok > 0) {
        addToast(
          `${ok} tarefa${ok > 1 ? 's' : ''} criada${ok > 1 ? 's' : ''} na fila de hoje.`,
          'success'
        );
      }
      if (falhas > 0) {
        addToast(`Não foi possível criar ${falhas} tarefa${falhas > 1 ? 's' : ''}.`, 'error');
      }
    },
    [createTask, addToast]
  );

  const handleMandarPraFila = useCallback(async () => {
    if (parados.length === 0) return;
    setResolvendo('fila');
    try {
      await criarTasksEmLote(
        parados.map((d) => ({ contactId: d.contactId, nome: d.contactName || d.title })),
        'Follow-up',
        'call'
      );
    } finally {
      setResolvendo(null);
    }
  }, [parados, criarTasksEmLote]);

  const handleResolverNota = useCallback(
    async (nota: NotaAtencao) => {
      if (nota.key === 'tarefas_vencidas') {
        router.push('/tarefas');
        return;
      }
      setResolvendo(nota.key);
      try {
        await criarTasksEmLote(
          nota.alvos,
          nota.key === 'orcamentos_parados' ? 'Retomar orçamento' : 'Ligar',
          nota.key === 'orcamentos_parados' ? 'message' : 'call'
        );
      } finally {
        setResolvendo(null);
      }
    },
    [router, criarTasksEmLote]
  );

  return (
    <div className="flex flex-col space-y-4">
      {/* Header */}
      <div className="shrink-0">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
          Visão Geral
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          o mês da clínica num olhar · {MES_LABEL.format(new Date())}
        </p>
      </div>

      {/* KPIs */}
      <div className={`grid grid-cols-2 ${canSeeMoney ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-4 shrink-0`}>
        <StatCard
          title="Leads novos"
          value={contactsLoading ? '...' : String(leadsNovos)}
          subtext="criados este mês"
          subtextPositive
          icon={UserPlus}
          color="bg-blue-500"
          comparisonLabel="coorte do mês"
        />
        <StatCard
          title="Leads parados"
          value={String(parados.length)}
          subtext={`sem movimento há ${DIAS_PARADO}+ dias`}
          subtextPositive={parados.length === 0}
          icon={Hourglass}
          color="bg-red-500"
          comparisonLabel="é aqui que o dinheiro vaza"
        />
        <StatCard
          title="Tarefas de hoje"
          value={String(tarefasHoje)}
          subtext="abertas vencendo hoje"
          subtextPositive={tarefasHoje === 0}
          icon={ListChecks}
          color="bg-amber-500"
          comparisonLabel="fila do dia"
        />
        {canSeeMoney ? <RecebidoNoMesCard /> : null}
      </div>

      {/* Leitura inteligente: parados · atenção · (insights atrás de flag) */}
      <div className={`grid grid-cols-1 ${juliaInsightsOn ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-4 shrink-0`}>
        {/* Leads parados por etapa */}
        <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <span className="grid place-items-center w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600">
              <Hourglass size={15} aria-hidden="true" />
            </span>
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
              Leads parados
            </h2>
            <span className="ml-auto text-[10px] text-slate-400">
              sem movimento há {DIAS_PARADO}+ dias
            </span>
          </div>
          {paradosEtapas.length > 0 ? (
            <div className="space-y-3 text-xs flex-1">
              {paradosEtapas.map((etapa, i) => (
                <div key={etapa.etapa}>
                  <div className="flex justify-between mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {etapa.etapa}
                      {i === 0 && paradosEtapas.length > 1 ? (
                        <span className="text-[10px] text-rose-600 font-semibold bg-rose-50 dark:bg-rose-500/10 rounded-full px-1.5 py-0.5 ml-1.5">
                          pior etapa
                        </span>
                      ) : null}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white">{etapa.count}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                    <span
                      className="block h-full bg-rose-400 rounded-full"
                      style={{ width: `${Math.max((etapa.count / maxParados) * 100, 6)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 flex-1">Nenhum lead parado. Fila limpa.</p>
          )}
          {parados.length > 0 ? (
            <button
              type="button"
              disabled={resolvendo === 'fila'}
              onClick={handleMandarPraFila}
              className="mt-4 w-full h-9 rounded-xl border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-50 transition"
            >
              {resolvendo === 'fila'
                ? 'criando tarefas...'
                : `Mandar os ${parados.length} pra fila de follow-up`}
            </button>
          ) : null}
        </div>

        {/* Notas de atenção */}
        <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="grid place-items-center w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600">
              <TriangleAlert size={15} aria-hidden="true" />
            </span>
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">Atenção</h2>
          </div>
          {notas.length > 0 ? (
            <div className="space-y-3">
              {notas.map((nota) => (
                <div key={nota.key} className="flex items-start gap-2.5 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" aria-hidden="true" />
                  <div className="flex-1">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{nota.titulo}</span>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{nota.detalhe}</div>
                  </div>
                  <button
                    type="button"
                    disabled={resolvendo === nota.key}
                    onClick={() => handleResolverNota(nota)}
                    className="h-7 px-2 rounded-lg border border-slate-200 dark:border-white/10 text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50 transition shrink-0"
                  >
                    {resolvendo === nota.key ? '...' : 'resolver'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nada exigindo atenção agora.</p>
          )}
        </div>

        {/* Insights da Julia — v1.1, atrás de flag (NÃO gera nada por IA no v1) */}
        {juliaInsightsOn ? (
          <div className="glass p-5 rounded-xl border border-brand-100 dark:border-brand-500/20 shadow-sm relative overflow-hidden">
            <span className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-brand-500 via-brand-500/50 to-transparent" aria-hidden="true" />
            <div className="flex items-center gap-2 mb-4">
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300">
                <Sparkles size={15} aria-hidden="true" />
              </span>
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">Insights</h2>
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-500/10 rounded-full px-1.5 py-0.5">
                Julia
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Os insights semanais da Julia sobre os dados do mês chegam na v1.1.
            </p>
          </div>
        ) : null}
      </div>

      {/* Leads por dia */}
      <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col min-h-[240px] shrink-0">
        <div className="flex justify-between items-center mb-2 shrink-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">Leads por dia</h2>
          <span className="text-xs text-slate-400">últimos {DIAS_SERIE} dias</span>
        </div>
        <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0">
            <ChartWrapper height="100%">
              <LazyLeadsByDayChart data={seriePorDia} />
            </ChartWrapper>
          </div>
        </div>
      </div>

      {/* Funil do mês + De onde vem o lead */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
        <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 dark:text-white font-display mb-4">
            Funil do mês
          </h2>
          {funil.length > 0 ? (
            <div className="space-y-3 text-xs">
              {funil.map((etapa) => (
                <div key={etapa.etapa}>
                  <div className="flex justify-between mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{etapa.etapa}</span>
                    <span className="text-slate-500">{etapa.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                    <span
                      className="block h-full bg-brand-500 rounded-full"
                      style={{ width: `${Math.max((etapa.count / maxFunil) * 100, 3)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Sem etapas configuradas.</p>
          )}
          <p className="text-[11px] text-slate-400 mt-4">
            onde o dinheiro vaza: lead → agendamento. é aí que a call-list trabalha.
          </p>
        </div>

        <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 dark:text-white font-display mb-4">
            De onde vem o lead
          </h2>
          {origens.length > 0 ? (
            <div className="space-y-3 text-xs">
              {origens.map((origem) => (
                <div key={origem.origem}>
                  <div className="flex justify-between mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{origem.origem}</span>
                    <span className="text-slate-500">{origem.leads}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                    <span
                      className="block h-full bg-gold-500 rounded-full"
                      style={{ width: `${Math.max((origem.leads / maxOrigem) * 100, 3)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Cadastre origens em Contatos pra ver o quebra-quebra.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default VisaoGeralPage;
