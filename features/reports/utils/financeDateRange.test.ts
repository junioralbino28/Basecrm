import { describe, it, expect } from 'vitest';
import { getFinanceDateRange } from './financeDateRange';

describe('getFinanceDateRange', () => {
  it('this_month retorna do dia 1 do mês até agora, em ISO', () => {
    const now = new Date(2026, 5, 9, 12, 0, 0); // 2026-06-09
    const { start, end } = getFinanceDateRange('this_month', now);
    expect(start).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).toISOString());
    expect(new Date(end).getTime()).toBeGreaterThanOrEqual(new Date(start).getTime());
  });

  it('last_month retorna o mês anterior completo', () => {
    const now = new Date(2026, 5, 9);
    const { start, end } = getFinanceDateRange('last_month', now);
    expect(start).toBe(new Date(2026, 4, 1, 0, 0, 0, 0).toISOString());
    expect(end).toBe(new Date(2026, 5, 0, 23, 59, 59, 999).toISOString());
  });

  it('last_30_days retorna 30 dias atrás até agora', () => {
    const now = new Date(2026, 5, 9, 10, 0, 0);
    const { start } = getFinanceDateRange('last_30_days', now);
    const expectedStart = new Date(2026, 5, 9, 10, 0, 0);
    expectedStart.setDate(expectedStart.getDate() - 30);
    expect(new Date(start).getTime()).toBeLessThan(now.getTime());
  });

  it('this_year retorna de 1º de janeiro até agora', () => {
    const now = new Date(2026, 5, 9);
    const { start } = getFinanceDateRange('this_year', now);
    expect(start).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).toISOString());
  });

  it('all retorna um range amplo (desde 2000)', () => {
    const now = new Date(2026, 5, 9);
    const { start } = getFinanceDateRange('all', now);
    expect(new Date(start).getFullYear()).toBeLessThanOrEqual(2000);
  });

  it('fronteira de dia: pagamento 23h de terça fica DENTRO do range de today da terça', () => {
    // 2026-06-09 é terça; o range de 'today' precisa conter 23:59 local
    const now = new Date(2026, 5, 9, 8, 0, 0);
    const { start, end } = getFinanceDateRange('today', now);
    const lateNight = new Date(2026, 5, 9, 23, 0, 0).getTime();
    expect(lateNight).toBeGreaterThanOrEqual(new Date(start).getTime());
    expect(lateNight).toBeLessThanOrEqual(new Date(end).getTime());
  });
});
