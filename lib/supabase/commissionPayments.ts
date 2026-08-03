/**
 * @fileoverview Serviço Supabase para pagamentos de comissão (profissional × período).
 *
 * Adendo 2026-06-10: alimenta o "Paga/A pagar" da tela Profissionais (F8).
 *
 * Observação:
 * - Config/dado financeiro EXCLUSIVO do admin: RLS exige can_configure_organization
 *   em SELECT e mutação — clinic_staff (Vitória) não lê nem escreve.
 * - organization_id + owner_id são STAMPADOS no insert (padrão professionalsService);
 *   a RLS WITH CHECK valida — nunca confiar no orgId do client como segurança.
 * - paid_at: quando omitido no create, o DEFAULT now() do banco carimba; o
 *   backfill histórico pode informar paid_at no passado explicitamente.
 */

import { supabase } from './client';
import { CommissionPayment } from '@/types';
import { sanitizeUUID } from './utils';

const COLUMNS =
  'id, organization_id, professional_id, amount, paid_at, period, owner_id, created_at, updated_at';

type DbCommissionPayment = {
  id: string;
  organization_id: string | null;
  professional_id: string;
  amount: number;
  paid_at: string;
  period: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

function transformCommissionPayment(db: DbCommissionPayment): CommissionPayment {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    professionalId: db.professional_id,
    amount: Number(db.amount ?? 0),
    paidAt: db.paid_at,
    period: db.period,
    createdAt: db.created_at,
  };
}

export const commissionPaymentsService = {
  async getAll(organizationId?: string | null): Promise<{ data: CommissionPayment[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('commission_payments')
        .select(COLUMNS)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbCommissionPayment[];
      return { data: rows.map(transformCommissionPayment), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  /**
   * Pagamentos de um mês de competência. Existe pro DESFAZER: pra apagar o
   * último pagamento é preciso saber quais são e qual foi o último.
   */
  async listByPeriod(period: string, organizationId: string): Promise<{ data: CommissionPayment[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('commission_payments')
        .select(COLUMNS)
        .eq('organization_id', organizationId)
        .eq('period', period)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (error) return { data: [], error };
      return {
        data: (data as DbCommissionPayment[] || []).map(transformCommissionPayment),
        error: null,
      };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: {
    professionalId: string;
    amount: number;
    period: string;
    paidAt?: string;
    organizationId: string;
    idempotencyKey: string;
  }): Promise<{ data: CommissionPayment | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data, error } = await supabase
        .rpc('record_commission_payment', {
          p_organization_id: sanitizeUUID(input.organizationId),
          p_professional_id: sanitizeUUID(input.professionalId),
          p_amount: input.amount,
          p_period: input.period,
          p_paid_at: input.paidAt ?? null,
          p_idempotency_key: sanitizeUUID(input.idempotencyKey),
        });

      if (error) return { data: null, error };
      return { data: transformCommissionPayment(data as DbCommissionPayment), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Corrige a DATA de um pagamento (lançamento fora do dia, pagamento antigo
   * cadastrado depois). Pedido do Junior, 2026-07-27.
   *
   * Só mexe em `paid_at` — a COMPETÊNCIA (`period`) fica como está de propósito:
   * uma comissão de julho paga em 5 de agosto continua sendo de julho, senão o
   * fechamento do mês mudaria sozinho ao corrigir uma data.
   */
  async updatePaidAt(id: string, paidAt: string, organizationId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase.rpc('update_commission_payment_paid_at', {
        p_organization_id: sanitizeUUID(organizationId),
        p_payment_id: sanitizeUUID(id),
        p_paid_at: paidAt,
      });
      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string, organizationId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase.rpc('delete_commission_payment', {
        p_organization_id: sanitizeUUID(organizationId),
        p_payment_id: sanitizeUUID(id),
      });

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
