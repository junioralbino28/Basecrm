import { z } from 'zod';

export const ConversationHandoffTypeSchema = z.enum([
  'call_accepted',
  'meeting_requested',
  'meeting_confirmed',
  'human_requested',
  'high_intent',
  'other',
]);

export type ConversationHandoffType = z.infer<typeof ConversationHandoffTypeSchema>;

export const ConversationHandoffScheduleStatusSchema = z.enum([
  'pending',
  'confirmed',
  'adjusted',
]);

export type ConversationHandoffScheduleStatus = z.infer<
  typeof ConversationHandoffScheduleStatusSchema
>;

export type ConversationHandoff = {
  type: ConversationHandoffType;
  eventId: string | null;
  summary: string | null;
  reason: string;
  requestedAt: string;
  requestedScheduleAt: string | null;
  requestedScheduleText: string | null;
  scheduleStatus: ConversationHandoffScheduleStatus | null;
  scheduleUpdatedAt: string | null;
  scheduleUpdatedBy: string | null;
  contactName: string | null;
  contactPhone: string;
};

const HANDOFF_TITLES: Record<ConversationHandoffType, string> = {
  call_accepted: 'Lead aceitou ligacao',
  meeting_requested: 'Lead quer agendar uma reuniao',
  meeting_confirmed: 'Reuniao confirmada',
  human_requested: 'Lead pediu atendimento humano',
  high_intent: 'Lead com alta intencao',
  other: 'Atendimento da IA precisa de voce',
};

function toSafeText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function toSafeIsoDate(value: unknown) {
  const text = toSafeText(value, 64);
  if (!text || !Number.isFinite(new Date(text).getTime())) return null;
  return new Date(text).toISOString();
}

function toSafeUuid(value: unknown) {
  const text = toSafeText(value, 64);
  if (!text || !z.string().uuid().safeParse(text).success) return null;
  return text;
}

export function buildConversationHandoff(input: {
  type?: ConversationHandoffType | null;
  eventId?: string | null;
  summary?: string | null;
  reason?: string | null;
  requestedAt: string;
  requestedScheduleAt?: string | null;
  requestedScheduleText?: string | null;
  scheduleStatus?: ConversationHandoffScheduleStatus | null;
  scheduleUpdatedAt?: string | null;
  scheduleUpdatedBy?: string | null;
  contactName?: string | null;
  contactPhone: string;
}): ConversationHandoff {
  const requestedAt = toSafeIsoDate(input.requestedAt);
  if (!requestedAt) throw new Error('Data do handoff invalida.');

  const contactPhone = toSafeText(input.contactPhone, 32);
  if (!contactPhone) throw new Error('Telefone do handoff ausente.');

  const type = input.type ?? 'other';
  const isMeeting = type === 'meeting_requested' || type === 'meeting_confirmed';
  const requestedScheduleAt = isMeeting ? toSafeIsoDate(input.requestedScheduleAt) : null;
  const validScheduleAt = requestedScheduleAt && requestedScheduleAt > requestedAt
    ? requestedScheduleAt
    : null;
  const parsedScheduleStatus = ConversationHandoffScheduleStatusSchema.safeParse(
    input.scheduleStatus
  );
  const scheduleStatus = isMeeting
    ? parsedScheduleStatus.success
      ? parsedScheduleStatus.data
      : type === 'meeting_confirmed'
        ? 'confirmed'
        : 'pending'
    : null;

  return {
    type,
    eventId: toSafeUuid(input.eventId),
    summary: toSafeText(input.summary, 500),
    reason: toSafeText(input.reason, 240) ?? 'human_handoff',
    requestedAt,
    requestedScheduleAt: validScheduleAt,
    requestedScheduleText: isMeeting ? toSafeText(input.requestedScheduleText, 160) : null,
    scheduleStatus,
    scheduleUpdatedAt: isMeeting ? toSafeIsoDate(input.scheduleUpdatedAt) : null,
    scheduleUpdatedBy: isMeeting ? toSafeUuid(input.scheduleUpdatedBy) : null,
    contactName: toSafeText(input.contactName, 160),
    contactPhone,
  };
}

export function readConversationHandoff(value: unknown): ConversationHandoff | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const type = ConversationHandoffTypeSchema.safeParse(source.type);
  const requestedAt = toSafeIsoDate(source.requestedAt);
  const contactPhone = toSafeText(source.contactPhone, 32);
  const scheduleStatus = ConversationHandoffScheduleStatusSchema.safeParse(source.scheduleStatus);

  if (!type.success || !requestedAt || !contactPhone) return null;

  return {
    type: type.data,
    eventId: toSafeUuid(source.eventId),
    summary: toSafeText(source.summary, 500),
    reason: toSafeText(source.reason, 240) ?? 'human_handoff',
    requestedAt,
    requestedScheduleAt:
      type.data === 'meeting_requested' || type.data === 'meeting_confirmed'
        ? (() => {
            const scheduleAt = toSafeIsoDate(source.requestedScheduleAt);
            return scheduleAt && scheduleAt > requestedAt ? scheduleAt : null;
          })()
        : null,
    requestedScheduleText:
      type.data === 'meeting_requested' || type.data === 'meeting_confirmed'
        ? toSafeText(source.requestedScheduleText, 160)
        : null,
    scheduleStatus:
      type.data === 'meeting_requested' || type.data === 'meeting_confirmed'
        ? scheduleStatus.success
          ? scheduleStatus.data
          : type.data === 'meeting_confirmed'
            ? 'confirmed'
            : 'pending'
        : null,
    scheduleUpdatedAt:
      type.data === 'meeting_requested' || type.data === 'meeting_confirmed'
        ? toSafeIsoDate(source.scheduleUpdatedAt)
        : null,
    scheduleUpdatedBy:
      type.data === 'meeting_requested' || type.data === 'meeting_confirmed'
        ? toSafeUuid(source.scheduleUpdatedBy)
        : null,
    contactName: toSafeText(source.contactName, 160),
    contactPhone,
  };
}

export function buildConversationHandoffNotification(input: {
  organizationId: string;
  threadId: string;
  eventId: string;
  handoff: ConversationHandoff;
}) {
  const { organizationId, threadId, eventId, handoff } = input;
  const contactLabel = handoff.contactName || handoff.contactPhone;
  const context = handoff.summary || handoff.reason;
  const scheduleContext = handoff.requestedScheduleText
    ? ` Horario pedido: ${handoff.requestedScheduleText}.`
    : '';

  return {
    id: eventId,
    organization_id: organizationId,
    type: 'SYSTEM_ALERT',
    title: HANDOFF_TITLES[handoff.type],
    message: `${contactLabel}: ${context}.${scheduleContext}`.replace('..', '.').slice(0, 600),
    link: `/platform/tenants/${organizationId}/conversations?thread=${encodeURIComponent(threadId)}`,
    severity: 'high' as const,
    read_at: null,
    created_at: handoff.requestedAt,
  };
}
