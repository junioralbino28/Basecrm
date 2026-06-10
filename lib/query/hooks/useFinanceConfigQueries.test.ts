import { describe, it, expect } from 'vitest';
import { queryKeys } from '../queryKeys';
import {
  usePaymentMethodFees,
  useCreatePaymentMethodFee,
  useUpdatePaymentMethodFee,
  useDeletePaymentMethodFee,
} from './usePaymentMethodFeesQuery';
import {
  useCommissionRules,
  useCreateCommissionRule,
  useUpdateCommissionRule,
  useDeleteCommissionRule,
} from './useCommissionRulesQuery';
import {
  useFixedCosts,
  useCreateFixedCost,
  useUpdateFixedCost,
  useDeleteFixedCost,
} from './useFixedCostsQuery';

describe('finance config query layer', () => {
  it('registra queryKeys das 3 entidades de config financeira', () => {
    expect(queryKeys.paymentMethodFees.all).toEqual(['paymentMethodFees']);
    expect(queryKeys.paymentMethodFees.lists()).toEqual(['paymentMethodFees', 'list']);
    expect(queryKeys.commissionRules.all).toEqual(['commissionRules']);
    expect(queryKeys.commissionRules.lists()).toEqual(['commissionRules', 'list']);
    expect(queryKeys.fixedCosts.all).toEqual(['fixedCosts']);
    expect(queryKeys.fixedCosts.lists()).toEqual(['fixedCosts', 'list']);
  });

  it('exporta os hooks de taxas de pagamento', () => {
    expect(typeof usePaymentMethodFees).toBe('function');
    expect(typeof useCreatePaymentMethodFee).toBe('function');
    expect(typeof useUpdatePaymentMethodFee).toBe('function');
    expect(typeof useDeletePaymentMethodFee).toBe('function');
  });

  it('exporta os hooks de regras de comissão', () => {
    expect(typeof useCommissionRules).toBe('function');
    expect(typeof useCreateCommissionRule).toBe('function');
    expect(typeof useUpdateCommissionRule).toBe('function');
    expect(typeof useDeleteCommissionRule).toBe('function');
  });

  it('exporta os hooks de contas fixas', () => {
    expect(typeof useFixedCosts).toBe('function');
    expect(typeof useCreateFixedCost).toBe('function');
    expect(typeof useUpdateFixedCost).toBe('function');
    expect(typeof useDeleteFixedCost).toBe('function');
  });
});
