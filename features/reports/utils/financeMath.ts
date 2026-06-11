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
  /** Percentual inteiro (0–100). A soma das fatias visíveis fecha 100% (MEDIUM-7). */
  percent: number;
  /** Cor hexadecimal da fatia (paleta brand/gold do mockup). */
  color: string;
}

/** Campos do NetResult que o donut consome (não exige o objeto inteiro). */
type MoneyAllocationInput = Pick<
  NetResult,
  'faturamento' | 'liquido' | 'contasFixas' | 'comissoes' | 'taxas'
>;

/**
 * Mês "no vermelho": líquido negativo. O donut não representa prejuízo como
 * fatia; nesse caso os percentuais são sobre a soma das fatias VISÍVEIS e a UI
 * mostra um aviso. (MEDIUM-7)
 *
 * @param net - Resultado líquido do período.
 * @returns true se o líquido é negativo.
 */
export function isMonthInRed(net: Pick<NetResult, 'liquido'>): boolean {
  return Number.isFinite(net.liquido) && net.liquido < 0;
}

/**
 * Converte o NetResult no breakdown do donut "pra onde vai o dinheiro".
 *
 * Cores espelham o mockup aprovado: sobra = gold-500, contas = brand-600,
 * comissões = brand-300, taxas = rose-300. Sobra negativa vira fatia zero
 * (donut não representa prejuízo — o card Líquido mostra o negativo).
 *
 * MEDIUM-7: os percentuais usam o método do maior resto (largest remainder)
 * para somarem EXATAMENTE 100% (antes, arredondamento independente dava
 * 99%/101%). A base é o faturamento quando o líquido ≥ 0; quando o mês está no
 * vermelho (sem fatia "sobra"), a base é a soma das fatias visíveis.
 *
 * @param net - Resultado líquido do período (RPC get_net_result).
 * @returns Fatias ordenadas (sobra → contas → comissões → taxas); vazio se faturamento = 0.
 */
export function buildMoneyAllocation(net: MoneyAllocationInput): MoneyAllocationSegment[] {
  const faturamento = Number.isFinite(net.faturamento) ? net.faturamento : 0;
  if (faturamento <= 0) return [];

  const safe = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

  const base = [
    { key: 'liquido' as const, name: 'Sobra (líquido)', value: safe(net.liquido), color: '#b0883f' },
    { key: 'contas' as const, name: 'Contas fixas', value: safe(net.contasFixas), color: '#0e7d69' },
    { key: 'comissoes' as const, name: 'Comissões', value: safe(net.comissoes), color: '#5fd0b6' },
    { key: 'taxas' as const, name: 'Taxas de cartão', value: safe(net.taxas), color: '#fda4af' },
  ];

  // Denominador dos percentuais: faturamento se há sobra; senão a soma das
  // fatias visíveis (mês no vermelho não tem fatia "sobra" pra fechar 100%).
  const visibleSum = base.reduce((acc, s) => acc + s.value, 0);
  const denom = isMonthInRed(net) ? visibleSum : faturamento;

  return withLargestRemainder(base, denom);
}

/**
 * Atribui percentuais inteiros que somam 100% (maior resto). Fatias com valor
 * zero ficam 0%; o resto é distribuído de forma que o total feche exatamente
 * 100% — desde que haja ao menos uma fatia > 0 e o denominador > 0.
 */
function withLargestRemainder<T extends { value: number }>(
  items: T[],
  denom: number
): (T & { percent: number })[] {
  if (denom <= 0) return items.map((s) => ({ ...s, percent: 0 }));

  const raw = items.map((s) => (s.value > 0 ? (s.value / denom) * 100 : 0));
  const floors = raw.map((p) => Math.floor(p));
  const totalFloor = floors.reduce((a, b) => a + b, 0);

  // Quanto falta pra 100 (limitado ao nº de fatias com resto), distribuído
  // pras fatias com maior parte fracionária.
  let remaining = Math.min(Math.max(100 - totalFloor, 0), items.length);
  const order = raw
    .map((p, i) => ({ i, frac: p - Math.floor(p) }))
    .filter((x) => x.frac > 0)
    .sort((a, b) => b.frac - a.frac);

  const percents = [...floors];
  for (const { i } of order) {
    if (remaining <= 0) break;
    percents[i] += 1;
    remaining -= 1;
  }

  return items.map((s, i) => ({ ...s, percent: percents[i] }));
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
