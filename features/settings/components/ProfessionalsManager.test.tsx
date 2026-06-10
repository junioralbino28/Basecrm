import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
  }),
}));

vi.mock('@/lib/query/hooks/useProfessionalsQuery', () => ({
  useProfessionals: () => ({ data: [], isLoading: false, error: null }),
  useCreateProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ProfessionalsManager } from './ProfessionalsManager';

describe('ProfessionalsManager', () => {
  it('renderiza título e estado vazio', () => {
    render(<ProfessionalsManager />);
    expect(screen.getByRole('heading', { name: /Profissionais/i })).toBeInTheDocument();
    expect(screen.getByText(/Nenhum profissional cadastrado ainda/i)).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<ProfessionalsManager />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
