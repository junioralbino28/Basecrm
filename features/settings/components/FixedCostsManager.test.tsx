import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

vi.mock('@/lib/query/hooks/useFixedCostsQuery', () => ({
  useFixedCosts: () => ({ data: [], isLoading: false, error: null }),
  useCreateFixedCost: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateFixedCost: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFixedCost: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { FixedCostsManager } from './FixedCostsManager';

describe('FixedCostsManager', () => {
  it('renderiza título e estado vazio', () => {
    render(<FixedCostsManager />);
    expect(screen.getByRole('heading', { name: /Contas Fixas/i })).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma conta fixa cadastrada ainda/i)).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<FixedCostsManager />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
