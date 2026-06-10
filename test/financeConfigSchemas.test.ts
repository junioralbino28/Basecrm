import { describe, expect, it } from 'vitest';
import {
  paymentMethodFeeFormSchema,
  commissionRuleFormSchema,
  fixedCostFormSchema,
} from '@/lib/validations/schemas';

describe('paymentMethodFeeFormSchema', () => {
  it('aceita taxa válida', () => {
    const res = paymentMethodFeeFormSchema.safeParse({
      label: 'Crédito 3x Visa',
      paymentType: 'credito',
      cardBrand: 'visa',
      installments: 3,
      feePercent: 4.5,
    });
    expect(res.success).toBe(true);
  });

  it('rejeita paymentType vazio ou fora do domínio', () => {
    expect(
      paymentMethodFeeFormSchema.safeParse({
        label: 'Pix',
        paymentType: '',
        installments: 1,
        feePercent: 0,
      }).success
    ).toBe(false);
    expect(
      paymentMethodFeeFormSchema.safeParse({
        label: 'Boleto',
        paymentType: 'boleto',
        installments: 1,
        feePercent: 0,
      }).success
    ).toBe(false);
  });

  it('rejeita taxa acima de 100% (espelha o CHECK do banco)', () => {
    const res = paymentMethodFeeFormSchema.safeParse({
      label: 'Crédito',
      paymentType: 'credito',
      installments: 1,
      feePercent: 250,
    });
    expect(res.success).toBe(false);
  });

  it('rejeita parcelas fora de 1..48', () => {
    expect(
      paymentMethodFeeFormSchema.safeParse({
        label: 'Crédito',
        paymentType: 'credito',
        installments: 0,
        feePercent: 2,
      }).success
    ).toBe(false);
  });
});

describe('commissionRuleFormSchema', () => {
  it('aceita regra válida com profissional', () => {
    const res = commissionRuleFormSchema.safeParse({
      professionalId: 'prof-1',
      specialty: 'ortodontia',
      percent: 30,
    });
    expect(res.success).toBe(true);
  });

  it('rejeita professionalId vazio', () => {
    const res = commissionRuleFormSchema.safeParse({
      professionalId: '',
      percent: 30,
    });
    expect(res.success).toBe(false);
  });

  it('rejeita comissão acima de 100% (espelha o CHECK do banco)', () => {
    const res = commissionRuleFormSchema.safeParse({
      professionalId: 'prof-1',
      percent: 130,
    });
    expect(res.success).toBe(false);
  });
});

describe('fixedCostFormSchema', () => {
  it('aceita conta fixa válida', () => {
    const res = fixedCostFormSchema.safeParse({
      name: 'Aluguel',
      amount: 5000,
      dueDay: 10,
    });
    expect(res.success).toBe(true);
  });

  it('aceita conta sem dia de vencimento', () => {
    const res = fixedCostFormSchema.safeParse({
      name: 'Software',
      amount: 250,
    });
    expect(res.success).toBe(true);
  });

  it('rejeita nome vazio', () => {
    const res = fixedCostFormSchema.safeParse({
      name: '',
      amount: 5000,
    });
    expect(res.success).toBe(false);
  });

  it('rejeita dia de vencimento fora de 1..31', () => {
    expect(fixedCostFormSchema.safeParse({ name: 'Aluguel', amount: 100, dueDay: 0 }).success).toBe(false);
    expect(fixedCostFormSchema.safeParse({ name: 'Aluguel', amount: 100, dueDay: 32 }).success).toBe(false);
  });
});
