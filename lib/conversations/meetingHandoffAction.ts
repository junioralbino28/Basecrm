import { z } from 'zod';
import { buildConversationHandoff, type ConversationHandoff } from './handoff';
import { buildConversationScopedEventId } from './handoffEventId';

export const ConversationMeetingActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('confirm_meeting') }).strict(),
  z.object({
    type: z.literal('adjust_meeting'),
    scheduledAt: z.string().datetime({ offset: true }),
  }).strict(),
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
}) {
  if (input.handoff.type !== 'meeting_requested' && input.handoff.type !== 'meeting_confirmed') {
    throw new Error('Este handoff nao e um pedido de reuniao.');
  }

  const action = ConversationMeetingActionSchema.parse(input.action);
  const performedAt = normalizedIso(input.performedAt, 'Data da acao invalida.');
  const scheduledAt = action.type === 'confirm_meeting'
    ? input.handoff.requestedScheduleAt
    : normalizedIso(action.scheduledAt, 'Horario da reuniao invalido.');

  if (!scheduledAt) throw new Error('Defina um horario exato antes de confirmar.');

  const normalizedScheduleAt = normalizedIso(scheduledAt, 'Horario da reuniao invalido.');
  if (normalizedScheduleAt <= performedAt) {
    throw new Error('O horario da reuniao precisa estar no futuro.');
  }

  const activityId = input.handoff.eventId || buildConversationScopedEventId({
    organizationId: input.organizationId,
    threadId: input.threadId,
    eventId: `legacy:${input.handoff.requestedAt}`,
  });

  return {
    activityId,
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
