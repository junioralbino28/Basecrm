/**
 * @fileoverview Catálogos da equipe: CARGOS e ESPECIALIDADES.
 *
 * Existem porque cargo e especialidade eram texto livre na tela de Profissionais
 * e "Ortodontia" × "ortodontia" viravam duas coisas — quebrando agrupamento e
 * relatório em silêncio (apontado pelo Junior em 2026-07-24).
 *
 * Um serviço só para as duas listas: elas têm a MESMA forma (espelhada de
 * `lead_sources`), então ter dois arquivos iguais seria espaguete.
 */
import { supabase } from './client';

/** Qual catálogo — o nome da tabela é o próprio discriminador. */
export type TeamCatalogKind = 'job_roles' | 'specialties';

export type TeamCatalogItem = {
  id: string;
  organizationId?: string;
  name: string;
  active: boolean;
};

const COLUMNS = 'id, organization_id, name, active';

function transform(db: Record<string, unknown>): TeamCatalogItem {
  return {
    id: String(db.id),
    organizationId: (db.organization_id as string) || undefined,
    name: String(db.name ?? ''),
    active: (db.active as boolean) ?? true,
  };
}

async function currentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  return (data?.organization_id as string) || null;
}

export const teamCatalogsService = {
  async list(kind: TeamCatalogKind): Promise<{ data: TeamCatalogItem[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from(kind)
        .select(COLUMNS)
        .order('name', { ascending: true });
      if (error) return { data: [], error };
      return { data: (data || []).map((row) => transform(row as Record<string, unknown>)), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(
    kind: TeamCatalogKind,
    name: string,
    organizationId?: string | null,
  ): Promise<{ data: TeamCatalogItem | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const orgId = organizationId || await currentOrganizationId();
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from(kind)
        .insert({
          name: name.trim(),
          organization_id: orgId,
          owner_id: user?.id ?? null,
        })
        .select(COLUMNS)
        .single();
      if (error) {
        // O índice único é por nome normalizado — a mensagem crua não ajudaria
        // quem está cadastrando.
        if (/duplicate key|unique/i.test(error.message)) {
          return { data: null, error: new Error('Esse nome já existe na lista.') };
        }
        return { data: null, error };
      }
      return { data: transform(data as Record<string, unknown>), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async rename(
    kind: TeamCatalogKind,
    id: string,
    name: string,
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from(kind)
        .update({ name: name.trim(), updated_at: new Date().toISOString() })
        .eq('id', id);
      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async remove(kind: TeamCatalogKind, id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase.from(kind).delete().eq('id', id);
      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
