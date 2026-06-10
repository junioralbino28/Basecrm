/**
 * @fileoverview Serviço Supabase para taxas de meio de pagamento (config financeira).
 *
 * Observação:
 * - Config financeira é EXCLUSIVA do admin: RLS exige can_configure_organization
 *   em SELECT e mutação — clinic_staff (Vitória) não lê nem escreve.
 * - organization_id + owner_id são STAMPADOS no insert (padrão professionalsService);
 *   a RLS WITH CHECK valida — nunca confiar no orgId do client como segurança.
 */

import { supabase } from './client';
import { PaymentMethodFee, PaymentType } from '@/types';
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
  'id, organization_id, label, payment_type, card_brand, installments, fee_percent, owner_id, created_at, updated_at';

type DbPaymentMethodFee = {
  id: string;
  organization_id: string | null;
  label: string;
  payment_type: string;
  card_brand: string | null;
  installments: number;
  fee_percent: number;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

function transformPaymentMethodFee(db: DbPaymentMethodFee): PaymentMethodFee {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    label: db.label,
    paymentType: db.payment_type as PaymentType,
    cardBrand: db.card_brand || undefined,
    installments: Number(db.installments ?? 1),
    feePercent: Number(db.fee_percent ?? 0),
  };
}

export const paymentMethodFeesService = {
  async getAll(organizationId?: string | null): Promise<{ data: PaymentMethodFee[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('payment_method_fees')
        .select(COLUMNS)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbPaymentMethodFee[];
      return { data: rows.map(transformPaymentMethodFee), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: {
    label: string;
    paymentType: PaymentType;
    cardBrand?: string;
    installments: number;
    feePercent: number;
    organizationId?: string | null;
  }): Promise<{ data: PaymentMethodFee | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();
      const organizationId = sanitizeUUID(input.organizationId) || await getCurrentOrganizationId();

      const { data, error } = await supabase
        .from('payment_method_fees')
        .insert({
          label: input.label,
          payment_type: input.paymentType,
          card_brand: input.cardBrand || null,
          installments: input.installments,
          fee_percent: input.feePercent,
          owner_id: sanitizeUUID(user?.id),
          organization_id: organizationId,
        })
        .select(COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformPaymentMethodFee(data as DbPaymentMethodFee), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(
    id: string,
    updates: Partial<{ label: string; paymentType: PaymentType; cardBrand?: string; installments: number; feePercent: number }>
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      // Edição parcial: SÓ os campos explicitamente enviados entram no payload.
      const payload: Record<string, unknown> = {};
      if (updates.label !== undefined) payload.label = updates.label;
      if (updates.paymentType !== undefined) payload.payment_type = updates.paymentType;
      if (updates.cardBrand !== undefined) payload.card_brand = updates.cardBrand || null;
      if (updates.installments !== undefined) payload.installments = updates.installments;
      if (updates.feePercent !== undefined) payload.fee_percent = updates.feePercent;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('payment_method_fees')
        .update(payload)
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('payment_method_fees')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
