/**
 * @fileoverview Serviço Supabase para profissionais (dentistas) da clínica.
 *
 * Observação:
 * - Camada clínico-financeira: tabela dedicada `professionals`.
 * - Só clinic_admin/agency_admin muta (RLS can_configure); clinic_staff lê.
 * - organization_id + owner_id são STAMPADOS no insert (padrão productsService);
 *   a RLS WITH CHECK valida — nunca confiar no orgId do client como segurança.
 */

import { supabase } from './client';
import { Professional } from '@/types';
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

type DbProfessional = {
  id: string;
  organization_id: string | null;
  name: string;
  specialty: string | null;
  active: boolean | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

function transformProfessional(db: DbProfessional): Professional {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    name: db.name,
    specialty: db.specialty || undefined,
    active: db.active ?? true,
    ownerId: db.owner_id || undefined,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

export const professionalsService = {
  async getAll(organizationId?: string | null): Promise<{ data: Professional[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('professionals')
        .select('id, organization_id, name, specialty, active, owner_id, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbProfessional[];
      return { data: rows.map(transformProfessional), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async getActive(organizationId?: string | null): Promise<{ data: Professional[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      let query = supabase
        .from('professionals')
        .select('id, organization_id, name, specialty, active, owner_id, created_at, updated_at')
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbProfessional[];
      return { data: rows.map(transformProfessional), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: { name: string; specialty?: string; active?: boolean; organizationId?: string | null }): Promise<{ data: Professional | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();
      const organizationId = sanitizeUUID(input.organizationId) || await getCurrentOrganizationId();

      const { data, error } = await supabase
        .from('professionals')
        .insert({
          name: input.name,
          specialty: input.specialty || null,
          active: input.active ?? true,
          owner_id: sanitizeUUID(user?.id),
          organization_id: organizationId,
        })
        .select('id, organization_id, name, specialty, active, owner_id, created_at, updated_at')
        .single();

      if (error) return { data: null, error };
      return { data: transformProfessional(data as DbProfessional), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(id: string, updates: Partial<{ name: string; specialty?: string; active: boolean }>): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.specialty !== undefined) payload.specialty = updates.specialty || null;
      if (updates.active !== undefined) payload.active = updates.active;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('professionals')
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
        .from('professionals')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
