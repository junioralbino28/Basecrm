import { describe, it, expect } from 'vitest';
import {
  calcLiquido,
  buildMoneyAllocation,
  periodFromISO,
  isSingleCompetenceMonth,
  isMonthInRed,
} from './financeMath';

describe('calcLiquido', () => {
  it('subtrai comissões, taxas e contas do faturamento', () => {
    expect(calcLiquido(10000, 2000, 300, 1500)).toBe(6200);
  });

  it('retorna o próprio faturamento quando não há deduções', () => {
    expect(calcLiquido(5000, 0, 0, 0)).toBe(5000);
  });

  it('pode ficar negativo quando as despesas superam o faturamento', () => {
    expect(calcLiquido(1000, 500, 100, 800)).toBe(-400);
  });

  it('trata valores indefinidos/NaN como zero', () => {
    // @ts-expect-error testando robustez com entradas inválidas
    expect(calcLiquido(10000, undefined, NaN, null)).toBe(10000);
  });
});

describe('buildMoneyAllocation (donut "pra onde vai o dinheiro")', () => {
  it('divide o faturamento em sobra, contas, comissões e taxas com percentuais', () => {
    const segments = buildMoneyAllocation({
      faturamento: 18430,
      comissoes: 4890,
      taxas: 312,
      contasFixas: 6200,
      liquido: 7028,
    });

    expect(segments.map((s) => s.key)).toEqual(['liquido', 'contas', 'comissoes', 'taxas']);
    const sobra = segments.find((s) => s.key === 'liquido')!;
    expect(sobra.value).toBe(7028);
    expect(sobra.percent).toBe(38); // 7028/18430 ≈ 38,1% → 38
    expect(segments.reduce((acc, s) => acc + s.value, 0)).toBe(18430);
    // MEDIUM-7: os percentuais fecham EXATAMENTE 100% (maior resto).
    expect(segments.reduce((acc, s) => acc + s.percent, 0)).toBe(100);
  });

  it('MEDIUM-7: percentuais somam 100% mesmo com arredondamento ruim (1/3 cada)', () => {
    // 3 fatias iguais de 33,33% → sem maior resto somaria 99%.
    const segments = buildMoneyAllocation({
      faturamento: 300,
      comissoes: 100,
      taxas: 100,
      contasFixas: 100,
      liquido: 0,
    });
    expect(segments.reduce((acc, s) => acc + s.percent, 0)).toBe(100);
  });

  it('líquido negativo vira sobra zero e % sobre as fatias visíveis (mês no vermelho)', () => {
    const net = {
      faturamento: 1000,
      comissoes: 800,
      taxas: 100,
      contasFixas: 500,
      liquido: -400,
    };
    const segments = buildMoneyAllocation(net);
    expect(segments.find((s) => s.key === 'liquido')!.value).toBe(0);
    expect(isMonthInRed(net)).toBe(true);
    // % sobre a soma das visíveis (800+100+500=1400), fechando 100%.
    expect(segments.reduce((acc, s) => acc + s.percent, 0)).toBe(100);
  });

  it('faturamento zero retorna lista vazia (nada pra alocar)', () => {
    expect(
      buildMoneyAllocation({ faturamento: 0, comissoes: 0, taxas: 0, contasFixas: 0, liquido: 0 })
    ).toEqual([]);
  });
});

describe('periodFromISO (período YYYY-MM pro "pagar" de comissão)', () => {
  it('extrai o ano-mês local da data ISO', () => {
    // meio do mês: sem ambiguidade de fuso
    expect(periodFromISO(new Date(2026, 5, 15, 12, 0, 0).toISOString())).toBe('2026-06');
  });

  it('vira o ano corretamente em dezembro', () => {
    expect(periodFromISO(new Date(2026, 11, 20, 12, 0, 0).toISOString())).toBe('2026-12');
  });
});

describe('isSingleCompetenceMonth (trava "pagar" comissão a 1 mês — MEDIUM-5)', () => {
  it('range dentro do mesmo mês é pagável', () => {
    const start = new Date(2026, 5, 1, 0, 0, 0).toISOString();
    const end = new Date(2026, 5, 30, 23, 59, 59).toISOString();
    expect(isSingleCompetenceMonth(start, end)).toBe(true);
  });

  it('range cruzando meses NÃO é pagável (evita pagamento ambíguo)', () => {
    const start = new Date(2026, 3, 1, 0, 0, 0).toISOString(); // abril
    const end = new Date(2026, 5, 30, 23, 59, 59).toISOString(); // junho
    expect(isSingleCompetenceMonth(start, end)).toBe(false);
  });

  it('range do ano inteiro NÃO é pagável', () => {
    const start = new Date(2026, 0, 1, 0, 0, 0).toISOString();
    const end = new Date(2026, 11, 31, 23, 59, 59).toISOString();
    expect(isSingleCompetenceMonth(start, end)).toBe(false);
  });
});
