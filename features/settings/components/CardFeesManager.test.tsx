import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

vi.mock('@/lib/query/hooks/usePaymentMethodFeesQuery', () => ({
  usePaymentMethodFees: () => ({ data: [], isLoading: false, error: null }),
  useCreatePaymentMethodFee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePaymentMethodFee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePaymentMethodFee: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { CardFeesManager } from './CardFeesManager';

describe('CardFeesManager', () => {
  it('renderiza título e estado vazio', () => {
    render(<CardFeesManager />);
    expect(screen.getByRole('heading', { name: /Taxas de Pagamento/i })).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma taxa cadastrada ainda/i)).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<CardFeesManager />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
