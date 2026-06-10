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

// =============================================================================
// Organization inference (client-side, RLS-safe)
// =============================================================================
let cachedOrgId: string | null = null;
let cachedOrgUserId: string | null = null;

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  if (cachedOrgUserId === user.id && cachedOrgId) return cachedOrgId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (error) return null;

  const orgId = sanitizeUUID((profile as any)?.organization_id);
  cachedOrgUserId = user.id;
  cachedOrgId = orgId;
  return orgId;
}

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

  async create(input: {
    professionalId: string;
    amount: number;
    period: string;
    paidAt?: string;
    organizationId?: string | null;
  }): Promise<{ data: CommissionPayment | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();
      const organizationId = sanitizeUUID(input.organizationId) || await getCurrentOrganizationId();

      const payload: Record<string, unknown> = {
        professional_id: sanitizeUUID(input.professionalId),
        amount: input.amount,
        period: input.period,
        owner_id: sanitizeUUID(user?.id),
        organization_id: organizationId,
      };
      // paid_at só entra quando informado (backfill) — senão o DEFAULT now() carimba.
      if (input.paidAt !== undefined) payload.paid_at = input.paidAt;

      const { data, error } = await supabase
        .from('commission_payments')
        .insert(payload)
        .select(COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformCommissionPayment(data as DbCommissionPayment), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('commission_payments')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
