import { createHash } from 'node:crypto';
import { PENDING_REVIEW_WARNING } from './dispatchConversationOutbound';

/**
 * Idempotencia do envio manual: o vinculo entre a chave e o PEDIDO LOGICO.
 *
 * Sem o vinculo, a mesma chave com um corpo diferente reenviava nada (o dispatcher segura), mas a
 * rota ainda atualizava o preview da conversa com o corpo do SEGUNDO POST — WhatsApp e mensagem
 * gravada diziam "A", a lista dizia "B".
 *
 * O fingerprint cobre so o pedido logico: tenant, thread, ator, direcao, corpo, anexo e modo de
 * envio. Configuracao da assinatura e nome do atendente ficam FORA de proposito — se o interruptor
 * mudar entre a 1a tentativa e o retry, o retry continua sendo o MESMO pedido e devolve a tentativa
 * original, nunca um segundo envio.
 */

export type PedidoDeEnvio = {
  organizationId: string;
  threadId: string;
  atorId: string;
  direction: string;
  content: string;
  attachmentPath: string | null;
  sendExternal: boolean;
};

export function fingerprintDoPedido(pedido: PedidoDeEnvio) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        pedido.organizationId,
        pedido.threadId,
        pedido.atorId,
        pedido.direction,
        pedido.content,
        pedido.attachmentPath,
        pedido.sendExternal,
      ]),
    )
    .digest('hex');
}

type LinhaExistente = {
  thread_id?: unknown;
  content?: unknown;
  metadata?: unknown;
};

/**
 * A linha gravada e o pedido que chegou agora sao a MESMA intencao?
 * Linha legada sem `metadata.intencao` (chaves manual:<uuid> geradas no servidor, que nunca voltam
 * num segundo POST): compara pela thread — ramo praticamente morto, mantido para nao tratar legado
 * como conflito.
 */
export function conferirReplay(linha: LinhaExistente, pedido: PedidoDeEnvio): 'igual' | 'diferente' {
  const metadata = (linha.metadata ?? null) as { intencao?: { hash?: unknown } } | null;
  const hashGravado = metadata?.intencao?.hash;
  if (typeof hashGravado === 'string') {
    return hashGravado === fingerprintDoPedido(pedido) ? 'igual' : 'diferente';
  }
  return linha.thread_id === pedido.threadId ? 'igual' : 'diferente';
}

/** O aviso que acompanha um replay diz o estado REAL da tentativa anterior — nunca "reenviado". */
export function warningDoReplay(status: string | null | undefined, erro: string | null | undefined) {
  if (status === 'pending') return PENDING_REVIEW_WARNING;
  if (status === 'failed') return erro || 'A tentativa anterior falhou antes de chegar ao WhatsApp.';
  if (status === 'unknown') return erro || 'Entrega não confirmada pela Evolution.';
  return null;
}
