import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('./client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { reportsService } from './reports';

describe('reportsService', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('getRevenueReport chama o RPC get_revenue_report com p_start/p_end e mapeia para camelCase', async () => {
    rpcMock.mockResolvedValue({
      data: {
        faturamento: 10000,
        total_atendimentos: 5,
        por_mes: [{ mes: '2026-06', faturamento: 10000 }],
        por_semana: [{ semana: '2026-06-01', faturamento: 10000, atendimentos: 5 }],
      },
      error: null,
    });

    const { data, error } = await reportsService.getRevenueReport(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );

    expect(error).toBeNull();
    expect(rpcMock).toHaveBeenCalledWith('get_revenue_report', {
      p_start: '2026-06-01T00:00:00Z',
      p_end: '2026-06-30T23:59:59Z',
    });
    expect(data).toEqual({
      faturamento: 10000,
      totalAtendimentos: 5,
      porMes: [{ mes: '2026-06', faturamento: 10000 }],
      porSemana: [{ semana: '2026-06-01', faturamento: 10000, atendimentos: 5 }],
    });
  });

  it('passa p_organization_id quando a org é informada (workspace de tenant da agência)', async () => {
    rpcMock.mockResolvedValue({
      data: { faturamento: 0, total_atendimentos: 0, por_mes: null, por_semana: null },
      error: null,
    });

    await reportsService.getRevenueReport(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z',
      'org-clinica'
    );

    expect(rpcMock).toHaveBeenCalledWith('get_revenue_report', {
      p_start: '2026-06-01T00:00:00Z',
      p_end: '2026-06-30T23:59:59Z',
      p_organization_id: 'org-clinica',
    });
  });

  it('getCommissionReport mapeia por_profissional para camelCase e deriva aPagar = max(comissao − pago, 0)', async () => {
    rpcMock.mockResolvedValue({
      data: {
        total_comissao: 2000,
        por_profissional: [
          {
            professional_id: 'p1',
            professional_name: 'Dr. Marcos',
            atendimentos: 9,
            comissao: 1053,
            faturamento_base: 3510,
            pago: 600,
          },
          {
            professional_id: 'p2',
            professional_name: 'Dra. Carol',
            atendimentos: 7,
            comissao: 327,
            faturamento_base: 1310,
            pago: 400, // pagou a mais — a pagar não fica negativo
          },
        ],
      },
      error: null,
    });

    const { data, error } = await reportsService.getCommissionReport(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );

    expect(error).toBeNull();
    expect(data).toEqual({
      totalComissao: 2000,
      porProfissional: [
        {
          professionalId: 'p1',
          professionalName: 'Dr. Marcos',
          atendimentos: 9,
          comissao: 1053,
          faturamentoBase: 3510,
          pago: 600,
          aPagar: 453,
        },
        {
          professionalId: 'p2',
          professionalName: 'Dra. Carol',
          atendimentos: 7,
          comissao: 327,
          faturamentoBase: 1310,
          pago: 400,
          aPagar: 0,
        },
      ],
    });
  });

  it('getNetResult mapeia o líquido para camelCase', async () => {
    rpcMock.mockResolvedValue({
      data: {
        faturamento: 10000,
        comissoes: 2000,
        taxas: 300,
        contas_fixas: 1500,
        liquido: 6200,
      },
      error: null,
    });

    const { data, error } = await reportsService.getNetResult(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );

    expect(error).toBeNull();
    expect(data).toEqual({
      faturamento: 10000,
      comissoes: 2000,
      taxas: 300,
      contasFixas: 1500,
      liquido: 6200,
    });
  });

  it('propaga erro do RPC sem lançar exceção', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('boom') });

    const { data, error } = await reportsService.getRevenueReport(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
