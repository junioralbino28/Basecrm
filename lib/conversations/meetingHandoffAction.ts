import { z } from 'zod';
import { buildConversationHandoff, type ConversationHandoff } from './handoff';
import { buildConversationScopedEventId } from './handoffEventId';

export const ConversationMeetingActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('confirm_meeting') }).strict(),
  z.object({
    type: z.literal('adjust_meeting'),
    scheduledAt: z.string().datetime({ offset: true }),
  }).strict(),
  // Cancelar: a reuniao deixa de existir no CRM e o evento espelho sai do Google. Sem isso, o
  // lead que desiste deixava a atividade marcada para sempre e o evento vivo na agenda.
  z.object({ type: z.literal('cancel_meeting') }).strict(),
]);

export type ConversationMeetingAction = z.infer<typeof ConversationMeetingActionSchema>;

function normalizedIso(value: string, message: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(message);
  return new Date(timestamp).toISOString();
}

export function resolveConversationMeetingAction(input: {
  organizationId: string;
  threadId: string;
  handoff: ConversationHandoff;
  action: ConversationMeetingAction;
  performedAt: string;
  performedBy: string;
  /**
   * Reuniao ja confirmada nesta conversa (`metadata.confirmedMeetingActivityId`). Quando existe,
   * remarcar/cancelar recai sobre a MESMA activity — e, por tabela, sobre o MESMO evento do
   * Google. Sem isso, o pedido de remarcacao nasce com eventId novo e o evento antigo fica
   * orfao na agenda, com o lembrete saindo no horario errado (achado bloqueante, 22/09).
   */
  previousActivityId?: string | null;
}) {
  if (input.handoff.type !== 'meeting_requested' && input.handoff.type !== 'meeting_confirmed') {
    throw new Error('Este handoff nao e um pedido de reuniao.');
  }

  const action = ConversationMeetingActionSchema.parse(input.action);
  const performedAt = normalizedIso(input.performedAt, 'Data da acao invalida.');

  const activityId = input.previousActivityId
    || input.handoff.eventId
    || buildConversationScopedEventId({
      organizationId: input.organizationId,
      threadId: input.threadId,
      eventId: `legacy:${input.handoff.requestedAt}`,
    });

  if (action.type === 'cancel_meeting') {
    return {
      activityId,
      cancelled: true as const,
      // Sem reuniao marcada: o handoff deixa de ser de reuniao. O card CONTINUA na tela (ele e
      // renderizado para qualquer `lastHandoff`) e mostra "Reunião cancelada", sem oferecer
      // confirmar/ajustar/cancelar — por isso `scheduleUpdatedAt` precisa sobreviver.
      handoff: buildConversationHandoff({
        ...input.handoff,
        type: 'other',
        eventId: activityId,
        reason: 'meeting_cancelled',
        requestedScheduleAt: null,
        requestedScheduleText: null,
        scheduleStatus: null,
        scheduleUpdatedAt: performedAt,
        scheduleUpdatedBy: input.performedBy,
      }),
    };
  }

  const scheduledAt = action.type === 'confirm_meeting'
    ? input.handoff.requestedScheduleAt
    : normalizedIso(action.scheduledAt, 'Horario da reuniao invalido.');

  if (!scheduledAt) throw new Error('Defina um horario exato antes de confirmar.');

  const normalizedScheduleAt = normalizedIso(scheduledAt, 'Horario da reuniao invalido.');
  if (normalizedScheduleAt <= performedAt) {
    throw new Error('O horario da reuniao precisa estar no futuro.');
  }

  return {
    activityId,
    cancelled: false as const,
    handoff: buildConversationHandoff({
      ...input.handoff,
      type: 'meeting_confirmed',
      eventId: activityId,
      requestedScheduleAt: normalizedScheduleAt,
      scheduleStatus: action.type === 'adjust_meeting' ? 'adjusted' : 'confirmed',
      scheduleUpdatedAt: performedAt,
      scheduleUpdatedBy: input.performedBy,
    }),
  };
}
