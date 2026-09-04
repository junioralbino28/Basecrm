/**
 * @fileoverview Serviço Supabase para relatórios financeiros da clínica (F8).
 *
 * Chama os RPCs SECURITY DEFINER (get_revenue_report / get_commission_report /
 * get_net_result). A segurança mora no RPC: a org efetiva (param opcional ou a
 * do caller via current_profile_organization_id) é validada DENTRO da função
 * por can_configure_organization — clinic_staff recebe erro, nunca dado.
 * O organizationId aqui é só roteamento (workspace de tenant da agência),
 * NUNCA segurança.
 *
 * @module lib/supabase/reports
 */

import { supabase } from './client';
import {
  RevenueReport,
  CommissionReport,
  NetResult,
  CommercialReport,
  ProfessionalPayType,
} from '@/types';

/** Saída crua do RPC get_revenue_report. */
interface DbRevenueReport {
  faturamento: number;
  total_atendimentos: number;
  por_mes: Array<{ mes: string; faturamento: number }> | null;
  por_semana: Array<{ semana: string; faturamento: number; atendimentos: number }> | null;
}

/** Saída crua do RPC get_commission_report. */
interface DbCommissionReport {
  total_comissao: number;
  // Opcionais para aceitar o contrato anterior, que reportava apenas comissão.
  total_fixo?: number;
  total_remuneracao?: number;
  por_profissional: Array<{
    professional_id: string;
    professional_name: string;
    role?: string | null;
    pay_type?: ProfessionalPayType | null;
    fixed_amount?: number;
    atendimentos: number;
    comissao: number;
    remuneracao_total?: number;
    faturamento_base: number;
    pago: number;
  }> | null;
}

/** Saída crua do RPC get_net_result. */
interface DbNetResult {
  // Régua do relatório (04/09): 'caixa'. Opcional p/ tolerar resposta anterior.
  regime?: 'caixa';
  faturamento: number;
  taxas: number;
  // Pago à equipe no período (fixo + comissão) pela data do pagamento.
  // Opcional p/ tolerar resposta anterior à separação das réguas.
  remuneracao_paga?: number;
  contas_fixas: number;
  // Campos do fix 20260624000000 (HIGH-1). Opcionais p/ tolerar resposta antiga.
  contas_fixas_mensal?: number;
  meses_periodo?: number;
  liquido: number;
}

/** Saída crua do RPC get_commercial_report (mês de fechamento). */
interface DbCommercialReport {
  regime?: 'fechamento';
  fechamento?: {
    ganhos?: { qtd?: number; valor?: number };
    perdidos?: { qtd?: number; valor?: number; motivos?: Array<{ motivo: string; qtd: number }> | null };
    taxa_fechamento?: number;
    ticket_medio?: number;
    ciclo_medio_dias?: number;
  };
  entrada?: { leads?: number; negocios?: number; valor?: number };
  por_origem?: Array<{ origem: string; ganhos_qtd: number; ganhos_valor: number; perdidos_qtd: number }> | null;
  por_campanha?: Array<{ campanha: string; ganhos_qtd: number; ganhos_valor: number }> | null;
}

const transformCommercial = (db: DbCommercialReport): CommercialReport => ({
  regime: 'fechamento',
  fechamento: {
    ganhos: {
      qtd: Number(db.fechamento?.ganhos?.qtd || 0),
      valor: Number(db.fechamento?.ganhos?.valor || 0),
    },
    perdidos: {
      qtd: Number(db.fechamento?.perdidos?.qtd || 0),
      valor: Number(db.fechamento?.perdidos?.valor || 0),
      motivos: (db.fechamento?.perdidos?.motivos || []).map((m) => ({
        motivo: m.motivo,
        qtd: Number(m.qtd || 0),
      })),
    },
    taxaFechamento: Number(db.fechamento?.taxa_fechamento || 0),
    ticketMedio: Number(db.fechamento?.ticket_medio || 0),
    cicloMedioDias: Number(db.fechamento?.ciclo_medio_dias || 0),
  },
  entrada: {
    leads: Number(db.entrada?.leads || 0),
    negocios: Number(db.entrada?.negocios || 0),
    valor: Number(db.entrada?.valor || 0),
  },
  porOrigem: (db.por_origem || []).map((o) => ({
    origem: o.origem,
    ganhosQtd: Number(o.ganhos_qtd || 0),
    ganhosValor: Number(o.ganhos_valor || 0),
    perdidosQtd: Number(o.perdidos_qtd || 0),
  })),
  porCampanha: (db.por_campanha || []).map((c) => ({
    campanha: c.campanha,
    ganhosQtd: Number(c.ganhos_qtd || 0),
    ganhosValor: Number(c.ganhos_valor || 0),
  })),
});

const transformRevenue = (db: DbRevenueReport): RevenueReport => ({
  faturamento: Number(db.faturamento || 0),
  totalAtendimentos: Number(db.total_atendimentos || 0),
  porMes: (db.por_mes || []).map((m) => ({
    mes: m.mes,
    faturamento: Number(m.faturamento || 0),
  })),
  porSemana: (db.por_semana || []).map((s) => ({
    semana: s.semana,
    faturamento: Number(s.faturamento || 0),
    atendimentos: Number(s.atendimentos || 0),
  })),
});

const transformCommission = (db: DbCommissionReport): CommissionReport => {
  const totalComissao = Number(db.total_comissao || 0);
  const porProfissional = (db.por_profissional || []).map((r) => {
    const comissao = Number(r.comissao || 0);
    const fixedAmount = Number(r.fixed_amount ?? 0);
    const remuneracaoTotal = Number(r.remuneracao_total ?? comissao + fixedAmount);
    const pago = Number(r.pago || 0);
    return {
      professionalId: r.professional_id,
      professionalName: r.professional_name,
      role: r.role ?? null,
      // No contrato antigo toda remuneração reportada aqui era comissão.
      payType: r.pay_type ?? 'commission',
      fixedAmount,
      atendimentos: Number(r.atendimentos || 0),
      comissao,
      remuneracaoTotal,
      faturamentoBase: Number(r.faturamento_base || 0),
      pago,
      // O pagamento quita a remuneração inteira (variável + fixa), sem saldo negativo.
      aPagar: Math.max(remuneracaoTotal - pago, 0),
    };
  });
  const totalFixo = Number(
    db.total_fixo ?? porProfissional.reduce((total, row) => total + row.fixedAmount, 0)
  );

  return {
    totalComissao,
    totalFixo,
    totalRemuneracao: Number(db.total_remuneracao ?? totalComissao + totalFixo),
    porProfissional,
  };
};

const transformNetResult = (db: DbNetResult): NetResult => {
  const contasFixas = Number(db.contas_fixas || 0);
  return {
    // O contrato é caixa por definição; a RPC antiga (sem o campo) recebe o
    // mesmo rótulo para o consumidor não misturar réguas por engano.
    regime: 'caixa',
    faturamento: Number(db.faturamento || 0),
    taxas: Number(db.taxas || 0),
    remuneracaoPaga: Number(db.remuneracao_paga ?? 0),
    contasFixas,
    // Fallback p/ resposta antiga (pré-fix): mensal = total, 1 mês.
    contasFixasMensal: Number(db.contas_fixas_mensal ?? contasFixas),
    mesesPeriodo: Number(db.meses_periodo ?? 1),
    liquido: Number(db.liquido || 0),
  };
};

/** Parâmetros do RPC: org só entra quando informada (default = org do caller). */
function rpcParams(pStart: string, pEnd: string, organizationId?: string | null) {
  return {
    p_start: pStart,
    p_end: pEnd,
    ...(organizationId ? { p_organization_id: organizationId } : {}),
  };
}

/**
 * Serviço de relatórios financeiros (read-only — relatório é derivado).
 *
 * @example
 * ```typescript
 * const { data, error } = await reportsService.getRevenueReport(start, end);
 * ```
 */
export const reportsService = {
  /**
   * Faturamento (recebido) no período + breakdown por mês e por semana.
   */
  async getRevenueReport(
    pStart: string,
    pEnd: string,
    organizationId?: string | null
  ): Promise<{ data: RevenueReport | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const { data, error } = await supabase.rpc(
        'get_revenue_report',
        rpcParams(pStart, pEnd, organizationId) as any
      );
      if (error) return { data: null, error };
      return { data: transformRevenue(data as DbRevenueReport), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Comissão por profissional no período (com "pago" e "a pagar").
   */
  async getCommissionReport(
    pStart: string,
    pEnd: string,
    organizationId?: string | null
  ): Promise<{ data: CommissionReport | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const { data, error } = await supabase.rpc(
        'get_commission_report',
        rpcParams(pStart, pEnd, organizationId) as any
      );
      if (error) return { data: null, error };
      return { data: transformCommission(data as DbCommissionReport), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Resultado líquido (faturamento − remuneração total − taxas − contas fixas).
   */
  async getNetResult(
    pStart: string,
    pEnd: string,
    organizationId?: string | null
  ): Promise<{ data: NetResult | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const { data, error } = await supabase.rpc(
        'get_net_result',
        rpcParams(pStart, pEnd, organizationId) as any
      );
      if (error) return { data: null, error };
      return { data: transformNetResult(data as DbNetResult), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Comercial do período pelo mês de FECHAMENTO: ganhos, perdidos, taxa de
   * fechamento, entrada (contexto), por origem (1º toque) e por campanha
   * (último toque). Decisão de 04/09.
   */
  async getCommercialReport(
    pStart: string,
    pEnd: string,
    organizationId?: string | null
  ): Promise<{ data: CommercialReport | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const { data, error } = await supabase.rpc(
        'get_commercial_report',
        rpcParams(pStart, pEnd, organizationId) as any
      );
      if (error) return { data: null, error };
      return { data: transformCommercial(data as DbCommercialReport), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },
};
