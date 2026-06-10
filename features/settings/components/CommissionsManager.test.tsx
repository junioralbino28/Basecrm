import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

vi.mock('@/lib/query/hooks/useCommissionRulesQuery', () => ({
  useCommissionRules: () => ({ data: [], isLoading: false, error: null }),
  useCreateCommissionRule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCommissionRule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCommissionRule: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
});
