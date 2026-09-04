import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const useHasPermissionMock = vi.fn();
vi.mock('@/lib/auth/useHasPermission', () => ({
  useHasPermission: (...args: unknown[]) => useHasPermissionMock(...args),
}));

const useRevenueReport = vi.fn();
const useCommissionReport = vi.fn();
const useNetResult = vi.fn();

vi.mock('@/lib/query/hooks/useFinanceReports', () => ({
  useRevenueReport: (...a: unknown[]) => useRevenueReport(...a),
  useCommissionReport: (...a: unknown[]) => useCommissionReport(...a),
  useNetResult: (...a: unknown[]) => useNetResult(...a),
}));

const generateFinanceReportPDF = vi.fn();
vi.mock('./utils/generateReportPDF', () => ({
  generateFinanceReportPDF: (...args: unknown[]) => generateFinanceReportPDF(...args),
}));

// A tabela de comissão por profissional agora é PARTE do Financeiro (27/07),
// então ela vem junto e precisa de toast e dos hooks de pagamento.
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn(), showToast: vi.fn() }),
}));
vi.mock('@/lib/query/hooks/useCommissionPaymentsQuery', () => ({
  useCreateCommissionPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCommissionPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCommissionPaymentDate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCommissionPaymentsByPeriod: () => ({ data: [], isLoading: false }),
}));

// Evita carregar recharts/lazy charts reais no teste.
vi.mock('@/components/charts', () => ({
  LazyRevenueTrendChart: () => <div data-testid="revenue-chart" />,
  LazyMoneyAllocationDonut: () => <div data-testid="money-donut" />,
  LazyWeeklyRevenueBars: () => <div data-testid="weekly-bars" />,
  ChartWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import FinanceReportPage from './FinanceReportPage';
import { useAuth } from '@/context/AuthContext';

const useAuthMock = vi.mocked(useAuth);

function mockReports() {
  useRevenueReport.mockReturnValue({
    data: {
      faturamento: 18430,
      totalAtendimentos: 47,
      porMes: [{ mes: '2026-06', faturamento: 18430 }],
      porSemana: [{ semana: '2026-06-01', faturamento: 4110, atendimentos: 11 }],
    },
    isLoading: false,
    isError: false,
  });
  useCommissionReport.mockReturnValue({
    data: { totalComissao: 4890, porProfissional: [] },
    isLoading: false,
    isError: false,
  });
  useNetResult.mockReturnValue({
    data: {
      regime: 'caixa',
      faturamento: 18430,
      taxas: 312,
      remuneracaoPaga: 6690,
      contasFixas: 6200,
      liquido: 5228,
    },
    isLoading: false,
    isError: false,
  });
}

describe('FinanceReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHasPermissionMock.mockReturnValue(true);
    mockReports();
  });

  it('usuário com reports.finance vê a cascata financeira', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_staff', organization_id: 'org-1', email: 'vitoria@clinica.com' },
    } as any);

    render(<FinanceReportPage />);

    expect(screen.getByText('Recebido bruto')).toBeInTheDocument();
    // As deduções aparecem no card E na legenda do donut.
    expect(screen.getAllByText('Taxas de cartão').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pago à equipe').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Contas fixas').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Líquido')).toBeInTheDocument();
    // gráficos do mockup montados
    expect(screen.getByTestId('money-donut')).toBeInTheDocument();
    expect(screen.getByTestId('weekly-bars')).toBeInTheDocument();
  });

  it('regressão: exibe o pago à equipe e prejuízo quando ele é a única saída', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);
    useRevenueReport.mockReturnValue({
      data: { faturamento: 0, totalAtendimentos: 0, porMes: [], porSemana: [] },
      isLoading: false,
      isError: false,
    });
    useCommissionReport.mockReturnValue({
      data: { totalComissao: 0, porProfissional: [] },
      isLoading: false,
      isError: false,
    });
    useNetResult.mockReturnValue({
      data: {
        regime: 'caixa',
        faturamento: 0,
        taxas: 0,
        remuneracaoPaga: 2500,
        contasFixas: 0,
        liquido: -2500,
      },
      isLoading: false,
      isError: false,
    });

    render(<FinanceReportPage />);

    expect(screen.getAllByText('Pago à equipe').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('mês no vermelho')).toBeInTheDocument();
    expect(screen.getByTestId('money-donut')).toBeInTheDocument();
    expect(screen.getAllByText(/2\.500,00/).length).toBeGreaterThanOrEqual(2);
  });

  it('exporta PDF com o pago à equipe e líquido recomputado pela cascata', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);
    useRevenueReport.mockReturnValue({
      data: { faturamento: 0, totalAtendimentos: 0, porMes: [], porSemana: [] },
      isLoading: false,
      isError: false,
    });
    useCommissionReport.mockReturnValue({
      data: { totalComissao: 0, porProfissional: [] },
      isLoading: false,
      isError: false,
    });
    useNetResult.mockReturnValue({
      data: {
        regime: 'caixa',
        faturamento: 0,
        taxas: 0,
        remuneracaoPaga: 2500,
        contasFixas: 0,
        liquido: 999999,
      },
      isLoading: false,
      isError: false,
    });

    render(<FinanceReportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(generateFinanceReportPDF).toHaveBeenCalledTimes(1));
    expect(generateFinanceReportPDF).toHaveBeenCalledWith(
      expect.objectContaining({ remuneracaoPaga: 2500, liquido: -2500 }),
      'this_month'
    );
  });

  it('usuário sem reports.finance vê acesso restrito sem disparar queries', () => {
    useHasPermissionMock.mockReturnValue(false);
    useAuthMock.mockReturnValue({
      profile: { id: 'u2', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    render(<FinanceReportPage />);

    expect(screen.getByText(/acesso restrito/i)).toBeInTheDocument();
    expect(screen.queryByText('Recebido bruto')).not.toBeInTheDocument();
    expect(screen.queryByText('Pago à equipe')).not.toBeInTheDocument();
    expect(screen.queryByText('Líquido')).not.toBeInTheDocument();
    // staff bloqueado nem dispara as queries financeiras
    expect(useRevenueReport).not.toHaveBeenCalled();
  });

  it('mostra estado de erro quando o relatório falha', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);
    useRevenueReport.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    render(<FinanceReportPage />);

    expect(screen.getByText(/não foi possível carregar/i)).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    const { container } = render(<FinanceReportPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
