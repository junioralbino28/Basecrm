/**
 * @fileoverview Serviço Supabase para regras de comissão (dentista × especialidade × percent).
 *
 * Observação:
 * - Config financeira é EXCLUSIVA do admin: RLS exige can_configure_organization
 *   em SELECT e mutação — clinic_staff (Vitória) não lê nem escreve.
 * - organization_id + owner_id são STAMPADOS no insert (padrão professionalsService);
 *   a RLS WITH CHECK valida — nunca confiar no orgId do client como segurança.
 */

import { supabase } from './client';
import { CommissionRule } from '@/types';
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
  'id, organization_id, professional_id, specialty, percent, owner_id, created_at, updated_at';

type DbCommissionRule = {
  id: string;
  organization_id: string | null;
  professional_id: string | null;
  specialty: string | null;
  percent: number;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

function transformCommissionRule(db: DbCommissionRule): CommissionRule {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    professionalId: db.professional_id || undefined,
    specialty: db.specialty || undefined,
    percent: Number(db.percent ?? 0),
  };
}

export const commissionRulesService = {
  async getAll(organizationId?: string | null): Promise<{ data: CommissionRule[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('commission_rules')
        .select(COLUMNS)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbCommissionRule[];
      return { data: rows.map(transformCommissionRule), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: {
    professionalId?: string;
    specialty?: string;
    percent: number;
    organizationId?: string | null;
  }): Promise<{ data: CommissionRule | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();
      const organizationId = sanitizeUUID(input.organizationId) || await getCurrentOrganizationId();

      const { data, error } = await supabase
        .from('commission_rules')
        .insert({
          professional_id: sanitizeUUID(input.professionalId),
          specialty: input.specialty || null,
          percent: input.percent,
          owner_id: sanitizeUUID(user?.id),
          organization_id: organizationId,
        })
        .select(COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformCommissionRule(data as DbCommissionRule), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(
    id: string,
    updates: Partial<{ professionalId?: string; specialty?: string; percent: number }>
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      // Edição parcial: SÓ os campos explicitamente enviados entram no payload.
      const payload: Record<string, unknown> = {};
      if (updates.professionalId !== undefined) payload.professional_id = sanitizeUUID(updates.professionalId);
      if (updates.specialty !== undefined) payload.specialty = updates.specialty || null;
      if (updates.percent !== undefined) payload.percent = updates.percent;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('commission_rules')
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
        .from('commission_rules')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
