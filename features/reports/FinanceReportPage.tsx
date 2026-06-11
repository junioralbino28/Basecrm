'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { DollarSign, Users, TrendingUp, Download, CreditCard, Receipt, Lock } from 'lucide-react';
import { StatCard } from '@/features/dashboard/components/StatCard';
import { PeriodFilterSelect } from '@/components/filters/PeriodFilterSelect';
import {
  LazyRevenueTrendChart,
  LazyMoneyAllocationDonut,
  LazyWeeklyRevenueBars,
  ChartWrapper,
} from '@/components/charts';
import { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
import { getFinanceDateRange } from './utils/financeDateRange';
import { buildMoneyAllocation, calcLiquido, isMonthInRed } from './utils/financeMath';
import { fillWeeklySeries } from './utils/financeWeeks';
import {
  useRevenueReport,
  useCommissionReport,
  useNetResult,
} from '@/lib/query/hooks/useFinanceReports';
import { generateFinanceReportPDF } from './utils/generateReportPDF';
import { useAuth } from '@/context/AuthContext';
import { canManageClinicSettings } from '@/lib/auth/scope';

/**
 * Formata um valor em reais (BRL).
 */
const formatBRL = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Conteúdo do relatório financeiro — montado SÓ para quem passa no gate
 * (separado pra não disparar as queries financeiras pra staff).
 */
const FinanceReportContent: React.FC = () => {
  const [period, setPeriod] = useState<PeriodFilter>('this_month');

  const { start, end } = useMemo(() => getFinanceDateRange(period), [period]);

  const {
    data: revenue,
    isLoading: revenueLoading,
    isError: revenueError,
  } = useRevenueReport(start, end);
  const {
    data: commission,
    isLoading: commissionLoading,
    isError: commissionError,
  } = useCommissionReport(start, end);
  const {
    data: netResult,
    isLoading: netLoading,
    isError: netError,
  } = useNetResult(start, end);

  // MEDIUM-4: PDF/cascata só são confiáveis com as 3 fontes prontas. Qualquer
  // uma carregando ou em erro → não exporta (senão imprime R$0 silencioso) e
  // sinaliza o erro na tela (antes só o revenue avisava).
  const anyLoading = revenueLoading || commissionLoading || netLoading;
  const anyError = revenueError || commissionError || netError;

  const trendData = useMemo(
    () =>
      (revenue?.porMes || []).map((m) => ({
        month: m.mes,
        revenue: m.faturamento,
      })),
    [revenue?.porMes]
  );

  // LOW-9: série semanal contínua (semanas vazias = 0) rotulada por DATA da
  // semana ('25/05–31/05'), igual ao PDF — não por índice ("sem 1").
  const weeklySeries = useMemo(
    () => fillWeeklySeries(revenue?.porSemana ?? [], start, end),
    [revenue?.porSemana, start, end]
  );

  const weeklyData = useMemo(
    () =>
      weeklySeries.map((s) => ({
        semana: s.label,
        faturamento: s.faturamento,
        atendimentos: s.atendimentos,
      })),
    [weeklySeries]
  );

  const moneyAllocation = useMemo(
    () =>
      netResult
        ? buildMoneyAllocation(netResult)
        : [],
    [netResult]
  );

  // MEDIUM-7: mês no vermelho → aviso e % sobre as fatias visíveis (já no util).
  const mesNoVermelho = useMemo(
    () => (netResult ? isMonthInRed(netResult) : false),
    [netResult]
  );

  const handleExportPDF = useCallback(async () => {
    // Guarda dura: nunca exporta com dado parcial (R$0 silencioso).
    if (anyLoading || anyError || !netResult) return;

    const faturamento = netResult.faturamento;
    const taxas = netResult.taxas;
    const comissoes = netResult.comissoes;
    const contasFixas = netResult.contasFixas;
    // MEDIUM-4: o líquido do PDF é RECOMPUTADO dos MESMOS valores impressos
    // (cascata consistente) — não confia num campo que pode divergir.
    const liquido = calcLiquido(faturamento, comissoes, taxas, contasFixas);

    await generateFinanceReportPDF(
      {
        faturamento,
        taxas,
        comissoes,
        contasFixas,
        liquido,
        mesesPeriodo: netResult.mesesPeriodo,
        contasFixasMensal: netResult.contasFixasMensal,
        totalAtendimentos: revenue?.totalAtendimentos ?? 0,
        porMes: revenue?.porMes ?? [],
        porSemana: weeklySeries.map((s) => ({
          semana: s.label,
          faturamento: s.faturamento,
          atendimentos: s.atendimentos,
        })),
      },
      period
    );
  }, [anyLoading, anyError, netResult, revenue, weeklySeries, period]);

  return (
    <div className="flex flex-col space-y-4">
      {/* Header com Filtros */}
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Financeiro
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            O líquido REAL — depois de taxas, comissões e contas ·{' '}
            <span className="text-gold-700 dark:text-gold-500 font-medium">só você vê esta tela</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodFilterSelect value={period} onChange={setPeriod} />
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={anyLoading || anyError}
            className="group flex items-center gap-2 px-3 py-2 rounded-lg glass border border-slate-200/50 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            title={anyLoading ? 'Aguarde o relatório carregar' : anyError ? 'Corrija o erro antes de exportar' : 'Exportar PDF'}
          >
            <Download size={16} className="group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium opacity-80 group-hover:opacity-100">PDF</span>
          </button>
        </div>
      </div>

      {/* Estado de erro — MEDIUM-4: cobre as 3 fontes (taxas/comissões/líquido
          falhavam mudas; só o revenue avisava). */}
      {anyError ? (
        <div className="glass p-4 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5 shadow-sm shrink-0">
          <p className="text-sm text-red-600 dark:text-red-400">
            Não foi possível carregar
            {revenueError ? ' o faturamento' : ''}
            {commissionError ? `${revenueError ? ',' : ''} as comissões` : ''}
            {netError ? `${revenueError || commissionError ? ' e' : ''} o resultado líquido` : ''}
            . Os números podem estar incompletos — tente novamente (a exportação fica bloqueada até carregar).
          </p>
        </div>
      ) : null}

      {/* P&L do período: a cascata até o líquido (mockup) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 shrink-0">
        <StatCard
          title="Recebido bruto"
          value={revenueLoading ? '...' : formatBRL(netResult?.faturamento ?? revenue?.faturamento ?? 0)}
          subtext={`${revenue?.totalAtendimentos ?? 0} atendimentos pagos`}
          subtextPositive
          icon={DollarSign}
          color="bg-blue-500"
          comparisonLabel="só conta o que foi pago"
        />
        <StatCard
          title="Taxas de cartão"
          value={`- ${formatBRL(netResult?.taxas ?? 0)}`}
          subtext="por bandeira e parcela"
          subtextPositive={false}
          icon={CreditCard}
          color="bg-red-500"
          comparisonLabel="calculadas no registro"
        />
        <StatCard
          title="Comissões"
          value={`- ${formatBRL(netResult?.comissoes ?? commission?.totalComissao ?? 0)}`}
          subtext={`${commission?.porProfissional.length ?? 0} profissionais`}
          subtextPositive={false}
          icon={Users}
          color="bg-purple-500"
          comparisonLabel="detalhe em Profissionais"
        />
        <StatCard
          title="Contas fixas"
          value={`- ${formatBRL(netResult?.contasFixas ?? 0)}`}
          subtext="aluguel, folha, software…"
          subtextPositive={false}
          icon={Receipt}
          color="bg-orange-500"
          // HIGH-1: contas fixas são MENSAIS — pró-rateadas pelos meses do período.
          comparisonLabel={
            (netResult?.mesesPeriodo ?? 1) > 1
              ? `pró-rateadas por ${netResult?.mesesPeriodo} meses do período`
              : 'mensais ativas'
          }
        />
        <StatCard
          title="Líquido"
          value={formatBRL(netResult?.liquido ?? 0)}
          subtext="o que sobra de verdade"
          subtextPositive={(netResult?.liquido ?? 0) >= 0}
          icon={TrendingUp}
          color="bg-emerald-500"
          comparisonLabel="após deduções"
        />
      </div>

      {/* Recebido por semana + Pra onde vai o dinheiro (mockup) */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] gap-4 shrink-0">
        <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col min-h-[280px]">
          <div className="flex justify-between items-center mb-2 shrink-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Recebido por Semana
            </h2>
            <span className="text-xs text-slate-400">só conta o que foi PAGO</span>
          </div>
          <div className="flex-1 min-h-0 relative">
            {weeklyData.length > 0 ? (
              <div className="absolute inset-0">
                <ChartWrapper height="100%">
                  <LazyWeeklyRevenueBars data={weeklyData} />
                </ChartWrapper>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 py-6">
                <DollarSign size={32} className="mb-2 opacity-50" />
                <p className="text-sm">Nenhum recebimento no período.</p>
              </div>
            )}
          </div>
        </div>

        <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col min-h-[280px]">
          <div className="flex justify-between items-center mb-2 shrink-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Pra onde vai o dinheiro
            </h2>
            {mesNoVermelho ? (
              <span className="text-[10px] font-semibold text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-full px-2 py-0.5">
                mês no vermelho
              </span>
            ) : null}
          </div>
          {moneyAllocation.length > 0 ? (
            <>
              <div className="flex-1 min-h-[150px] relative">
                <div className="absolute inset-0">
                  <ChartWrapper height="100%">
                    <LazyMoneyAllocationDonut data={moneyAllocation} />
                  </ChartWrapper>
                </div>
              </div>
              <ul className="mt-3 space-y-1.5 text-xs shrink-0" aria-label="Legenda da alocação do dinheiro">
                {moneyAllocation.map((segment) => (
                  <li key={segment.key} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0"
                      style={{ backgroundColor: segment.color }}
                      aria-hidden="true"
                    />
                    <span className="flex-1">{segment.name}</span>
                    <span className="font-semibold">{segment.percent}%</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-slate-500 py-6">
              <TrendingUp size={32} className="mb-2 opacity-50" />
              <p className="text-sm">Sem faturamento pra alocar.</p>
            </div>
          )}
        </div>
      </div>

      {/* Faturamento por mês */}
      <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col min-h-[250px]">
        <div className="flex justify-between items-center mb-2 shrink-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Faturamento por Mês
          </h2>
        </div>
        <div className="flex-1 min-h-0 relative">
          {trendData.length > 0 ? (
            <div className="absolute inset-0">
              <ChartWrapper height="100%">
                <LazyRevenueTrendChart data={trendData} />
              </ChartWrapper>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 py-6">
              <DollarSign size={32} className="mb-2 opacity-50" />
              <p className="text-sm">Nenhum faturamento no período.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Página de relatório financeiro da clínica (F8).
 *
 * Tela EXCLUSIVA do admin (clinic_admin/agency_admin via canManageClinicSettings
 * — espelha o gate das abas financeiras do Settings/F5). clinic_staff (Vitória)
 * vê o aviso de acesso restrito e nenhuma query financeira é disparada; no
 * banco, o RPC ainda barra por can_configure_organization (defense-in-depth).
 */
const FinanceReportPage: React.FC = () => {
  const { profile } = useAuth();

  if (!canManageClinicSettings(profile?.role)) {
    return (
      <div className="glass p-8 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm max-w-xl mx-auto mt-10 text-center">
        <Lock size={32} className="mx-auto mb-3 text-slate-400" aria-hidden="true" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
          Acesso restrito
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
          O Financeiro é exclusivo do administrador da clínica.
        </p>
      </div>
    );
  }

  return <FinanceReportContent />;
};

export default FinanceReportPage;
