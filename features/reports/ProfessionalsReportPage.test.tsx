import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const useHasPermissionMock = vi.fn();
vi.mock('@/lib/auth/useHasPermission', () => ({
  useHasPermission: (...args: unknown[]) => useHasPermissionMock(...args),
}));

const useCommissionReport = vi.fn();
vi.mock('@/lib/query/hooks/useFinanceReports', () => ({
  useCommissionReport: (...a: unknown[]) => useCommissionReport(...a),
}));

const mutateAsync = vi.fn();
vi.mock('@/lib/query/hooks/useCommissionPaymentsQuery', () => ({
  useCreateCommissionPayment: () => ({ mutateAsync, isPending: false }),
}));

const addToast = vi.fn();
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast, showToast: addToast }),
}));

import ProfessionalsReportPage from './ProfessionalsReportPage';
import { useAuth } from '@/context/AuthContext';

const useAuthMock = vi.mocked(useAuth);

function mockReport() {
  useCommissionReport.mockReturnValue({
    data: {
      totalComissao: 1380,
      porProfissional: [
        {
          professionalId: 'p-marcos',
          professionalName: 'Dr. Marcos',
          atendimentos: 9,
          comissao: 1053,
          faturamentoBase: 3510,
          pago: 600,
          aPagar: 453,
        },
        {
          professionalId: 'p-carol',
          professionalName: 'Dra. Carol',
          atendimentos: 7,
          comissao: 327,
          faturamentoBase: 1310,
          pago: 327,
          aPagar: 0,
        },
      ],
    },
    isLoading: false,
    isError: false,
  });
}

describe('ProfessionalsReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHasPermissionMock.mockReturnValue(true);
    mockReport();
    mutateAsync.mockResolvedValue({ id: 'cp-1' });
  });

  it('usuário com reports.professionals vê a tabela por dentista', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_staff', organization_id: 'org-1', email: 'vitoria@clinica.com' },
    } as any);

    render(<ProfessionalsReportPage />);

    expect(screen.getByText('Dr. Marcos')).toBeInTheDocument();
    expect(screen.getByText('Dra. Carol')).toBeInTheDocument();
    // a pagar do Dr. Marcos
    expect(screen.getByText('R$ 453,00')).toBeInTheDocument();
    // quitado (a pagar = 0) não tem botão pagar
    expect(screen.getByText(/quitado/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^pagar/i })).toHaveLength(1);
  });

  it('ação "pagar" registra o pagamento com valor a pagar e período YYYY-MM', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    render(<ProfessionalsReportPage />);

    fireEvent.click(screen.getByRole('button', { name: /^pagar/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload.professionalId).toBe('p-marcos');
    expect(payload.amount).toBe(453);
    expect(payload.period).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    await waitFor(() => expect(addToast).toHaveBeenCalled());
  });

  it('toast de erro quando o pagamento falha (mutation onError)', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);
    mutateAsync.mockRejectedValue(new Error('RLS barrou'));

    render(<ProfessionalsReportPage />);

    fireEvent.click(screen.getByRole('button', { name: /^pagar/i }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/erro|falha|não foi/i), 'error'));
  });

  it('usuário sem reports.professionals vê acesso restrito e não dispara a query', () => {
    useHasPermissionMock.mockReturnValue(false);
    useAuthMock.mockReturnValue({
      profile: { id: 'u2', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    render(<ProfessionalsReportPage />);

    expect(screen.getByText(/acesso restrito/i)).toBeInTheDocument();
    expect(screen.queryByText('Dr. Marcos')).not.toBeInTheDocument();
    expect(useCommissionReport).not.toHaveBeenCalled();
  });

  it('não tem violações de acessibilidade', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    const { container } = render(<ProfessionalsReportPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
