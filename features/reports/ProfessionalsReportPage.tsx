'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Stethoscope, Check, Undo2, X } from 'lucide-react';
import { AccessDenied } from '@/components/AccessDenied';
import PageLoader from '@/components/PageLoader';
import { PeriodFilterSelect } from '@/components/filters/PeriodFilterSelect';
import { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
import { getFinanceDateRange } from './utils/financeDateRange';
import { periodFromISO, isSingleCompetenceMonth } from './utils/financeMath';
import { useCommissionReport } from '@/lib/query/hooks/useFinanceReports';
import {
  useCreateCommissionPayment,
  useCommissionPaymentsByPeriod,
  useDeleteCommissionPayment,
  useUpdateCommissionPaymentDate,
} from '@/lib/query/hooks/useCommissionPaymentsQuery';
import { useToast } from '@/context/ToastContext';
import { useHasPermission } from '@/lib/auth/useHasPermission';
import { mascararMoedaBR, paraNumeroBR, paraCampoMoedaBR } from '@/lib/utils/moedaBR';

/**
 * Formata um valor em reais (BRL).
 */
const formatBRL = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** 'YYYY-MM-DD' pro campo de data (hora local, sem escorregar um dia). */
const paraCampoData = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
};

/**
 * 'YYYY-MM-DD' → ISO ao MEIO-DIA local. Meia-noite escorrega de dia quando o
 * fuso vira, e o pagamento apareceria no dia anterior.
 */
const doCampoData = (valor: string): string => {
  const [ano, mes, dia] = valor.split('-').map(Number);
  if (!ano || !mes || !dia) return '';
  return new Date(ano, mes - 1, dia, 12, 0, 0).toISOString();
};

/** Data curta do pagamento (dd/mm) — o ano já está no período da tela. */
const formatDiaMes = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

/**
 * Conteúdo do relatório de profissionais — montado SÓ para quem passa no gate
 * (staff nem dispara a query de comissão).
 */
export const ProfessionalsCommissionTable: React.FC<{
  /** Quando vem de fora (Financeiro), o período é o da tela hospedeira. */
  period?: PeriodFilter;
  /** Some o cabeçalho e o seletor — quem hospeda já tem os dois. */
  embutido?: boolean;
}> = ({ period: periodoExterno, embutido }) => {
  const { addToast } = useToast();
  const [periodoLocal, setPeriodoLocal] = useState<PeriodFilter>('this_month');
  const period = periodoExterno ?? periodoLocal;
  const setPeriod = setPeriodoLocal;
  const [payingId, setPayingId] = useState<string | null>(null);
  // Pedido do Junior (27/07): escolher QUANTO está pagando (pagamento parcial)
  // e desfazer um lançamento errado.
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [dataPagamento, setDataPagamento] = useState('');

  const { start, end } = useMemo(() => getFinanceDateRange(period), [period]);
  const { data: report, isLoading, isError, isFetching } = useCommissionReport(start, end);
  const createPayment = useCreateCommissionPayment();
  const deletePayment = useDeleteCommissionPayment();
  const updateDate = useUpdateCommissionPaymentDate();
  const competencia = useMemo(
    () => (isSingleCompetenceMonth(start, end) ? periodFromISO(end) : ''),
    [start, end],
  );
  const { data: pagamentos } = useCommissionPaymentsByPeriod(competencia);

  const rows = report?.porProfissional ?? [];

  // MEDIUM-5: "pagar" só faz sentido num único mês de competência. Se o range
  // cruza meses (ano, trimestre, "30 dias"), travamos a ação — o pagamento
  // grava period = mês do fim e a unique (org, prof, period) no banco rejeitaria
  // dupla gravação. Pagar mês a mês (selecionar "este mês"/"mês passado").
  const pagavel = useMemo(() => isSingleCompetenceMonth(start, end), [start, end]);

  /** Pagamentos da pessoa no mês, do mais recente pro mais antigo. */
  const pagamentosDaPessoa = useCallback(
    (professionalId: string) => (pagamentos ?? [])
      .filter((p) => p.professionalId === professionalId)
      .sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || '')),
    [pagamentos],
  );

  /** Último pagamento lançado pra essa pessoa no mês — é o que o desfazer apaga. */
  const ultimoPagamento = useCallback(
    (professionalId: string) => pagamentosDaPessoa(professionalId)[0] || null,
    [pagamentosDaPessoa],
  );

  const abrirPagamento = (professionalId: string, aPagar: number) => {
    setAbertoId(professionalId);
    // Já vem preenchido com o total: quem paga tudo só confirma.
    setValor(paraCampoMoedaBR(aPagar));
    setDataPagamento(paraCampoData(new Date().toISOString()));
  };

  /** Corrige a data de um lançamento (pagamento antigo, lançado fora do dia). */
  const corrigirData = async (id: string, valorCampo: string) => {
    const iso = doCampoData(valorCampo);
    if (!iso) return;
    try {
      await updateDate.mutateAsync({ id, paidAt: iso });
      addToast('Data do pagamento corrigida.', 'success');
    } catch (e) {
      addToast(`Não foi possível corrigir a data: ${(e as Error)?.message || 'erro'}`, 'error');
    }
  };

  const handleDesfazer = useCallback(
    async (professionalId: string, professionalName: string) => {
      const alvo = ultimoPagamento(professionalId);
      if (!alvo) return;
      const ok = window.confirm(
        `Desfazer o último pagamento de ${professionalName}, de ${formatBRL(alvo.amount)}? `
        + 'O valor volta para "a pagar".',
      );
      if (!ok) return;
      try {
        await deletePayment.mutateAsync(alvo.id);
        addToast(`Pagamento de ${formatBRL(alvo.amount)} desfeito.`, 'success');
      } catch (e) {
        addToast(`Não foi possível desfazer: ${(e as Error)?.message || 'erro inesperado'}`, 'error');
      }
    },
    [ultimoPagamento, deletePayment, addToast],
  );

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
          // A data é escolhida na tela: dá pra lançar pagamento de outro dia.
          paidAt: dataPagamento ? doCampoData(dataPagamento) : undefined,
        });
        addToast(`${formatBRL(amount)} marcado como pago a ${professionalName}.`, 'success');
        setAbertoId(null);
      } catch (e) {
        const message = (e as Error)?.message || '';
        // A trava de "um pagamento por mês" caiu junto com o pagamento parcial
        // (migration 20260727020000) — várias linhas no mesmo mês são esperadas.
        addToast(
          `Não foi possível registrar o pagamento: ${message || 'erro inesperado'}`,
          'error'
        );
      } finally {
        setPayingId(null);
      }
    },
    [createPayment, end, addToast, pagavel, dataPagamento]
  );

  return (
    <div className="flex flex-col space-y-4">
      {/* Header com Filtros — no Financeiro quem manda é o filtro de lá */}
      {embutido ? (
        <div className="shrink-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Comissão por profissional
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
            Quem produziu o quê — e quanto falta pagar a cada um.
          </p>
        </div>
      ) : (
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
      )}

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
                  <td className="px-3 py-3.5 text-right text-emerald-600 dark:text-emerald-400 align-top">
                    {row.pago > 0 ? (
                      <span className="inline-flex flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-2">
                        {formatBRL(row.pago)}
                        {ultimoPagamento(row.professionalId) ? (
                          <button
                            type="button"
                            onClick={() => void handleDesfazer(row.professionalId, row.professionalName)}
                            disabled={isFetching || deletePayment.isPending}
                            title="Desfazer o último pagamento lançado"
                            aria-label={`Desfazer último pagamento de ${row.professionalName}`}
                            className="h-6 w-6 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 text-slate-400 hover:text-red-600 hover:border-red-200 disabled:opacity-50 transition"
                          >
                            <Undo2 size={12} aria-hidden="true" />
                          </button>
                        ) : null}
                      </span>
                      {/* Quando foi pago cada parcela (Junior, 27/07). Um só
                          pagamento vira uma linha; parcelado vira a lista. */}
                      {pagamentosDaPessoa(row.professionalId).length > 0 ? (
                        <span className="flex flex-col items-end gap-0.5 text-[10px] font-normal text-slate-400 dark:text-slate-500 tabular-nums">
                          {pagamentosDaPessoa(row.professionalId).map((pg) => (
                            <span key={pg.id} className="inline-flex items-center gap-1">
                              {formatBRL(pg.amount)} ·
                              <input
                                type="date"
                                aria-label={`Data do pagamento de ${formatBRL(pg.amount)} a ${row.professionalName}`}
                                value={paraCampoData(pg.paidAt)}
                                onChange={(e) => void corrigirData(pg.id, e.target.value)}
                                disabled={updateDate.isPending}
                                className="bg-transparent border border-transparent hover:border-slate-300 dark:hover:border-white/20 rounded px-1 py-0 text-[10px] text-slate-400 dark:text-slate-500 focus:outline-none focus:border-brand-400 disabled:opacity-50"
                              />
                            </span>
                          ))}
                        </span>
                      ) : null}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {row.comissao <= 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : row.aPagar > 0 ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="font-semibold text-gold-700 dark:text-gold-500">
                          {formatBRL(row.aPagar)}
                        </span>
                        {abertoId === row.professionalId ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              type="date"
                              aria-label={`Data do pagamento a ${row.professionalName}`}
                              value={dataPagamento}
                              onChange={(e) => setDataPagamento(e.target.value)}
                              className="h-7 px-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-card text-[11px] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                            />
                            <input
                              aria-label={`Valor a pagar a ${row.professionalName}`}
                              value={valor}
                              onChange={(e) => setValor(mascararMoedaBR(e.target.value))}
                              inputMode="decimal"
                              autoFocus
                              className="w-24 h-7 px-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-card text-right text-[12px] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                            />
                            <button
                              type="button"
                              disabled={isFetching || payingId === row.professionalId}
                              onClick={() => {
                                const n = paraNumeroBR(valor);
                                if (!Number.isFinite(n) || n <= 0) {
                                  addToast('Digite um valor maior que zero.', 'error');
                                  return;
                                }
                                if (n > row.aPagar) {
                                  addToast(
                                    `O máximo em aberto é ${formatBRL(row.aPagar)}.`,
                                    'error',
                                  );
                                  return;
                                }
                                void handlePagar(row.professionalId, row.professionalName, n);
                              }}
                              className="h-7 px-2.5 rounded-lg border border-brand-200 bg-brand-50 text-[11px] font-bold text-brand-700 hover:bg-brand-100 disabled:opacity-50 transition"
                            >
                              {payingId === row.professionalId ? 'pagando...' : 'confirmar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setAbertoId(null)}
                              aria-label="Cancelar pagamento"
                              className="h-7 w-7 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-600 transition"
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            // MEDIUM-5: desabilita fora de mês único e enquanto o
                            // relatório refaz fetch (evita clique antes do "a
                            // pagar" recalcular).
                            disabled={!pagavel || isFetching}
                            title={!pagavel ? 'Selecione um único mês para pagar' : undefined}
                            onClick={() => abrirPagamento(row.professionalId, row.aPagar)}
                            className="h-7 px-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 disabled:opacity-50 disabled:cursor-not-allowed transition"
                          >
                            pagar
                          </button>
                        )}
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

  return <ProfessionalsCommissionTable />;
};

export default ProfessionalsReportPage;
