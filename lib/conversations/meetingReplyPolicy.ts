import type { ConversationHandoffType } from './handoff';

type MeetingReplySlot = {
  startAt: string;
  label: string;
};

export function applyMeetingReplyPolicy(input: {
  replyText: string;
  handoffType: ConversationHandoffType | null;
  requestedScheduleAt: string | null;
  requestedScheduleText: string | null | undefined;
  requiresHumanConfirmation: boolean;
  availableSlots: MeetingReplySlot[];
  confirmedSlotIsAvailable?: boolean;
}) {
  let { replyText, handoffType, requestedScheduleAt } = input;

  if (handoffType === 'meeting_confirmed' && input.requiresHumanConfirmation) {
    handoffType = 'meeting_requested';
    replyText = 'Para sábado eu preciso da confirmação da equipe. Registrei sua preferência e vamos confirmar esse horário com você.';
  } else if (handoffType === 'meeting_confirmed' && !input.confirmedSlotIsAvailable) {
    handoffType = 'meeting_requested';
    replyText = input.availableSlots.length > 0
      ? `Esse horario nao esta livre na agenda agora. Posso te oferecer ${input.availableSlots
          .slice(0, 2)
          .map(slot => slot.label)
          .join(' ou ')}.`
      : 'Nao consegui confirmar esse horario na agenda agora. Registrei sua preferencia para o atendimento continuar com voce.';
  }

  if (
    handoffType === 'meeting_requested'
    && input.availableSlots.length > 0
    && !input.requiresHumanConfirmation
  ) {
    handoffType = null;
    requestedScheduleAt = null;
    replyText = `Ainda nao confirmei a reuniao. Posso te oferecer ${input.availableSlots
      .slice(0, 2)
      .map(slot => slot.label)
      .join(' ou ')}. Qual horario funciona melhor para voce?`;
  }

  return { replyText, handoffType, requestedScheduleAt };
}
