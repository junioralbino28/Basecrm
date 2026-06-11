import { describe, it, expect } from 'vitest';
import { weekRangeLabel, fillWeeklySeries } from './financeWeeks';

describe('weekRangeLabel (rótulo por data — LOW-9)', () => {
  it('formata início + 6 dias como dd/MM–dd/MM', () => {
    // 2026-05-25 (segunda) → 25/05–31/05.
    expect(weekRangeLabel('2026-05-25')).toBe('25/05–31/05');
  });

  it('atravessa a virada de mês corretamente', () => {
    // 2026-06-29 (segunda) + 6 = 2026-07-05.
    expect(weekRangeLabel('2026-06-29')).toBe('29/06–05/07');
  });
});

describe('fillWeeklySeries (preenche semanas vazias com 0 — LOW-9)', () => {
  it('insere semanas sem recebimento com 0 e mantém os rótulos por data', () => {
    // Range de junho/2026; o RPC só trouxe a 2ª e a 4ª semana.
    const porSemana = [
      { semana: '2026-06-08', faturamento: 900, atendimentos: 2 },
      { semana: '2026-06-22', faturamento: 500, atendimentos: 1 },
    ];
    const series = fillWeeklySeries(
      porSemana,
      new Date(2026, 5, 1, 0, 0, 0).toISOString(),
      new Date(2026, 5, 30, 23, 59, 59).toISOString()
    );

    // Semanas contínuas (segundas de junho/2026): 01, 08, 15, 22, 29.
    expect(series.map((s) => s.semana)).toEqual([
      '2026-06-01',
      '2026-06-08',
      '2026-06-15',
      '2026-06-22',
      '2026-06-29',
    ]);
    // As que vieram do RPC mantêm o valor; as vazias entram com 0.
    expect(series.find((s) => s.semana === '2026-06-08')!.faturamento).toBe(900);
    expect(series.find((s) => s.semana === '2026-06-15')!.faturamento).toBe(0);
    expect(series.find((s) => s.semana === '2026-06-15')!.atendimentos).toBe(0);
    // Rótulo por data, não por índice.
    expect(series.find((s) => s.semana === '2026-06-22')!.label).toBe('22/06–28/06');
  });

  it('range inválido devolve só o que veio do RPC, já rotulado', () => {
    const porSemana = [{ semana: '2026-06-08', faturamento: 100, atendimentos: 1 }];
    const series = fillWeeklySeries(porSemana, 'invalid', 'invalid');
    expect(series).toHaveLength(1);
    expect(series[0].label).toBe('08/06–14/06');
  });
});
