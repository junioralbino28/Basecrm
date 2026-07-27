import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const createSpy = vi.fn();
const updateSpy = vi.fn();
const REGRA_EXISTENTE = {
  id: 'rule-1',
  professionalId: 'prof-1',
  specialty: 'Ortodontia',
  procedimento: 'Consulta',
  amountType: 'fixed' as const,
  amount: 30,
  validFrom: '2026-01-01',
  percent: 0,
};
let regras: Array<typeof REGRA_EXISTENTE> = [];

vi.mock('@/lib/query/hooks/useCommissionRulesQuery', () => ({
  useCommissionRules: () => ({ data: regras, isLoading: false, error: null }),
  useCreateCommissionRule: () => ({ mutateAsync: createSpy, isPending: false }),
  useUpdateCommissionRule: () => ({ mutateAsync: updateSpy, isPending: false }),
  useDeleteCommissionRule: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/query/hooks/useProductsQuery', () => ({
  useProducts: () => ({
    data: [{ id: 'prod-1', name: 'Consulta', price: 120, active: true }],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/lib/query/hooks/useProfessionalsQuery', () => ({
  useProfessionals: () => ({
    data: [{ id: 'prof-1', name: 'Dra. Jéssica', specialty: 'Ortodontia', active: true }],
    isLoading: false,
    error: null,
  }),
}));

import { CommissionsManager } from './CommissionsManager';

describe('CommissionsManager', () => {
  beforeEach(() => {
    regras = [];
    createSpy.mockReset();
    updateSpy.mockReset();
  });

  it('renderiza título e estado vazio', () => {
    render(<CommissionsManager />);
    expect(screen.getByRole('heading', { name: /Comissões/i })).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma regra de comissão cadastrada ainda/i)).toBeInTheDocument();
  });

  it('lista os profissionais no select', () => {
    render(<CommissionsManager />);
    expect(screen.getByRole('option', { name: /Dra\. Jéssica/i })).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<CommissionsManager />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('alterar o valor CRIA um período novo (não edita o antigo) — o passado não muda', async () => {
    regras = [REGRA_EXISTENTE];
    render(<CommissionsManager />);

    fireEvent.click(screen.getByRole('button', { name: /Editar/i }));
    const campo = screen.getByLabelText(/Novo valor da comissão/i);
    fireEvent.change(campo, { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar/i }));

    // A regra antiga NÃO pode ser tocada — senão o relatório do mês passado mudava.
    expect(updateSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(1);
    const payload = createSpy.mock.calls[0][0];
    expect(payload).toMatchObject({
      professionalId: 'prof-1',
      procedimento: 'Consulta',
      amountType: 'fixed',
      amount: 50,
    });
  });
});
