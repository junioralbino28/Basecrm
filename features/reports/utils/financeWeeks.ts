/**
 * @fileoverview Série semanal do relatório financeiro (rótulos e preenchimento).
 *
 * O RPC get_revenue_report devolve `porSemana` com `semana` = início da semana
 * ('YYYY-MM-DD', segunda-feira no fuso da clínica) só para semanas COM
 * recebimento. Rotular as barras por índice ('sem 1', 'sem 2'…) é frágil:
 * semanas vazias somem e deslocam os rótulos, e o PDF rotulava diferente da tela
 * (achado MEDIUM/LOW-9). Aqui rotulamos pela DATA da semana ('25/05–31/05') —
 * igual no chart e no PDF — e preenchemos as semanas vazias do range com 0.
 */
import type { RevenueReportWeek } from '@/types';

/** Semana já com rótulo de data pronto pra barra/PDF. */
export interface WeeklyPoint {
  /** Início da semana 'YYYY-MM-DD' (chave estável). */
  semana: string;
  /** Rótulo '25/05–31/05' (início–fim da semana). */
  label: string;
  faturamento: number;
  atendimentos: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** dd/MM de uma data 'YYYY-MM-DD' (interpretada como data local, sem fuso). */
function ddmm(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return isoDate;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/**
 * Rótulo de uma semana a partir do seu início: '25/05–31/05' (início + 6 dias).
 *
 * @param weekStart - Início da semana em 'YYYY-MM-DD'.
 * @returns Rótulo 'dd/MM–dd/MM'.
 */
export function weekRangeLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return weekStart;
  const start = new Date(y, m - 1, d);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return `${ddmm(weekStart)}–${ddmm(endISO)}`;
}

/** Início da semana (segunda-feira) de uma data local 'YYYY-MM-DD'. */
function mondayOf(date: Date): Date {
  const day = date.getDay(); // 0=domingo … 6=sábado
  const diff = (day + 6) % 7; // dias desde a segunda
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - diff);
  return monday;
}

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Preenche as semanas vazias do range com 0 e rotula todas por data.
 *
 * Percorre da segunda-feira da semana de `startISO` até cobrir `endISO`,
 * casando cada semana com o `porSemana` do RPC (chave = início 'YYYY-MM-DD').
 * Semanas sem recebimento entram com faturamento/atendimentos = 0 — assim os
 * rótulos não deslocam e o chart bate com o PDF. Limita a um teto defensivo
 * (104 semanas ≈ 2 anos) pra ranges enormes ("todo o período").
 *
 * @param porSemana - Semanas com recebimento (RPC).
 * @param startISO - Início do range (ISO 8601).
 * @param endISO - Fim do range (ISO 8601).
 * @returns Série semanal contínua, ordenada por data.
 */
export function fillWeeklySeries(
  porSemana: RevenueReportWeek[],
  startISO: string,
  endISO: string
): WeeklyPoint[] {
  const byWeek = new Map(porSemana.map((s) => [s.semana, s]));

  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    // Sem range válido: devolve só o que veio do RPC, já rotulado.
    return porSemana
      .slice()
      .sort((a, b) => a.semana.localeCompare(b.semana))
      .map((s) => ({
        semana: s.semana,
        label: weekRangeLabel(s.semana),
        faturamento: s.faturamento,
        atendimentos: s.atendimentos,
      }));
  }

  const MAX_WEEKS = 104;
  const out: WeeklyPoint[] = [];
  let cursor = mondayOf(start);
  const endMonday = mondayOf(end);

  for (let i = 0; i <= MAX_WEEKS; i++) {
    if (cursor > endMonday) break;
    const key = toISODate(cursor);
    const hit = byWeek.get(key);
    out.push({
      semana: key,
      label: weekRangeLabel(key),
      faturamento: hit ? hit.faturamento : 0,
      atendimentos: hit ? hit.atendimentos : 0,
    });
    cursor = new Date(cursor.getTime() + 7 * DAY_MS);
  }

  return out;
}
