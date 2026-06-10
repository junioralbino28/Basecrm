/**
 * @fileoverview Serviço Supabase para contas fixas (custos fixos mensais).
 *
 * Observação:
 * - Config financeira é EXCLUSIVA do admin: RLS exige can_configure_organization
 *   em SELECT e mutação — clinic_staff (Vitória) não lê nem escreve.
 * - organization_id + owner_id são STAMPADOS no insert (padrão professionalsService);
 *   a RLS WITH CHECK valida — nunca confiar no orgId do client como segurança.
 */

import { supabase } from './client';
import { FixedCost } from '@/types';
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
  'id, organization_id, name, amount, due_day, active, owner_id, created_at, updated_at';

type DbFixedCost = {
  id: string;
  organization_id: string | null;
  name: string;
  amount: number;
  due_day: number | null;
  active: boolean | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

function transformFixedCost(db: DbFixedCost): FixedCost {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    name: db.name,
    amount: Number(db.amount ?? 0),
    dueDay: db.due_day ?? undefined,
    active: db.active ?? true,
  };
}

export const fixedCostsService = {
  async getAll(organizationId?: string | null): Promise<{ data: FixedCost[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('fixed_costs')
        .select(COLUMNS)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbFixedCost[];
      return { data: rows.map(transformFixedCost), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: {
    name: string;
    amount: number;
    dueDay?: number;
    organizationId?: string | null;
  }): Promise<{ data: FixedCost | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();
      const organizationId = sanitizeUUID(input.organizationId) || await getCurrentOrganizationId();

      const { data, error } = await supabase
        .from('fixed_costs')
        .insert({
          name: input.name,
          amount: input.amount,
          due_day: input.dueDay ?? null,
          active: true,
          owner_id: sanitizeUUID(user?.id),
          organization_id: organizationId,
        })
        .select(COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformFixedCost(data as DbFixedCost), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(
    id: string,
    updates: Partial<{ name: string; amount: number; dueDay?: number; active: boolean }>
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      // Edição parcial: SÓ os campos explicitamente enviados entram no payload.
      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.amount !== undefined) payload.amount = updates.amount;
      if (updates.dueDay !== undefined) payload.due_day = updates.dueDay ?? null;
      if (updates.active !== undefined) payload.active = updates.active;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('fixed_costs')
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
        .from('fixed_costs')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
