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
import { RevenueReport, CommissionReport, NetResult } from '@/types';

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
  por_profissional: Array<{
    professional_id: string;
    professional_name: string;
    atendimentos: number;
    comissao: number;
    faturamento_base: number;
    pago: number;
  }> | null;
}

/** Saída crua do RPC get_net_result. */
interface DbNetResult {
  faturamento: number;
  comissoes: number;
  taxas: number;
  contas_fixas: number;
  liquido: number;
}

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

const transformCommission = (db: DbCommissionReport): CommissionReport => ({
  totalComissao: Number(db.total_comissao || 0),
  porProfissional: (db.por_profissional || []).map((r) => {
    const comissao = Number(r.comissao || 0);
    const pago = Number(r.pago || 0);
    return {
      professionalId: r.professional_id,
      professionalName: r.professional_name,
      atendimentos: Number(r.atendimentos || 0),
      comissao,
      faturamentoBase: Number(r.faturamento_base || 0),
      pago,
      // "A pagar" nunca fica negativo: pagamento a maior = quitado.
      aPagar: Math.max(comissao - pago, 0),
    };
  }),
});

const transformNetResult = (db: DbNetResult): NetResult => ({
  faturamento: Number(db.faturamento || 0),
  comissoes: Number(db.comissoes || 0),
  taxas: Number(db.taxas || 0),
  contasFixas: Number(db.contas_fixas || 0),
  liquido: Number(db.liquido || 0),
});

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
   * Resultado líquido (faturamento − comissões − taxas − contas fixas).
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
};
