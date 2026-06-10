import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useAtendimentosController } from './useAtendimentosController';

const createMutate = vi.fn();

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'clinic_staff' }, organizationId: 'org1' }),
}));
vi.mock('@/lib/realtime/useRealtimeSync', () => ({ useRealtimeSync: vi.fn() }));
vi.mock('@/lib/query/hooks/useAtendimentosQuery', () => ({
  useAtendimentos: () => ({ data: [], isLoading: false }),
  useCreateAtendimento: () => ({ mutate: createMutate }),
  useUpdateAtendimento: () => ({ mutate: vi.fn() }),
  useDeleteAtendimento: () => ({ mutate: vi.fn() }),
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
});
