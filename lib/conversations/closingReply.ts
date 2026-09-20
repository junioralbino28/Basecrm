import { readConversationHandoff, type ConversationHandoff } from '@/lib/conversations/handoff';
import { formatLocalDateTimeForPrompt } from '@/lib/conversations/aiPromptContext';

/**
 * Encerramento depois do handoff.
 *
 * Decisao do Junior (20/09/2026): "deixar lead no vacuo nunca e bom". Quando a IA encaminha a
 * conversa para a fila humana (reuniao confirmada, pedido de pessoa, ligacao, alta intencao) e o
 * lead escreve de novo antes de alguem assumir, ela ainda responde curto, agradece e encerra, sem
 * corte seco e sem prolongar. Limites: so em `human_queue` (nunca `human_active`, que e um humano
 * falando), so em handoff feito pela propria IA (nao quando um humano moveu a conversa nem em
 * falha da IA), no maximo CLOSING_REPLY_MAX respostas e dentro de CLOSING_REPLY_WINDOW_MINUTES.
 */
export const CLOSING_REPLY_MAX = 2;
export const CLOSING_REPLY_WINDOW_MINUTES = 60;
export const DEFAULT_MEETING_CHANNEL_TEXT = 'a combinar por aqui antes do horario';

const MAX_MEETING_CHANNEL_TEXT_LENGTH = 200;

/** `config.meetingChannelText` do numero ("videochamada pelo Google Meet, o link chega por aqui"). */
export function readMeetingChannelText(config: Record<string, unknown> | null | undefined) {
  const raw = typeof config?.meetingChannelText === 'string' ? config.meetingChannelText.trim() : '';
  return raw ? raw.slice(0, MAX_MEETING_CHANNEL_TEXT_LENGTH) : DEFAULT_MEETING_CHANNEL_TEXT;
}

export function readClosingRepliesUsed(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.aiClosingReplies;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export type ClosingReplyEligibility =
  | { eligible: true; handoff: ConversationHandoff; repliesUsed: number }
  | { eligible: false; reason: 'status' | 'sem_handoff' | 'handoff_humano' | 'falha_da_ia' | 'janela_expirada' | 'limite' };

export function resolveClosingReplyEligibility(input: {
  status: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
  now?: string;
}): ClosingReplyEligibility {
  const metadata = input.metadata || {};
  if (input.status !== 'human_queue') return { eligible: false, reason: 'status' };

  const handoff = readConversationHandoff(metadata.lastHandoff);
  if (!handoff) return { eligible: false, reason: 'sem_handoff' };

  // O handoff da propria IA grava handoffRequestedAt e lastHandoff.requestedAt no mesmo instante.
  // Um humano que move a conversa para a fila grava um handoffRequestedAt novo sem tocar no
  // lastHandoff: ai a IA fica quieta.
  const handoffRequestedAt = typeof metadata.handoffRequestedAt === 'string'
    ? new Date(metadata.handoffRequestedAt).getTime()
    : Number.NaN;
  const handoffAt = new Date(handoff.requestedAt).getTime();
  if (!Number.isFinite(handoffRequestedAt) || !Number.isFinite(handoffAt) || Math.abs(handoffRequestedAt - handoffAt) > 1000) {
    return { eligible: false, reason: 'handoff_humano' };
  }

  const handoffReason = typeof metadata.handoffReason === 'string' ? metadata.handoffReason : '';
  const lockedReason = typeof metadata.aiLockedReason === 'string' ? metadata.aiLockedReason : '';
  if (handoffReason === 'ai_automation_failure' || lockedReason.startsWith('ai_failure_')) {
    return { eligible: false, reason: 'falha_da_ia' };
  }

  const now = new Date(input.now ?? new Date().toISOString()).getTime();
  if (now - handoffAt > CLOSING_REPLY_WINDOW_MINUTES * 60_000) {
    return { eligible: false, reason: 'janela_expirada' };
  }

  const repliesUsed = readClosingRepliesUsed(metadata);
  if (repliesUsed >= CLOSING_REPLY_MAX) return { eligible: false, reason: 'limite' };

  return { eligible: true, handoff, repliesUsed };
}

/** Texto que entra no prompt como "situacao da conversa" durante o encerramento. */
export function buildClosingStageContext(input: {
  handoff: ConversationHandoff;
  repliesUsed: number;
  meetingHostName: string;
  timezone: string;
  meetingChannelText: string;
}) {
  const host = input.meetingHostName;
  const when = input.handoff.requestedScheduleAt
    ? formatLocalDateTimeForPrompt(input.handoff.requestedScheduleAt, input.timezone)
    : 'o horario combinado';
  let situation: string;
  switch (input.handoff.type) {
    case 'meeting_confirmed':
      situation = `ENCERRAMENTO. A reuniao ja esta confirmada para ${when}, conduzida por ${host}; formato da reuniao: ${input.meetingChannelText}.`;
      break;
    case 'meeting_requested':
      situation = `ENCERRAMENTO. O pedido de reuniao (${input.handoff.requestedScheduleText || 'horario a confirmar'}) ja foi registrado e ${host} confirma por aqui.`;
      break;
    case 'call_accepted':
      situation = `ENCERRAMENTO. O lead pediu ligacao; ${host} ja foi avisado e vai ligar.`;
      break;
    case 'human_requested':
      situation = `ENCERRAMENTO. O lead pediu uma pessoa; ${host} ja foi avisado e assume por aqui.`;
      break;
    default:
      situation = `ENCERRAMENTO. A conversa ja foi encaminhada para ${host}, que assume por aqui.`;
  }
  const comoFunciona = input.handoff.type === 'meeting_confirmed' || input.handoff.type === 'meeting_requested'
    ? ` Como funciona: uma conversa de cerca de 40 minutos conduzida por ${host}, para ele olhar o cenario do lead (anuncios, WhatsApp e comercial) e mostrar onde estao as perdas; formato da reuniao: ${input.meetingChannelText}.`
    : '';
  const fechamento = input.repliesUsed >= CLOSING_REPLY_MAX - 1
    ? ' Esta e a sua ultima mensagem nesta conversa: responda o que foi perguntado e despeca-se com cordialidade, dizendo que ' + host + ' segue com o lead por aqui.'
    : ` Depois de responder, feche deixando a porta aberta (por exemplo: "qualquer duvida ate la, me chama por aqui"); nao seja seco.`;
  return `${situation}${comoFunciona} Responda de forma completa e concreta ao que o lead perguntou, usando so as informacoes acima (nunca invente formato, link ou horario); em 2 ou 3 frases, sem abrir assunto novo, sem oferecer horario nem ligacao. Voce nao estara na reuniao: nunca diga "te vejo", "nos vemos" ou "ate la" em primeira pessoa; quem conduz e ${host}.${fechamento}`;
}

/**
 * Situacao para a IA quando a conversa esta com ela, mas ja existe reuniao confirmada (o lead voltou
 * depois do handoff, ou a conversa foi resolvida e reaberta). Sem isto a IA reoferece horarios e refaz
 * o diagnostico, como aconteceu na 2a janela de 20/09. Null quando nao ha reuniao futura confirmada.
 */
export function buildConfirmedMeetingStageContext(input: {
  metadata: Record<string, unknown> | null | undefined;
  meetingHostName: string;
  timezone: string;
  meetingChannelText: string;
  now?: string;
}) {
  const handoff = readConversationHandoff(input.metadata?.lastHandoff);
  if (!handoff || handoff.type !== 'meeting_confirmed' || !handoff.requestedScheduleAt) return null;
  if (handoff.scheduleStatus === 'pending') return null;
  const at = new Date(handoff.requestedScheduleAt).getTime();
  const now = new Date(input.now ?? new Date().toISOString()).getTime();
  if (!Number.isFinite(at) || at < now) return null;
  const when = formatLocalDateTimeForPrompt(handoff.requestedScheduleAt, input.timezone);
  return `REUNIAO JA CONFIRMADA para ${when}, conduzida por ${input.meetingHostName}. `
    + `Como funciona: cerca de 40 minutos, ${input.meetingHostName} olha o cenario do lead (anuncios, WhatsApp e comercial) e mostra onde estao as perdas; formato da reuniao: ${input.meetingChannelText}. `
    + 'Nao ofereca outros horarios nem refaca o diagnostico; responda o que o lead precisar de forma completa e concreta, usando so essas informacoes, e feche deixando a porta aberta. '
    + 'Se ele quiser remarcar ou cancelar, registre com shouldHandoff=true e handoffType=meeting_requested.';
}

/** Contabiliza uma resposta de encerramento na metadata da conversa. */
export function buildClosingReplyMetadata(
  metadata: Record<string, unknown>,
  input: { sentAt: string; repliesUsed: number },
) {
  return {
    ...metadata,
    aiClosingReplies: input.repliesUsed + 1,
    aiClosingLastAt: input.sentAt,
  };
}
