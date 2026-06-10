import { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';

export interface FinanceDateRangeISO {
  start: string;
  end: string;
}

/**
 * Converte um PeriodFilter em range ISO ({ start, end }) para os RPCs
 * financeiros (p_start / p_end). Reusa o mesmo enum PeriodFilter do dashboard,
 * mas devolve strings ISO (o getDateRange do dashboard é privado e retorna Date).
 *
 * Fronteiras calculadas no fuso LOCAL do navegador (a clínica opera em
 * America/Sao_Paulo); o agrupamento por mês/semana dentro do RPC também
 * converte pra esse fuso — pagamento 23h de terça não cai na quarta.
 *
 * @param period - Filtro de período selecionado na UI.
 * @param now - Data de referência (injetável p/ teste determinístico).
 * @returns Range em ISO 8601.
 */
export function getFinanceDateRange(
  period: PeriodFilter,
  now: Date = new Date()
): FinanceDateRangeISO {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1);

  let start: Date;
  let end: Date = endOfToday;

  switch (period) {
    case 'all':
      start = new Date(2000, 0, 1, 0, 0, 0, 0);
      break;

    case 'today':
      start = today;
      break;

    case 'yesterday':
      start = new Date(today);
      start.setDate(start.getDate() - 1);
      end = new Date(today.getTime() - 1);
      break;

    case 'last_7_days':
      start = new Date(now);
      start.setDate(start.getDate() - 7);
      break;

    case 'last_30_days':
      start = new Date(now);
      start.setDate(start.getDate() - 30);
      break;

    case 'this_month':
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;

    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;

    case 'this_quarter': {
      const quarterStart = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), quarterStart, 1, 0, 0, 0, 0);
      break;
    }

    case 'last_quarter': {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const lastQuarterStart = (currentQuarter - 1 + 4) % 4;
      const year = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
      start = new Date(year, lastQuarterStart * 3, 1, 0, 0, 0, 0);
      end = new Date(year, lastQuarterStart * 3 + 3, 0, 23, 59, 59, 999);
      break;
    }

    case 'this_year':
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      break;

    case 'last_year':
      start = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      break;

    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}
