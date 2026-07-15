'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Stethoscope, Check } from 'lucide-react';
import { AccessDenied } from '@/components/AccessDenied';
import PageLoader from '@/components/PageLoader';
import { PeriodFilterSelect } from '@/components/filters/PeriodFilterSelect';
import { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
import { getFinanceDateRange } from './utils/financeDateRange';
import { periodFromISO, isSingleCompetenceMonth } from './utils/financeMath';
import { useCommissionReport } from '@/lib/query/hooks/useFinanceReports';
import { useCreateCommissionPayment } from '@/lib/query/hooks/useCommissionPaymentsQuery';
import { useToast } from '@/context/ToastContext';
import { useHasPermission } from '@/lib/auth/useHasPermission';

/**
 * Formata um valor em reais (BRL).
 */
const formatBRL = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Conteúdo do relatório de profissionais — montado SÓ para quem passa no gate
 * (staff nem dispara a query de comissão).
 */
const ProfessionalsReportContent: React.FC = () => {
  const { addToast } = useToast();
  const [period, setPeriod] = useState<PeriodFilter>('this_month');
  const [payingId, setPayingId] = useState<string | null>(null);

  const { start, end } = useMemo(() => getFinanceDateRange(period), [period]);
  const { data: report, isLoading, isError, isFetching } = useCommissionReport(start, end);
  const createPayment = useCreateCommissionPayment();

  const rows = report?.porProfissional ?? [];

  // MEDIUM-5: "pagar" só faz sentido num único mês de competência. Se o range
  // cruza meses (ano, trimestre, "30 dias"), travamos a ação — o pagamento
  // grava period = mês do fim e a unique (org, prof, period) no banco rejeitaria
  // dupla gravação. Pagar mês a mês (selecionar "este mês"/"mês passado").
  const pagavel = useMemo(() => isSingleCompetenceMonth(start, end), [start, end]);

  const handlePagar = useCallback(
    async (professionalId: string, professionalName: string, amount: number) => {
      // Guarda extra (além do disabled): nunca paga em range multi-mês.
      if (!pagavel) {
        addToast(
          'Selecione um único mês (este mês / mês passado) para registrar o pagamento.',
          'error'
        );
        return;
      }
      setPayingId(professionalId);
      try {
        await createPayment.mutateAsync({
          professionalId,
          amount,
          // competência do pagamento = mês do fim do range selecionado
          period: periodFromISO(end),
        });
        addToast(`${formatBRL(amount)} marcado como pago a ${professionalName}.`, 'success');
      } catch (e) {
        const message = (e as Error)?.message || '';
        // Unique parcial (org, prof, period): pagamento já existe nesse mês.
        const jaPago =
          (e as { code?: string })?.code === '23505' ||
          /duplicate key|already exists|uniq_commission_payments/i.test(message);
        addToast(
          jaPago
            ? `${professionalName} já tem um pagamento registrado neste mês.`
            : `Não foi possível registrar o pagamento: ${message || 'erro inesperado'}`,
          'error'
        );
      } finally {
        setPayingId(null);
      }
    },
    [createPayment, end, addToast, pagavel]
  );

  return (
    <div className="flex flex-col space-y-4">
      {/* Header com Filtros */}
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Profissionais
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Quem produziu o quê — e a comissão de cada um.
          </p>
        </div>
        <PeriodFilterSelect value={period} onChange={setPeriod} />
      </div>

      {/* Estado de erro */}
      {isError ? (
        <div className="glass p-4 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5 shadow-sm shrink-0">
          <p className="text-sm text-red-600 dark:text-red-400">
            Não foi possível carregar o relatório de comissões. Tente novamente.
          </p>
        </div>
      ) : null}

      {/* MEDIUM-5: aviso quando o período cobre mais de um mês — pagar fica travado */}
      {!pagavel ? (
        <div className="glass p-3 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 shadow-sm shrink-0">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            O período selecionado cobre mais de um mês. Para registrar pagamentos, escolha
            <span className="font-semibold"> este mês</span> ou
            <span className="font-semibold"> mês passado</span> — comissão se paga mês a mês.
          </p>
        </div>
      ) : null}

      {/* Tabela paga vs a pagar (mockup) */}
      <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
            <tr>
              <th scope="col" className="text-left font-semibold px-5 py-3">Dentista</th>
              <th scope="col" className="text-right font-semibold px-3 py-3">Atendimentos</th>
              <th scope="col" className="text-right font-semibold px-3 py-3">Receita</th>
              <th scope="col" className="text-right font-semibold px-3 py-3">Comissão</th>
              <th scope="col" className="text-right font-semibold px-3 py-3">Paga</th>
              <th scope="col" className="text-right font-semibold px-5 py-3">A pagar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                  Carregando comissões...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                  <Stethoscope size={28} className="mx-auto mb-2 opacity-50" aria-hidden="true" />
                  Nenhum atendimento pago no período.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.professionalId} className="hover:bg-slate-50/60 dark:hover:bg-white/5 transition">
                  <td className="px-5 py-3.5 font-medium text-slate-900 dark:text-white">
                    {row.professionalName}
                  </td>
                  <td className="px-3 py-3.5 text-right text-slate-600 dark:text-slate-300">
                    {row.atendimentos}
                  </td>
                  <td className="px-3 py-3.5 text-right font-semibold text-slate-900 dark:text-white">
                    {formatBRL(row.faturamentoBase)}
                  </td>
                  <td className="px-3 py-3.5 text-right text-slate-600 dark:text-slate-300">
                    {row.comissao > 0 ? formatBRL(row.comissao) : '—'}
                  </td>
                  <td className="px-3 py-3.5 text-right text-emerald-600 dark:text-emerald-400">
                    {row.pago > 0 ? formatBRL(row.pago) : '—'}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {row.comissao <= 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : row.aPagar > 0 ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="font-semibold text-gold-700 dark:text-gold-500">
                          {formatBRL(row.aPagar)}
                        </span>
                        <button
                          type="button"
                          // MEDIUM-5: desabilita fora de mês único, durante o
                          // pagamento e enquanto o relatório refaz fetch (evita
                          // clique duplo antes do "a pagar" recalcular).
                          disabled={!pagavel || isFetching || payingId === row.professionalId}
                          title={!pagavel ? 'Selecione um único mês para pagar' : undefined}
                          onClick={() => handlePagar(row.professionalId, row.professionalName, row.aPagar)}
                          className="h-7 px-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        >
                          {payingId === row.professionalId ? 'pagando...' : 'pagar'}
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded-full px-2 py-0.5">
                        <Check size={12} aria-hidden="true" />
                        quitado
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-white/5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-200 dark:border-white/5">
          A comissão entra sozinha: a recepção registra o atendimento com o dentista e o procedimento →
          o sistema acha a regra certa e soma aqui e no Financeiro.
        </div>
      </div>
    </div>
  );
};

/**
 * Página Profissionais (F8/adendo — "Paga/A pagar" com ação "pagar").
 *
 * Tela EXCLUSIVA do admin (canManageClinicSettings — espelha o gate F5).
 * No banco, RPC (can_configure) + RLS de commission_payments barram staff.
 */
const ProfessionalsReportPage: React.FC = () => {
  const canViewProfessionals = useHasPermission('reports.professionals');

  if (canViewProfessionals === undefined) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <PageLoader />
      </div>
    );
  }

  if (!canViewProfessionals) {
    return (
      <AccessDenied message="Você não tem permissão para acessar o relatório por profissional." />
    );
  }

  return <ProfessionalsReportContent />;
};

export default ProfessionalsReportPage;
