import type { SupabaseClient } from '@supabase/supabase-js';

export type VersaoPublicadaDoAgente = {
  agentId: string;
  versionId: string;
  version: number;
  prompt: string;
  model: string | null;
};

export type ResultadoVersaoPublicada =
  | { ok: true; versao: VersaoPublicadaDoAgente }
  | { ok: false; motivo: 'agent_not_found' | 'agent_not_published' | 'agent_read_error' };

/**
 * Versão publicada do agente, sempre filtrando pela organização (G4). Duas leituras simples em vez de
 * embed do PostgREST: ai_agents e ai_agent_versions têm duas relações entre si (agente → versões e o
 * ponteiro da publicada), e o embed ficaria ambíguo.
 */
export async function carregarVersaoPublicada(
  admin: SupabaseClient,
  input: { organizationId: string; agentId: string },
): Promise<ResultadoVersaoPublicada> {
  const agente = await admin
    .from('ai_agents')
    .select('id, organization_id, published_version_id')
    .eq('id', input.agentId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (agente.error) return { ok: false, motivo: 'agent_read_error' };
  if (!agente.data) return { ok: false, motivo: 'agent_not_found' };

  const publicadaId = (agente.data as { published_version_id: string | null }).published_version_id;
  if (!publicadaId) return { ok: false, motivo: 'agent_not_published' };

  const versao = await admin
    .from('ai_agent_versions')
    .select('id, agent_id, organization_id, version, prompt, model')
    .eq('id', publicadaId)
    .eq('agent_id', input.agentId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (versao.error) return { ok: false, motivo: 'agent_read_error' };

  const linha = versao.data as { id: string; version: number; prompt: string | null; model: string | null } | null;
  if (!linha || typeof linha.prompt !== 'string' || linha.prompt.length === 0) {
    return { ok: false, motivo: 'agent_not_published' };
  }

  return {
    ok: true,
    versao: {
      agentId: input.agentId,
      versionId: linha.id,
      version: linha.version,
      prompt: linha.prompt,
      model: linha.model ?? null,
    },
  };
}
