import { describe, it, expectTypeOf } from 'vitest';
import type { Atendimento, OrganizationId } from '@/types';

describe('tipo Atendimento', () => {
  it('expõe os campos clínico-financeiros em camelCase', () => {
    expectTypeOf<Atendimento>().toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf<Atendimento>().toHaveProperty('organizationId').toEqualTypeOf<OrganizationId | undefined>();
    expectTypeOf<Atendimento>().toHaveProperty('procedimento').toEqualTypeOf<string>();
    expectTypeOf<Atendimento>().toHaveProperty('valor').toEqualTypeOf<number>();
    expectTypeOf<Atendimento>().toHaveProperty('desconto').toEqualTypeOf<number>();
    expectTypeOf<Atendimento>().toHaveProperty('recebido').toEqualTypeOf<boolean>();
    expectTypeOf<Atendimento>().toHaveProperty('installments').toEqualTypeOf<number>();
  });

  it('permite montar um atendimento mínimo recebido', () => {
    const a: Atendimento = {
      id: 'x',
      contactId: 'c1',
      dealId: 'd1',
      professionalId: 'p1',
      productId: 'prod1',
      procedimento: 'Limpeza',
      valor: 250,
      desconto: 0,
      paymentMethod: 'pix',
      cardBrand: undefined,
      installments: 1,
      recebido: true,
      paidAt: '2026-06-09T12:00:00.000Z',
      performedAt: '2026-06-09T12:00:00.000Z',
    };
    expectTypeOf(a.recebido).toEqualTypeOf<boolean>();
  });
});
