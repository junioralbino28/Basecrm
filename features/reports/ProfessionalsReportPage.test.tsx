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
const deleteAsync = vi.fn();
const updateDateAsync = vi.fn();
let pagamentosDoMes: Array<{ id: string; professionalId: string; amount: number; paidAt: string; period: string }> = [];
vi.mock('@/lib/query/hooks/useCommissionPaymentsQuery', () => ({
  useCreateCommissionPayment: () => ({ mutateAsync, isPending: false }),
  useDeleteCommissionPayment: () => ({ mutateAsync: deleteAsync, isPending: false }),
  useUpdateCommissionPaymentDate: () => ({ mutateAsync: updateDateAsync, isPending: false }),
  useCommissionPaymentsByPeriod: () => ({ data: pagamentosDoMes, isLoading: false }),
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
    deleteAsync.mockResolvedValue('cp-1');
    updateDateAsync.mockResolvedValue('cp-1');
    pagamentosDoMes = [];
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

    // Agora "pagar" ABRE o campo de valor (pagamento parcial, 27/07) — o
    // lançamento só acontece no "confirmar".
    fireEvent.click(screen.getByRole('button', { name: /^pagar/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));

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
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/erro|falha|não foi/i), 'error'));
  });

  // Pedido do Junior (27/07): escolher QUANTO está pagando.
  it('paga só uma parte quando o valor é editado', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    render(<ProfessionalsReportPage />);
    fireEvent.click(screen.getByRole('button', { name: /^pagar/i }));
    fireEvent.change(screen.getByLabelText(/Valor a pagar a Dr\. Marcos/i), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0].amount).toBe(200);
  });

  it('recusa valor acima do que está em aberto', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    render(<ProfessionalsReportPage />);
    fireEvent.click(screen.getByRole('button', { name: /^pagar/i }));
    fireEvent.change(screen.getByLabelText(/Valor a pagar a Dr\. Marcos/i), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/máximo em aberto/i), 'error');
  });

  // "Desfazer para caso de erro" — apaga o ÚLTIMO lançamento, não o histórico.
  it('desfaz o último pagamento lançado', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);
    pagamentosDoMes = [
      { id: 'cp-antigo', professionalId: 'p-marcos', amount: 100, paidAt: '2026-07-01T10:00:00Z', period: '2026-07' },
      { id: 'cp-ultimo', professionalId: 'p-marcos', amount: 500, paidAt: '2026-07-20T10:00:00Z', period: '2026-07' },
    ];
    window.confirm = vi.fn(() => true);

    render(<ProfessionalsReportPage />);
    fireEvent.click(screen.getByRole('button', { name: /Desfazer último pagamento de Dr\. Marcos/i }));

    await waitFor(() => expect(deleteAsync).toHaveBeenCalledWith('cp-ultimo'));
  });

  // Pedido do Junior (27/07): ver QUANDO cada pagamento foi feito.
  it('mostra o valor e a data de cada pagamento do mês', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);
    pagamentosDoMes = [
      { id: 'cp-1', professionalId: 'p-marcos', amount: 100, paidAt: '2026-07-03T12:00:00Z', period: '2026-07' },
      { id: 'cp-2', professionalId: 'p-marcos', amount: 500, paidAt: '2026-07-21T12:00:00Z', period: '2026-07' },
    ];

    render(<ProfessionalsReportPage />);

    // A data virou campo editável, então o valor mora no input — cada pagamento
    // tem o SEU, com o dia certo.
    expect(screen.getByLabelText(/Data do pagamento de R\$ 500,00 a Dr\. Marcos/i))
      .toHaveValue('2026-07-21');
    expect(screen.getByLabelText(/Data do pagamento de R\$ 100,00 a Dr\. Marcos/i))
      .toHaveValue('2026-07-03');
  });

  // Pedido do Junior (27/07): corrigir a data de um lançamento — pagamento
  // antigo cadastrado depois, ou lançado fora do dia.
  it('corrige a data de um pagamento já lançado', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);
    pagamentosDoMes = [
      { id: 'cp-1', professionalId: 'p-marcos', amount: 100, paidAt: '2026-07-03T12:00:00Z', period: '2026-07' },
    ];

    render(<ProfessionalsReportPage />);
    fireEvent.change(
      screen.getByLabelText(/Data do pagamento de R\$ 100,00 a Dr\. Marcos/i),
      { target: { value: '2026-07-15' } },
    );

    await waitFor(() => expect(updateDateAsync).toHaveBeenCalledTimes(1));
    expect(updateDateAsync.mock.calls[0][0].id).toBe('cp-1');
    // Meio-dia local: meia-noite escorregaria de dia ao virar o fuso.
    expect(new Date(updateDateAsync.mock.calls[0][0].paidAt).getDate()).toBe(15);
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
