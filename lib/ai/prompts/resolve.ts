import type { SupabaseClient } from '@supabase/supabase-js';
import { getPromptCatalogMap } from './catalog';

// Sem 'server-only' de propósito: o script da Central de Agentes (scripts/central-agentes) usa esta
// MESMA regra para calcular o prompt de hoje. O runtime usa a leitura tolerante; o script, a estrita.

export type PromptResolution = {
  key: string;
  content: string;
  source: 'override' | 'default';
  version?: number;
  updatedAt?: string;
};

export type DbPromptRow = {
  key: string;
  content: string;
  version: number;
  is_active: boolean;
  updated_at: string;
};

/** Override ativo com conteúdo vence; senão o texto do catálogo; chave fora do catálogo e sem override = null. */
export function escolherPrompt(key: string, row: DbPromptRow | null): PromptResolution | null {
  if (row?.content) {
    return { key, content: row.content, source: 'override', version: row.version, updatedAt: row.updated_at };
  }
  const fallback = getPromptCatalogMap()[key];
  if (!fallback) return null;
  return { key, content: fallback.defaultTemplate, source: 'default' };
}

function lerOverrideAtivo(supabase: SupabaseClient, organizationId: string, key: string) {
  return supabase
    .from('ai_prompt_templates')
    .select('key, content, version, is_active, updated_at')
    .eq('organization_id', organizationId)
    .eq('key', key)
    .eq('is_active', true)
    .maybeSingle();
}

export async function buscarPromptResolvido(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
): Promise<PromptResolution | null> {
  const { data, error } = await lerOverrideAtivo(supabase, organizationId, key);

  if (error) {
    // Não quebrar IA por falha em prompt override; apenas log e fallback.
    console.warn('[ai/prompts] Failed to load override; using default.', { key, message: error.message });
  }

  return escolherPrompt(key, (data as DbPromptRow | null) ?? null);
}

/**
 * Mesma regra, sem tolerância: erro de banco LANÇA. É a leitura do script de migração, que nunca pode
 * gravar o texto do catálogo no lugar de um override só porque a consulta falhou.
 */
export async function buscarPromptResolvidoEstrito(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
): Promise<PromptResolution | null> {
  const { data, error } = await lerOverrideAtivo(supabase, organizationId, key);
  if (error) {
    throw new Error(`Falha ao ler o prompt ${key} da organizacao ${organizationId}: ${error.message}`);
  }
  return escolherPrompt(key, (data as DbPromptRow | null) ?? null);
}
