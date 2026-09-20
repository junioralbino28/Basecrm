import type { ConversationHandoff } from './handoff';
import {
  MEETING_START_INTERVAL_MINUTES,
  MEETING_TARGET_DURATION_MINUTES,
} from './meetingAvailability';

function toSafeText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, maxLength);
}

export function buildConversationMeetingActivity(input: {
  organizationId: string;
  eventId: string;
  contactId: string | null;
  dealId: string | null;
  ownerId: string | null;
  agentName: string;
  handoff: ConversationHandoff;
}) {
  const { handoff } = input;
  if (handoff.type !== 'meeting_confirmed' || !handoff.requestedScheduleAt) return null;

  const contactLabel = handoff.contactName || handoff.contactPhone;
  const preferenceText = handoff.requestedScheduleText?.replace(/[.!?]+$/, '');
  const summaryText = handoff.summary?.replace(/[.!?]+$/, '');
  const preference = preferenceText
    ? `Preferencia informada: ${preferenceText}. `
    : '';
  const summary = summaryText ? `Resumo: ${summaryText}. ` : '';
  const timing = `Duracao prevista: ${MEETING_TARGET_DURATION_MINUTES} minutos. Janela reservada entre inicios: ${MEETING_START_INTERVAL_MINUTES} minutos. `;
  const agentName = toSafeText(input.agentName, 'IA', 80);
  const state = handoff.scheduleStatus === 'pending' ? 'solicitada' : 'confirmada';
  const finalInstruction = handoff.scheduleStatus === 'adjusted'
    ? 'Horario ajustado e confirmado por atendimento humano no CRM.'
    : handoff.scheduleStatus === 'confirmed' && handoff.scheduleUpdatedBy
      ? 'Horario confirmado por atendimento humano no CRM.'
      : handoff.scheduleStatus === 'confirmed'
        ? 'Horario informado como confirmado pelo atendimento automatizado.'
        : `Registrado pela ${agentName}; confirmar antes da reuniao.`;

  return {
    id: input.eventId,
    organization_id: input.organizationId,
    title: `Reuniao ${state} com ${contactLabel}`.slice(0, 200),
    description: `${preference}${summary}${timing}${finalInstruction}`.slice(0, 2000),
    type: 'MEETING',
    date: handoff.requestedScheduleAt,
    completed: false,
    deal_id: input.dealId,
    contact_id: input.contactId,
    owner_id: input.ownerId,
    created_at: handoff.requestedAt,
  };
}
