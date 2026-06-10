import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { Atendimento } from '@/types';
import { useAtendimentosController } from './useAtendimentosController';

const createMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const showToast = vi.fn();

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'clinic_staff' }, organizationId: 'org1' }),
}));
vi.mock('@/lib/realtime/useRealtimeSync', () => ({ useRealtimeSync: vi.fn() }));
vi.mock('@/lib/query/hooks/useAtendimentosQuery', () => ({
  useAtendimentos: () => ({ data: [], isLoading: false }),
  useCreateAtendimento: () => ({ mutate: createMutate }),
  useUpdateAtendimento: () => ({ mutate: updateMutate }),
  useDeleteAtendimento: () => ({ mutate: deleteMutate }),
}));
vi.mock('@/lib/query/hooks/useDealsQuery', () => ({
  useDeals: () => ({
    data: [{ id: 'd1', title: 'Plano Ortodôntico', contactId: 'c1', clientCompanyId: 'cc1' }],
    isLoading: false,
  }),
}));
vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useContacts: () => ({ data: [{ id: 'c1', name: 'Maria', clientCompanyId: 'cc1' }], isLoading: false }),
}));
vi.mock('@/lib/query/hooks/useProfessionalsQuery', () => ({
  useProfessionals: () => ({ data: [{ id: 'p1', name: 'Dra. Ana' }], isLoading: false }),
}));
vi.mock('@/lib/query/hooks/useProductsQuery', () => ({
  useProducts: () => ({ data: [{ id: 'prod1', name: 'Limpeza', price: 250 }], isLoading: false }),
}));

describe('useAtendimentosController', () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
    deleteMutate.mockClear();
    showToast.mockClear();
  });

  it('ao submeter, deriva contactId/dealId e marca recebido com performedAt + desconto', () => {
    const { result } = renderHook(() => useAtendimentosController());

    act(() => {
      result.current.setFormData({
        procedimento: 'Limpeza',
        productId: 'prod1',
        valor: '250',
        desconto: '30',
        professionalId: 'p1',
        dealId: 'd1',
        paymentMethod: 'pix',
        cardBrand: '',
        installments: '1',
        recebido: true,
      });
    });

    act(() => {
      result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(createMutate).toHaveBeenCalledTimes(1);
    const arg = createMutate.mock.calls[0][0];
    expect(arg.atendimento.contactId).toBe('c1');
    expect(arg.atendimento.dealId).toBe('d1');
    expect(arg.atendimento.recebido).toBe(true);
    expect(arg.atendimento.valor).toBe(250);
    expect(arg.atendimento.desconto).toBe(30);
    expect(typeof arg.atendimento.performedAt).toBe('string');
    expect(typeof arg.atendimento.paidAt).toBe('string');
  });

  describe('validação zod no submit (schema deixa de ser dead code)', () => {
    it('aborta com toast de erro quando desconto > valor (nenhuma mutação disparada)', () => {
      const { result } = renderHook(() => useAtendimentosController());

      act(() => {
        result.current.setFormData({
          procedimento: 'Limpeza',
          productId: 'prod1',
          valor: '250',
          desconto: '300',
          professionalId: 'p1',
          dealId: 'd1',
          paymentMethod: 'pix',
          cardBrand: '',
          installments: '1',
          recebido: false,
        });
      });

      act(() => {
        result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
      });

      expect(createMutate).not.toHaveBeenCalled();
      expect(updateMutate).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        'Desconto não pode ser maior que o valor do atendimento',
        'error'
      );
    });

    it('aborta com toast quando o profissional não foi selecionado', () => {
      const { result } = renderHook(() => useAtendimentosController());

      act(() => {
        result.current.setFormData({
          procedimento: 'Limpeza',
          productId: 'prod1',
          valor: '250',
          desconto: '0',
          professionalId: '',
          dealId: 'd1',
          paymentMethod: 'pix',
          cardBrand: '',
          installments: '1',
          recebido: false,
        });
      });

      act(() => {
        result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
      });

      expect(createMutate).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error');
    });
  });

  describe('update — preserva performedAt e só recomputa paidAt quando recebido muda', () => {
    const ORIGINAL_PERFORMED_AT = '2026-06-01T10:00:00.000Z';
    const ORIGINAL_PAID_AT = '2026-06-02T09:00:00.000Z';

    const baseAtendimento: Atendimento = {
      id: 'a1',
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: 250,
      desconto: 30,
      professionalId: 'p1',
      dealId: 'd1',
      paymentMethod: 'pix',
      installments: 1,
      recebido: false,
      performedAt: ORIGINAL_PERFORMED_AT,
    };

    /** Edita `atendimento`, alterna recebido pra `recebido` e submete. */
    const editAndSubmit = (atendimento: Atendimento, recebido: boolean) => {
      const { result } = renderHook(() => useAtendimentosController());
      act(() => {
        result.current.handleEdit(atendimento);
      });
      act(() => {
        result.current.setFormData({ ...result.current.formData, recebido });
      });
      act(() => {
        result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
      });
      expect(updateMutate).toHaveBeenCalledTimes(1);
      return updateMutate.mock.calls[0][0];
    };

    it('false→true: carimba paidAt = agora e PRESERVA performedAt original', () => {
      const arg = editAndSubmit({ ...baseAtendimento, recebido: false }, true);
      expect(arg.updates.performedAt).toBe(ORIGINAL_PERFORMED_AT);
      expect(typeof arg.updates.paidAt).toBe('string');
      expect(arg.updates.paidAt).not.toBe(ORIGINAL_PAID_AT);
      expect(arg.updates.recebido).toBe(true);
    });

    it('true→false: zera paidAt e preserva performedAt', () => {
      const arg = editAndSubmit(
        { ...baseAtendimento, recebido: true, paidAt: ORIGINAL_PAID_AT },
        false
      );
      expect(arg.updates.performedAt).toBe(ORIGINAL_PERFORMED_AT);
      expect(arg.updates.paidAt).toBeUndefined();
      expect(arg.updates.recebido).toBe(false);
    });

    it('true→true: PRESERVA o paidAt original (não re-carimba)', () => {
      const arg = editAndSubmit(
        { ...baseAtendimento, recebido: true, paidAt: ORIGINAL_PAID_AT },
        true
      );
      expect(arg.updates.performedAt).toBe(ORIGINAL_PERFORMED_AT);
      expect(arg.updates.paidAt).toBe(ORIGINAL_PAID_AT);
      expect(arg.updates.recebido).toBe(true);
    });

    it('false→false: paidAt continua vazio e performedAt preservado', () => {
      const arg = editAndSubmit({ ...baseAtendimento, recebido: false }, false);
      expect(arg.updates.performedAt).toBe(ORIGINAL_PERFORMED_AT);
      expect(arg.updates.paidAt).toBeUndefined();
      expect(arg.updates.recebido).toBe(false);
    });
  });
});
