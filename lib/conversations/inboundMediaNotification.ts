import { buildConversationScopedEventId } from '@/lib/conversations/handoffEventId';
import { INBOUND_MEDIA_LABEL, type InboundMediaKind } from '@/lib/conversations/inboundMedia';

const BURST_WINDOW_MS = 10 * 60_000;

/** Por que o humano está sendo avisado. Sem `problem` = mídia sem texto que ninguém entende (Passo 1). */
export type InboundMediaProblem = 'failed' | 'empty' | 'limit' | 'no_key';

const PROBLEM_TEXT: Record<InboundMediaProblem, string> = {
  failed: 'o entendimento automático falhou',
  empty: 'não havia fala ou conteúdo reconhecível',
  limit: 'o limite de mídias entendidas automaticamente foi atingido',
  no_key: 'falta a chave de IA desta organização para entender',
};

/**
 * Aviso no sino: o lead mandou mídia sem texto numa conversa que está com a IA, e ninguém a leu.
 *
 * Só avisa: NÃO tira a conversa da IA (diferente de `recordConversationAIFailure`, que trava a
 * conversa na fila humana). Uma rajada de figurinhas vira UM aviso: o id é o mesmo por conversa
 * dentro de uma janela de 10 minutos, e o `upsert` regrava a mesma linha.
 */
export function buildInboundMediaNotification(input: {
  organizationId: string;
  threadId: string;
  contactLabel: string;
  kind: InboundMediaKind;
  createdAt: string;
  problem?: InboundMediaProblem;
}) {
  const bucket = Math.floor(new Date(input.createdAt).getTime() / BURST_WINDOW_MS);
  const label = INBOUND_MEDIA_LABEL[input.kind].toLowerCase();

  return {
    id: buildConversationScopedEventId({
      organizationId: input.organizationId,
      threadId: input.threadId,
      eventId: input.problem ? `inbound-media:${input.problem}:${bucket}` : `inbound-media:${bucket}`,
    }),
    organization_id: input.organizationId,
    type: 'SYSTEM_ALERT',
    title: input.problem ? 'Mídia do lead não foi entendida' : 'Lead mandou mídia sem texto',
    message: (input.problem
      ? `${input.contactLabel}: chegou ${label}, mas ${PROBLEM_TEXT[input.problem]}. Veja no aparelho.`
      : `${input.contactLabel}: chegou ${label} sem texto e a resposta automática não respondeu. Veja no aparelho.`
    ).slice(0, 600),
    link: `/platform/tenants/${input.organizationId}/conversations?thread=${encodeURIComponent(input.threadId)}`,
    severity: 'medium' as const,
    read_at: null,
    created_at: input.createdAt,
  };
}
