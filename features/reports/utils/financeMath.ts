/**
 * @fileoverview Matemática financeira PURA dos relatórios (F8).
 *
 * Sem I/O — testável e reutilizável fora dos RPCs SQL (ex.: recomputar no
 * client a partir do breakdown, montar o donut "pra onde vai o dinheiro").
 */
import type { NetResult } from '@/types';

/**
 * Cálculo puro do resultado líquido financeiro da clínica.
 *
 * Líquido = faturamento − comissões − taxas de cartão − contas fixas.
 *
 * @param faturamento - Total recebido no período (atendimentos pagos, valor − desconto).
 * @param comissoes - Total de comissões dos profissionais no período.
 * @param taxas - Total de taxas de cartão aplicadas no período.
 * @param contas - Total de contas/custos fixos ativos.
 * @returns Resultado líquido (pode ser negativo).
 */
export function calcLiquido(
  faturamento: number,
  comissoes: number,
  taxas: number,
  contas: number
): number {
  const f = Number.isFinite(faturamento) ? faturamento : 0;
  const co = Number.isFinite(comissoes) ? comissoes : 0;
  const t = Number.isFinite(taxas) ? taxas : 0;
  const ct = Number.isFinite(contas) ? contas : 0;
  return f - co - t - ct;
}

/** Fatia do donut "pra onde vai o dinheiro" (mockup Financeiro). */
export interface MoneyAllocationSegment {
  key: 'liquido' | 'contas' | 'comissoes' | 'taxas';
  /** Rótulo humano da fatia. */
  name: string;
  /** Valor em R$ da fatia (nunca negativo). */
  value: number;
  /** Percentual (0–100, arredondado) sobre o faturamento. */
  percent: number;
  /** Cor hexadecimal da fatia (paleta brand/gold do mockup). */
  color: string;
}

/**
 * Converte o NetResult no breakdown do donut "pra onde vai o dinheiro".
 *
 * Cores espelham o mockup aprovado: sobra = gold-500, contas = brand-600,
 * comissões = brand-300, taxas = rose-300. Sobra negativa vira fatia zero
 * (donut não representa prejuízo — o card Líquido mostra o negativo).
 *
 * @param net - Resultado líquido do período (RPC get_net_result).
 * @returns Fatias ordenadas (sobra → contas → comissões → taxas); vazio se faturamento = 0.
 */
export function buildMoneyAllocation(net: NetResult): MoneyAllocationSegment[] {
  const faturamento = Number.isFinite(net.faturamento) ? net.faturamento : 0;
  if (faturamento <= 0) return [];

  const pct = (value: number) => Math.round((value / faturamento) * 100);
  const safe = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

  return [
    { key: 'liquido' as const, name: 'Sobra (líquido)', value: safe(net.liquido), color: '#b0883f' },
    { key: 'contas' as const, name: 'Contas fixas', value: safe(net.contasFixas), color: '#0e7d69' },
    { key: 'comissoes' as const, name: 'Comissões', value: safe(net.comissoes), color: '#5fd0b6' },
    { key: 'taxas' as const, name: 'Taxas de cartão', value: safe(net.taxas), color: '#fda4af' },
  ].map((s) => ({ ...s, percent: pct(s.value) }));
}

/**
 * Período YYYY-MM (hora local) de uma data ISO — usado pelo "pagar" de
 * comissão (commission_payments.period tem CHECK ^\d{4}-(0[1-9]|1[0-2])$).
 *
 * @param iso - Data em ISO 8601 (ex.: fim do range do PeriodFilter).
 * @returns Período no formato 'YYYY-MM'.
 */
export function periodFromISO(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${month}`;
}

/**
 * O range cobre UM único mês de competência? (MEDIUM-5)
 *
 * A ação "pagar" comissão grava `period = mês do fim do range` e a "a pagar" é
 * calculada sobre o range inteiro. Se o range cruzar meses, o valor pago não
 * corresponde a um único período — o que, somado à unique parcial no banco
 * (org, profissional, period), gera erro/inconsistência. Pagar só faz sentido
 * mês a mês; esta checagem (início e fim no MESMO YYYY-MM local) trava a UI.
 *
 * @param startISO - Início do range.
 * @param endISO - Fim do range.
 * @returns true se início e fim caem no mesmo mês de competência.
 */
export function isSingleCompetenceMonth(startISO: string, endISO: string): boolean {
  return periodFromISO(startISO) === periodFromISO(endISO);
}
