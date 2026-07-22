/**
 * @fileoverview Serviço Supabase para etiquetas controladas (C2C, §N1.1).
 *
 * Contrato:
 * - A secretária SELECIONA etiqueta, nunca digita: toda escrita passa pelas RPCs
 *   da C2A (`assign_deal_tag` / `remove_deal_tag` / `set_primary_deal_tag`), que
 *   validam tenant, cardinalidade e auditoria no banco.
 * - Criar categoria/etiqueta usa `get_or_create_tag_category` / `get_or_create_tag`
 *   (dedupe por nome normalizado; requer `tags.manage` — a RLS recusa sem ela).
 * - Leitura é direta nas tabelas (RLS de SELECT por tenant).
 * - NUNCA expor "salvar a lista": só add/remove/set-primary (lição Kommo).
 */

import { supabase } from './client';
import { DealTagAssignment, TagCategory, TagEntity } from '@/types';
import { sanitizeUUID } from './utils';

type DbTagCategory = {
  id: string;
  organization_id: string | null;
  label: string;
  normalized_name: string | null;
  cardinality: string | null;
  archived_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type DbTag = {
  id: string;
  organization_id: string | null;
  category_id: string | null;
  name: string;
  normalized_name: string | null;
  color: string | null;
  code: string | null;
  archived_at: string | null;
  created_at: string | null;
};

type DbAssignment = {
  id: string;
  organization_id: string | null;
  deal_id: string;
  category_id: string;
  tag_id: string;
  is_primary: boolean | null;
  applied_at: string | null;
  recorded_at: string | null;
};

const CATEGORY_COLUMNS = 'id, organization_id, label, normalized_name, cardinality, archived_at, created_at, updated_at';
const TAG_COLUMNS = 'id, organization_id, category_id, name, normalized_name, color, code, archived_at, created_at';
const ASSIGNMENT_COLUMNS = 'id, organization_id, deal_id, category_id, tag_id, is_primary, applied_at, recorded_at';

function transformCategory(db: DbTagCategory): TagCategory {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    label: db.label,
    normalizedName: db.normalized_name || undefined,
    cardinality: db.cardinality === 'single' ? 'single' : 'multiple',
    archivedAt: db.archived_at || undefined,
    createdAt: db.created_at || undefined,
    updatedAt: db.updated_at || undefined,
  };
}

function transformTag(db: DbTag): TagEntity {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    categoryId: db.category_id || undefined,
    name: db.name,
    normalizedName: db.normalized_name || undefined,
    color: db.color || undefined,
    code: db.code || undefined,
    archivedAt: db.archived_at || undefined,
    createdAt: db.created_at || undefined,
  };
}

function transformAssignment(db: DbAssignment): DealTagAssignment {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    dealId: db.deal_id,
    categoryId: db.category_id,
    tagId: db.tag_id,
    isPrimary: db.is_primary ?? false,
    appliedAt: db.applied_at || undefined,
    recordedAt: db.recorded_at || undefined,
  };
}

export const dealTagsService = {
  /** Catálogo ativo do tenant: categorias (sem arquivadas) com suas etiquetas. */
  async getCatalog(organizationId: string): Promise<{
    categories: TagCategory[];
    tags: TagEntity[];
    error: Error | null;
  }> {
    try {
      if (!supabase) return { categories: [], tags: [], error: new Error('Supabase não configurado') };
      const orgId = sanitizeUUID(organizationId);
      if (!orgId) return { categories: [], tags: [], error: new Error('Organização não selecionada') };

      const [categories, tags] = await Promise.all([
        supabase
          .from('tag_categories')
          .select(CATEGORY_COLUMNS)
          .eq('organization_id', orgId)
          .is('archived_at', null)
          .order('label', { ascending: true }),
        supabase
          .from('tags')
          .select(TAG_COLUMNS)
          .eq('organization_id', orgId)
          .is('archived_at', null)
          .order('name', { ascending: true }),
      ]);

      if (categories.error) return { categories: [], tags: [], error: categories.error };
      if (tags.error) return { categories: [], tags: [], error: tags.error };

      return {
        categories: ((categories.data || []) as DbTagCategory[]).map(transformCategory),
        // Etiqueta legada sem categoria não entra no seletor (vai pra fila de
        // revisão da migração, não pra mão da secretária).
        tags: ((tags.data || []) as DbTag[]).filter((t) => t.category_id).map(transformTag),
        error: null,
      };
    } catch (e) {
      return { categories: [], tags: [], error: e as Error };
    }
  },

  /** Atribuições ativas de um negócio (removidas ficam só no histórico). */
  async getAssignments(organizationId: string, dealId: string): Promise<{
    data: DealTagAssignment[];
    error: Error | null;
  }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('deal_tag_assignments')
        .select(ASSIGNMENT_COLUMNS)
        .eq('organization_id', sanitizeUUID(organizationId))
        .eq('deal_id', sanitizeUUID(dealId))
        .is('removed_at', null)
        .order('recorded_at', { ascending: true });

      if (error) return { data: [], error };
      return { data: ((data || []) as DbAssignment[]).map(transformAssignment), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  /** Aplica etiqueta. Em categoria `single` o banco substitui a anterior sozinho. */
  async assign(organizationId: string, dealId: string, tagId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase.rpc('assign_deal_tag', {
        p_organization_id: sanitizeUUID(organizationId),
        p_deal_id: sanitizeUUID(dealId),
        p_tag_id: sanitizeUUID(tagId),
      });
      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async remove(organizationId: string, dealId: string, tagId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase.rpc('remove_deal_tag', {
        p_organization_id: sanitizeUUID(organizationId),
        p_deal_id: sanitizeUUID(dealId),
        p_tag_id: sanitizeUUID(tagId),
      });
      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  /** Troca o principal com um clique — disponível, nunca obrigatório (N1.2/D2). */
  async setPrimary(organizationId: string, dealId: string, tagId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase.rpc('set_primary_deal_tag', {
        p_organization_id: sanitizeUUID(organizationId),
        p_deal_id: sanitizeUUID(dealId),
        p_tag_id: sanitizeUUID(tagId),
      });
      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  /** Cria (ou restaura/devolve) categoria. Requer `tags.manage` — RLS recusa sem. */
  async createCategory(organizationId: string, label: string, cardinality: 'single' | 'multiple'): Promise<{
    data: TagCategory | null;
    error: Error | null;
  }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { data, error } = await supabase.rpc('get_or_create_tag_category', {
        p_organization_id: sanitizeUUID(organizationId),
        p_label: label,
        p_cardinality: cardinality,
      });
      if (error) return { data: null, error };
      return { data: transformCategory(data as DbTagCategory), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Cria (ou devolve a existente pelo nome normalizado). Requer `tags.manage`. */
  async createTag(organizationId: string, categoryId: string, name: string): Promise<{
    data: TagEntity | null;
    error: Error | null;
  }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { data, error } = await supabase.rpc('get_or_create_tag', {
        p_organization_id: sanitizeUUID(organizationId),
        p_category_id: sanitizeUUID(categoryId),
        p_name: name,
      });
      if (error) return { data: null, error };
      return { data: transformTag(data as DbTag), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Arquivar é o fluxo normal; apagar não existe aqui (O5/§10 do parecer).
   * O caminho sancionado é o UPDATE de `archived_at`: os guards da C2A validam
   * `tags.manage` e BLOQUEIAM com mensagem acionável quando uma automação
   * publicada depende da etiqueta.
   */
  async setTagArchived(organizationId: string, tagId: string, archived: boolean): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('tags')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('organization_id', sanitizeUUID(organizationId))
        .eq('id', sanitizeUUID(tagId));
      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async setCategoryArchived(organizationId: string, categoryId: string, archived: boolean): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('tag_categories')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('organization_id', sanitizeUUID(organizationId))
        .eq('id', sanitizeUUID(categoryId));
      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
