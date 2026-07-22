/**
 * @fileoverview Serviço Supabase para origens de lead editáveis (N1).
 *
 * Observação:
 * - Tabela de catálogo `lead_sources`: todo o tenant lê; somente quem tem
 *   `lead_sources.manage` cria, edita, arquiva ou restaura.
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
  normalized_name: string | null;
  code: string | null;
  archived_at: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_COLUMNS = 'id, organization_id, name, normalized_name, code, active, archived_at, owner_id, created_at, updated_at';

function transformLeadSource(db: DbLeadSource): LeadSource {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    name: db.name,
    normalizedName: db.normalized_name || undefined,
    code: db.code || undefined,
    active: db.active ?? true,
    archivedAt: db.archived_at || undefined,
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
        .is('archived_at', null)
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

      const organizationId = sanitizeUUID(input.organizationId) || await getCurrentOrganizationId();
      if (!organizationId) return { data: null, error: new Error('Organização não selecionada') };

      const { data, error } = await supabase
        .rpc('get_or_create_lead_source', {
          p_organization_id: organizationId,
          p_name: input.name,
        });

      if (error) return { data: null, error };
      const created = transformLeadSource(data as DbLeadSource);
      if (input.active === false && created.active) {
        const archived = await leadSourcesService.archive(created.id);
        if (archived.error) return { data: null, error: archived.error };
        return { data: { ...created, active: false, archivedAt: new Date().toISOString() }, error: null };
      }
      return { data: created, error: null };
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
      if (updates.active !== undefined) {
        payload.active = updates.active;
        payload.archived_at = updates.active ? null : new Date().toISOString();
      }
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

  async archive(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('lead_sources')
        .update({ active: false, archived_at: new Date().toISOString() })
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
