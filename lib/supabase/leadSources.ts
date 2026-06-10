/**
 * @fileoverview Serviço Supabase para origens de lead editáveis (N1).
 *
 * Observação:
 * - Tabela OPERACIONAL `lead_sources`: SELECT = can_access (tenant todo lê),
 *   mutação = can_operate (recepção/staff cadastra/edita origem).
 * - organization_id + owner_id são STAMPADOS no insert (padrão professionalsService);
 *   a RLS WITH CHECK valida — nunca confiar no orgId do client como segurança.
 */

import { supabase } from './client';
import { LeadSource } from '@/types';
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

type DbLeadSource = {
  id: string;
  organization_id: string | null;
  name: string;
  active: boolean | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_COLUMNS = 'id, organization_id, name, active, owner_id, created_at, updated_at';

function transformLeadSource(db: DbLeadSource): LeadSource {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    name: db.name,
    active: db.active ?? true,
    ownerId: db.owner_id || undefined,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

export const leadSourcesService = {
  async getAll(organizationId?: string | null): Promise<{ data: LeadSource[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('lead_sources')
        .select(SELECT_COLUMNS)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbLeadSource[];
      return { data: rows.map(transformLeadSource), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async getActive(organizationId?: string | null): Promise<{ data: LeadSource[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('lead_sources')
        .select(SELECT_COLUMNS)
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbLeadSource[];
      return { data: rows.map(transformLeadSource), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: { name: string; active?: boolean; organizationId?: string | null }): Promise<{ data: LeadSource | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();
      const organizationId = sanitizeUUID(input.organizationId) || await getCurrentOrganizationId();

      const { data, error } = await supabase
        .from('lead_sources')
        .insert({
          name: input.name,
          active: input.active ?? true,
          owner_id: sanitizeUUID(user?.id),
          organization_id: organizationId,
        })
        .select(SELECT_COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformLeadSource(data as DbLeadSource), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(id: string, updates: Partial<{ name: string; active: boolean }>): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      // Update NUNCA re-carimba campos não editados (lição F4).
      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.active !== undefined) payload.active = updates.active;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('lead_sources')
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
        .from('lead_sources')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
