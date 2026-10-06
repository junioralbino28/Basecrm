import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buscarPromptResolvido, type PromptResolution } from './resolve';

export type { PromptResolution };

/**
 * Prompt resolvido da organização: override ativo em ai_prompt_templates, senão o texto do catálogo.
 * A regra mora em ./resolve (sem server-only) para o script da Central de Agentes usar a mesma.
 */
export async function getResolvedPrompt(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
): Promise<PromptResolution | null> {
  return buscarPromptResolvido(supabase, organizationId, key);
}
