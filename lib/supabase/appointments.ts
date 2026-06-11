/**
 * Serviço de leitura do cache local de agendamentos (resiliência).
 * A VERDADE é o Clinicorp (book/list ao vivo via /api/agenda/*); este service só LÊ o cache
 * pra tela carregar rápido e ter fallback. Sem create/update/delete na UI.
 * Espelha o padrão de lib/supabase/products.ts: {data,error}, colunas explícitas, .eq org no read.
 */
import { supabase } from './client';
import { Appointment } from '@/types';
import { sanitizeUUID } from './utils';

const COLUMNS =
  'id, organization_id, contact_id, professional_id, starts_at, ends_at, status, source, external_id, notes, created_at, updated_at, owner_id';

interface DbAppointment {
  id: string;
  organization_id: string | null;
  contact_id: string | null;
  professional_id: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  source: string;
  external_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  owner_id: string | null;
}

function transformAppointment(db: DbAppointment): Appointment {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    contactId: db.contact_id || undefined,
    professionalId: db.professional_id || undefined,
    startsAt: db.starts_at,
    endsAt: db.ends_at || undefined,
    status: db.status as Appointment['status'],
    source: db.source as Appointment['source'],
    externalId: db.external_id || undefined,
    notes: db.notes || undefined,
  };
}

export const appointmentsService = {
  async getAll(organizationId?: string | null): Promise<{ data: Appointment[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      let query = supabase
        .from('appointments')
        .select(COLUMNS)
        .order('starts_at', { ascending: true });

      const orgId = sanitizeUUID(organizationId);
      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      const { data, error } = await query;
      if (error) return { data: null, error };

      const rows = (data || []) as DbAppointment[];
      return { data: rows.map(transformAppointment), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async getByDateRange(
    fromIso: string,
    toIso: string,
    organizationId?: string | null
  ): Promise<{ data: Appointment[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      let query = supabase
        .from('appointments')
        .select(COLUMNS)
        .gte('starts_at', fromIso)
        .lte('starts_at', toIso)
        .order('starts_at', { ascending: true });

      const orgId = sanitizeUUID(organizationId);
      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      const { data, error } = await query;
      if (error) return { data: null, error };

      const rows = (data || []) as DbAppointment[];
      return { data: rows.map(transformAppointment), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },
};
