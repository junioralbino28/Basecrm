import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const useRevenueReport = vi.fn();
const useCommissionReport = vi.fn();
const useNetResult = vi.fn();

vi.mock('@/lib/query/hooks/useFinanceReports', () => ({
  useRevenueReport: (...a: unknown[]) => useRevenueReport(...a),
  useCommissionReport: (...a: unknown[]) => useCommissionReport(...a),
  useNetResult: (...a: unknown[]) => useNetResult(...a),
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
    data: { faturamento: 18430, comissoes: 4890, taxas: 312, contasFixas: 6200, liquido: 7028 },
    isLoading: false,
    isError: false,
  });
}

describe('FinanceReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReports();
  });

  it('clinic_admin (Adel) vê a cascata Recebido bruto → Taxas → Comissões → Contas fixas → Líquido', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    render(<FinanceReportPage />);

    expect(screen.getByText('Recebido bruto')).toBeInTheDocument();
    // "Taxas de cartão"/"Comissões"/"Contas fixas" aparecem no card E na legenda do donut
    expect(screen.getAllByText('Taxas de cartão').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Comissões').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Contas fixas').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Líquido')).toBeInTheDocument();
    // gráficos do mockup montados
    expect(screen.getByTestId('money-donut')).toBeInTheDocument();
    expect(screen.getByTestId('weekly-bars')).toBeInTheDocument();
  });

  it('clinic_staff (Vitória) NÃO vê a tela — Financeiro é só do admin (gate F5 espelhado)', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u2', role: 'clinic_staff', organization_id: 'org-1', email: 'vitoria@clinica.com' },
    } as any);

    render(<FinanceReportPage />);

    expect(screen.getByText(/acesso restrito/i)).toBeInTheDocument();
    expect(screen.queryByText('Recebido bruto')).not.toBeInTheDocument();
    expect(screen.queryByText('Comissões')).not.toBeInTheDocument();
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
