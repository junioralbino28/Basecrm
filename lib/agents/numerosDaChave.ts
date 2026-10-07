import type { SupabaseClient } from '@supabase/supabase-js';
import { isConversationAIPromptKey, resolveConversationAIAgentConfig } from '@/lib/conversations/aiAgentConfig';
import { lerConexoes } from './migracaoAgentes';

export type ResumoDaChave = {
  organizationId: string;
  numerosDaChave: number;
  numerosComAgente: number;
  agentes: Array<{ id: string; nome: string }>;
};

/**
 * Quantos números (Evolution) da organização respondem com esta chave de prompt e quantos deles estão ligados a um
 * agente (SPEC, "Rotas antigas depois de ligar"). Número ligado usa a versão publicada do agente: editar a chave não muda
 * nada nele. A chave efetiva sai da mesma regra do runtime (resolveConversationAIAgentConfig): vazia = a padrão,
 * inválida = nenhuma. channel_connections não tem policy para authenticated: chave de serviço, filtrada pela organização.
 */
export async function resumirNumerosDaChave(
  admin: SupabaseClient,
  organizationId: string,
  promptKey: string,
): Promise<ResumoDaChave | null> {
  if (!isConversationAIPromptKey(promptKey)) return null;
  // Em páginas por id: uma leitura só seria cortada no limite do PostgREST, sem erro, e a conta sairia menor.
  const conexoes = await lerConexoes(admin, organizationId);
  const daChave = conexoes.filter(
    (c) => resolveConversationAIAgentConfig(c.config as Record<string, unknown> | null).promptKey === promptKey,
  );
  const ids = [...new Set(daChave.map((c) => c.ai_agent_id as string | null).filter((id): id is string => Boolean(id)))];
  let agentes: Array<{ id: string; nome: string }> = [];
  if (ids.length > 0) {
    const lidos = await admin.from('ai_agents').select('id, name').eq('organization_id', organizationId).in('id', ids);
    if (lidos.error) throw new Error(`ai_agents: ${lidos.error.message}`);
    agentes = (lidos.data ?? []).map((a) => ({ id: a.id as string, nome: a.name as string }));
  }
  return {
    organizationId,
    numerosDaChave: daChave.length,
    numerosComAgente: daChave.filter((c) => Boolean(c.ai_agent_id)).length,
    agentes,
  };
}
