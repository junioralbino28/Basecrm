// Services de config financeira — transform snake↔camel, colunas explícitas e
// stamp de organization_id + owner_id no insert (RLS é o gate; o stamp é p/ WITH CHECK).
// IDs são UUIDs válidos porque sanitizeUUID anula qualquer string fora do formato.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PROF_ID = '33333333-3333-4333-8333-333333333333';
const ROW_ID = '44444444-4444-4444-8444-444444444444';

const selectMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();
const fromMock = vi.fn();
const getUserMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    auth: { getUser: () => getUserMock() },
  },
}));

import { paymentMethodFeesService } from '@/lib/supabase/paymentMethodFees';
import { commissionRulesService } from '@/lib/supabase/commissionRules';
import { fixedCostsService } from '@/lib/supabase/fixedCosts';
import { commissionPaymentsService } from '@/lib/supabase/commissionPayments';

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

function mockInsertReturning(row: Record<string, unknown>) {
  const singleMock = vi.fn().mockResolvedValue({ data: row, error: null });
  const selectAfterInsert = vi.fn().mockReturnValue({ single: singleMock });
  insertMock.mockReturnValue({ select: selectAfterInsert });
  fromMock.mockReturnValue({ insert: insertMock });
}

describe('paymentMethodFeesService', () => {
  it('getAll filtra por organization_id e transforma snake->camel', async () => {
    const eqMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: ROW_ID,
          organization_id: ORG_ID,
          label: 'Crédito 3x',
          payment_type: 'credito',
          card_brand: 'visa',
          installments: 3,
          fee_percent: 4.5,
          owner_id: USER_ID,
          created_at: 'now',
          updated_at: 'now',
        },
      ],
      error: null,
    });
    const orderMock = vi.fn().mockReturnValue({ eq: eqMock });
    selectMock.mockReturnValue({ order: orderMock });
    fromMock.mockReturnValue({ select: selectMock });

    const res = await paymentMethodFeesService.getAll(ORG_ID);
    expect(res.error).toBeNull();
    expect(res.data[0]).toEqual({
      id: ROW_ID,
      organizationId: ORG_ID,
      label: 'Crédito 3x',
      paymentType: 'credito',
      cardBrand: 'visa',
      installments: 3,
      feePercent: 4.5,
    });
    expect(fromMock).toHaveBeenCalledWith('payment_method_fees');
    expect(eqMock).toHaveBeenCalledWith('organization_id', ORG_ID);
  });

  it('create estampa organization_id + owner_id', async () => {
    mockInsertReturning({
      id: ROW_ID,
      organization_id: ORG_ID,
      label: 'Pix',
      payment_type: 'pix',
      card_brand: null,
      installments: 1,
      fee_percent: 0,
      owner_id: USER_ID,
      created_at: 'now',
      updated_at: 'now',
    });

    const res = await paymentMethodFeesService.create({
      label: 'Pix',
      paymentType: 'pix',
      installments: 1,
      feePercent: 0,
      organizationId: ORG_ID,
    });

    expect(res.error).toBeNull();
    expect(res.data?.paymentType).toBe('pix');
    const payload = insertMock.mock.calls[0][0];
    expect(payload.organization_id).toBe(ORG_ID);
    expect(payload.owner_id).toBe(USER_ID);
    expect(payload.payment_type).toBe('pix');
  });

  it('HIGH-2: create normaliza a bandeira (lower+trim) pra casar com o atendimento', async () => {
    mockInsertReturning({
      id: ROW_ID,
      organization_id: ORG_ID,
      label: 'Crédito Visa',
      payment_type: 'credito',
      card_brand: 'visa',
      installments: 1,
      fee_percent: 3.15,
      owner_id: USER_ID,
      created_at: 'now',
      updated_at: 'now',
    });

    await paymentMethodFeesService.create({
      label: 'Crédito Visa',
      paymentType: 'credito',
      cardBrand: '  Visa ',
      installments: 1,
      feePercent: 3.15,
      organizationId: ORG_ID,
    });

    const payload = insertMock.mock.calls[0][0];
    // free-text 'Visa ' → 'visa' (mesma chave que o atendimento grava no select).
    expect(payload.card_brand).toBe('visa');
  });

  it('update envia SÓ o campo editado (nunca re-carimba campos de domínio não editados)', async () => {
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    updateMock.mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    const res = await paymentMethodFeesService.update(ROW_ID, { feePercent: 3.2 });

    expect(res.error).toBeNull();
    const payload = updateMock.mock.calls[0][0];
    // Só fee_percent + updated_at — label/payment_type/installments intocados.
    expect(Object.keys(payload).sort()).toEqual(['fee_percent', 'updated_at']);
    expect(payload.fee_percent).toBe(3.2);
  });
});

describe('commissionRulesService', () => {
  it('create estampa org+owner e mapeia professional_id/specialty/percent', async () => {
    mockInsertReturning({
      id: ROW_ID,
      organization_id: ORG_ID,
      professional_id: PROF_ID,
      specialty: 'ortodontia',
      percent: 30,
      owner_id: USER_ID,
      created_at: 'now',
      updated_at: 'now',
    });

    const res = await commissionRulesService.create({
      professionalId: PROF_ID,
      specialty: 'ortodontia',
      percent: 30,
      organizationId: ORG_ID,
    });

    expect(res.data?.percent).toBe(30);
    const payload = insertMock.mock.calls[0][0];
    expect(payload.professional_id).toBe(PROF_ID);
    expect(payload.organization_id).toBe(ORG_ID);
    expect(payload.owner_id).toBe(USER_ID);
  });
});

describe('fixedCostsService', () => {
  it('create estampa org+owner e mapeia due_day/active', async () => {
    mockInsertReturning({
      id: ROW_ID,
      organization_id: ORG_ID,
      name: 'Aluguel',
      amount: 5000,
      due_day: 10,
      active: true,
      owner_id: USER_ID,
      created_at: 'now',
      updated_at: 'now',
    });

    const res = await fixedCostsService.create({
      name: 'Aluguel',
      amount: 5000,
      dueDay: 10,
      organizationId: ORG_ID,
    });

    expect(res.data?.amount).toBe(5000);
    const payload = insertMock.mock.calls[0][0];
    expect(payload.due_day).toBe(10);
    expect(payload.active).toBe(true);
    expect(payload.organization_id).toBe(ORG_ID);
    expect(payload.owner_id).toBe(USER_ID);
  });
});

describe('commissionPaymentsService', () => {
  it('create estampa org+owner e mapeia professional_id/amount/period (paid_at vem do banco quando omitido)', async () => {
    mockInsertReturning({
      id: ROW_ID,
      organization_id: ORG_ID,
      professional_id: PROF_ID,
      amount: 1200,
      paid_at: '2026-06-10T12:00:00.000Z',
      period: '2026-06',
      owner_id: USER_ID,
      created_at: 'now',
      updated_at: 'now',
    });

    const res = await commissionPaymentsService.create({
      professionalId: PROF_ID,
      amount: 1200,
      period: '2026-06',
      organizationId: ORG_ID,
    });

    expect(res.error).toBeNull();
    expect(res.data?.period).toBe('2026-06');
    expect(res.data?.paidAt).toBe('2026-06-10T12:00:00.000Z');
    const payload = insertMock.mock.calls[0][0];
    expect(payload.professional_id).toBe(PROF_ID);
    expect(payload.amount).toBe(1200);
    expect(payload.period).toBe('2026-06');
    expect(payload.organization_id).toBe(ORG_ID);
    expect(payload.owner_id).toBe(USER_ID);
    // paid_at omitido no input → não vai no payload (DB default now()).
    expect('paid_at' in payload).toBe(false);
  });

  it('getAll transforma snake->camel', async () => {
    const eqMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: ROW_ID,
          organization_id: ORG_ID,
          professional_id: PROF_ID,
          amount: 800,
          paid_at: '2026-06-01T10:00:00.000Z',
          period: '2026-05',
          owner_id: USER_ID,
          created_at: 'now',
          updated_at: 'now',
        },
      ],
      error: null,
    });
    const orderMock = vi.fn().mockReturnValue({ eq: eqMock });
    selectMock.mockReturnValue({ order: orderMock });
    fromMock.mockReturnValue({ select: selectMock });

    const res = await commissionPaymentsService.getAll(ORG_ID);
    expect(res.error).toBeNull();
    expect(res.data[0]).toEqual({
      id: ROW_ID,
      organizationId: ORG_ID,
      professionalId: PROF_ID,
      amount: 800,
      paidAt: '2026-06-01T10:00:00.000Z',
      period: '2026-05',
    });
    expect(fromMock).toHaveBeenCalledWith('commission_payments');
  });
});
