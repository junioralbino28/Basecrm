import { describe, expect, it } from 'vitest';
import type { PaymentMethodFee, CommissionRule, FixedCost, CommissionPayment } from '@/types';

describe('finance config types', () => {
  it('PaymentMethodFee tem os campos camelCase do contrato', () => {
    const fee: PaymentMethodFee = {
      id: 'fee-1',
      organizationId: 'org-1',
      label: 'Crédito 3x Visa',
      paymentType: 'credito',
      cardBrand: 'visa',
      installments: 3,
      feePercent: 4.5,
    };
    expect(fee.paymentType).toBe('credito');
    expect(fee.feePercent).toBe(4.5);
    expect(fee.installments).toBe(3);
  });

  it('CommissionRule tem professionalId/specialty/percent', () => {
    const rule: CommissionRule = {
      id: 'rule-1',
      organizationId: 'org-1',
      professionalId: 'prof-1',
      specialty: 'ortodontia',
      percent: 30,
    };
    expect(rule.percent).toBe(30);
    expect(rule.professionalId).toBe('prof-1');
  });

  it('FixedCost tem name/amount/dueDay/active', () => {
    const cost: FixedCost = {
      id: 'cost-1',
      organizationId: 'org-1',
      name: 'Aluguel',
      amount: 5000,
      dueDay: 10,
      active: true,
    };
    expect(cost.amount).toBe(5000);
    expect(cost.active).toBe(true);
    expect(cost.dueDay).toBe(10);
  });

  it('CommissionPayment tem professionalId/amount/paidAt/period (adendo Paga/A pagar)', () => {
    const payment: CommissionPayment = {
      id: 'pay-1',
      organizationId: 'org-1',
      professionalId: 'prof-1',
      amount: 1200,
      paidAt: '2026-06-10T12:00:00.000Z',
      period: '2026-06',
    };
    expect(payment.amount).toBe(1200);
    expect(payment.period).toBe('2026-06');
    expect(payment.paidAt).toBeTruthy();
  });
});
