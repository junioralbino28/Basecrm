import 'server-only';

import type { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{1,64}$/;

/**
 * Commit da publicação que está respondendo (VERCEL_GIT_COMMIT_SHA, exposto em tempo de execução pela
 * Vercel). Fora dela, ou com valor fora do formato, é nulo: a prova da migração então não confere.
 */
export function lerCommitDaPublicacao(): string | null {
  const valor = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim().toLowerCase();
  return COMMIT_SHA.test(valor) ? valor : null;
}

/**
 * Id do deployment que está respondendo (VERCEL_DEPLOYMENT_ID, exposto em tempo de execução pela Vercel).
 * Um redeploy do mesmo commit é outro deployment, com as variáveis de ambiente do momento em que foi feito.
 * Fora da Vercel, ou fora do formato, é nulo: a prova então não confere.
 */
export function lerDeploymentDaPublicacao(): string | null {
  const valor = (process.env.VERCEL_DEPLOYMENT_ID || '').trim();
  return DEPLOYMENT_ID.test(valor) ? valor : null;
}

export type EventoDeResposta = {
  organizationId: string;
  channelConnectionId: string;
  threadId: string;
  /** Hora em que a última parte foi aceita pela Evolution (não o sent_at, fixado antes do envio). */
  deliveredAt: string;
  promptSha256: string;
  /** Chave que o runtime usou; nula quando o prompt veio de um agente. */
  promptKey: string | null;
  promptSource: 'agent' | 'override' | 'default';
  agentId: string | null;
  agentVersion: number | null;
};

/**
 * Evento de prova da Central de Agentes: uma linha por resposta nativa ENTREGUE (ai_reply_events, só
 * service_role). É o que o script de migração lê para conferir o prompt de hoje antes de ligar um número;
 * mensagem manual ou do n8n não escreve aqui, com o metadata que tiver. Nunca lança: a resposta já saiu.
 */
export async function registrarEventoDeResposta(admin: AdminClient, evento: EventoDeResposta): Promise<void> {
  const contexto = {
    organizationId: evento.organizationId,
    connectionId: evento.channelConnectionId,
    threadId: evento.threadId,
  };
  try {
    const { error } = await admin.from('ai_reply_events').insert({
      organization_id: evento.organizationId,
      channel_connection_id: evento.channelConnectionId,
      thread_id: evento.threadId,
      prompt_sha256: evento.promptSha256,
      prompt_key: evento.promptKey,
      prompt_source: evento.promptSource,
      agent_id: evento.agentId,
      agent_version: evento.agentVersion,
      release_commit: lerCommitDaPublicacao(),
      release_deployment: lerDeploymentDaPublicacao(),
      delivered_at: evento.deliveredAt,
    });
    if (error) {
      console.warn('[Conversation AI] Failed to record reply event', { ...contexto, error: error.message });
    }
  } catch (erro) {
    // Rejeição ou exceção do cliente (rede, cliente quebrado): só avisa. O chamador no webhook trataria um lançamento
    // aqui como falha de ENTREGA de uma resposta que já saiu (5ª rodada do Codex, achado 3).
    console.warn('[Conversation AI] Failed to record reply event', {
      ...contexto,
      error: erro instanceof Error ? erro.message : String(erro),
    });
  }
}
