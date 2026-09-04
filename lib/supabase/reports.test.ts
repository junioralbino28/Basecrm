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

  it('getCommissionReport deriva a pagar da remuneração total para híbrido e somente fixo', async () => {
    rpcMock.mockResolvedValue({
      data: {
        total_comissao: 1053,
        total_fixo: 3500,
        total_remuneracao: 4553,
        por_profissional: [
          {
            professional_id: 'p1',
            professional_name: 'Dr. Marcos',
            role: 'Dentista',
            pay_type: 'both',
            fixed_amount: 2500,
            atendimentos: 9,
            comissao: 1053,
            remuneracao_total: 3553,
            faturamento_base: 3510,
            pago: 600,
          },
          {
            professional_id: 'p2',
            professional_name: 'Dra. Carol',
            role: null,
            pay_type: 'fixed',
            fixed_amount: 1000,
            atendimentos: 7,
            comissao: 0,
            remuneracao_total: 1000,
            faturamento_base: 1310,
            pago: 400,
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
      totalComissao: 1053,
      totalFixo: 3500,
      totalRemuneracao: 4553,
      porProfissional: [
        {
          professionalId: 'p1',
          professionalName: 'Dr. Marcos',
          role: 'Dentista',
          payType: 'both',
          fixedAmount: 2500,
          atendimentos: 9,
          comissao: 1053,
          remuneracaoTotal: 3553,
          faturamentoBase: 3510,
          pago: 600,
          aPagar: 2953,
        },
        {
          professionalId: 'p2',
          professionalName: 'Dra. Carol',
          role: null,
          payType: 'fixed',
          fixedAmount: 1000,
          atendimentos: 7,
          comissao: 0,
          remuneracaoTotal: 1000,
          faturamentoBase: 1310,
          pago: 400,
          aPagar: 600,
        },
      ],
    });
  });

  it('getCommissionReport mantém fallback compatível com resposta legada', async () => {
    rpcMock.mockResolvedValue({
      data: {
        total_comissao: 1053,
        por_profissional: [
          {
            professional_id: 'p1',
            professional_name: 'Dr. Marcos',
            atendimentos: 9,
            comissao: 1053,
            faturamento_base: 3510,
            pago: 600,
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
      totalComissao: 1053,
      totalFixo: 0,
      totalRemuneracao: 1053,
      porProfissional: [
        {
          professionalId: 'p1',
          professionalName: 'Dr. Marcos',
          role: null,
          payType: 'commission',
          fixedAmount: 0,
          atendimentos: 9,
          comissao: 1053,
          remuneracaoTotal: 1053,
          faturamentoBase: 3510,
          pago: 600,
          aPagar: 453,
        },
      ],
    });
  });

  it('getNetResult mapeia o caixa para camelCase (com pró-rateio das contas)', async () => {
    rpcMock.mockResolvedValue({
      data: {
        regime: 'caixa',
        faturamento: 10000,
        taxas: 300,
        remuneracao_paga: 4500,
        contas_fixas: 4500, // 1500/mês × 3 meses (pró-rateio HIGH-1)
        contas_fixas_mensal: 1500,
        meses_periodo: 3,
        liquido: 700,
      },
      error: null,
    });

    const { data, error } = await reportsService.getNetResult(
      '2026-04-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );

    expect(error).toBeNull();
    expect(data).toEqual({
      regime: 'caixa',
      faturamento: 10000,
      taxas: 300,
      remuneracaoPaga: 4500,
      contasFixas: 4500,
      contasFixasMensal: 1500,
      mesesPeriodo: 3,
      liquido: 700,
    });
  });

  it('getNetResult tolera resposta antiga (sem pró-rateio nem pago à equipe): mensal = total, 1 mês, pago = 0', async () => {
    rpcMock.mockResolvedValue({
      data: {
        faturamento: 10000,
        taxas: 300,
        contas_fixas: 1500,
        liquido: 8200,
      },
      error: null,
    });

    const { data, error } = await reportsService.getNetResult(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );

    expect(error).toBeNull();
    expect(data).toEqual({
      regime: 'caixa',
      faturamento: 10000,
      taxas: 300,
      remuneracaoPaga: 0,
      contasFixas: 1500,
      contasFixasMensal: 1500,
      mesesPeriodo: 1,
      liquido: 8200,
    });
  });

  it('getCommercialReport mapeia o mês de fechamento para camelCase (origem 1º toque, campanha último toque)', async () => {
    rpcMock.mockResolvedValue({
      data: {
        regime: 'fechamento',
        fechamento: {
          ganhos: { qtd: 3, valor: 1700 },
          perdidos: { qtd: 1, valor: 800, motivos: [{ motivo: 'Preço', qtd: 1 }] },
          taxa_fechamento: 75,
          ticket_medio: 566.67,
          ciclo_medio_dias: 41.3,
        },
        entrada: { leads: 2, negocios: 4, valor: 10600 },
        por_origem: [
          { origem: 'Instagram', ganhos_qtd: 1, ganhos_valor: 1000, perdidos_qtd: 1 },
          { origem: 'Sem origem', ganhos_qtd: 1, ganhos_valor: 200, perdidos_qtd: 0 },
        ],
        por_campanha: [{ campanha: 'promo-junho', ganhos_qtd: 1, ganhos_valor: 1000 }],
      },
      error: null,
    });

    const { data, error } = await reportsService.getCommercialReport(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z',
      'org-1'
    );

    expect(error).toBeNull();
    expect(rpcMock).toHaveBeenCalledWith('get_commercial_report', {
      p_start: '2026-06-01T00:00:00Z',
      p_end: '2026-06-30T23:59:59Z',
      p_organization_id: 'org-1',
    });
    expect(data).toEqual({
      regime: 'fechamento',
      fechamento: {
        ganhos: { qtd: 3, valor: 1700 },
        perdidos: { qtd: 1, valor: 800, motivos: [{ motivo: 'Preço', qtd: 1 }] },
        taxaFechamento: 75,
        ticketMedio: 566.67,
        cicloMedioDias: 41.3,
      },
      entrada: { leads: 2, negocios: 4, valor: 10600 },
      porOrigem: [
        { origem: 'Instagram', ganhosQtd: 1, ganhosValor: 1000, perdidosQtd: 1 },
        { origem: 'Sem origem', ganhosQtd: 1, ganhosValor: 200, perdidosQtd: 0 },
      ],
      porCampanha: [{ campanha: 'promo-junho', ganhosQtd: 1, ganhosValor: 1000 }],
    });
  });

  it('getCommercialReport tolera resposta vazia/antiga sem lançar', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    const { data, error } = await reportsService.getCommercialReport(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({
      regime: 'fechamento',
      fechamento: { ganhos: { qtd: 0, valor: 0 }, taxaFechamento: 0 },
      entrada: { leads: 0, negocios: 0, valor: 0 },
      porOrigem: [],
      porCampanha: [],
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
