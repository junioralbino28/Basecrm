import { normalizePhoneE164 } from '@/lib/phone';
import { readConversationHandoff, type ConversationHandoff } from './handoff';
import type {
  ConversationMessageDirection,
  ConversationThreadAdClick,
  ConversationThreadEntryPoint,
  ConversationThreadMetadata,
} from './types';

function toSafeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toSafeAdClick(value: unknown): ConversationThreadAdClick | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const click = {
    ctwaClid: toSafeString(source.ctwaClid),
    title: toSafeString(source.title),
    sourceId: toSafeString(source.sourceId),
    sourceApp: toSafeString(source.sourceApp),
    at: toSafeString(source.at),
  };
  return click.ctwaClid || click.sourceId ? click : null;
}

function toSafeEntryPoint(value: unknown): ConversationThreadEntryPoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const delay = source.delaySeconds;
  const entry = {
    app: toSafeString(source.app),
    source: toSafeString(source.source),
    delaySeconds:
      typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 ? Math.floor(delay) : null,
    hadAdReply: source.hadAdReply === true,
    at: toSafeString(source.at),
  };
  // Sem app nem origem não há o que dizer sobre a procedência; `hadAdReply` sozinho não é origem.
  return entry.app || entry.source ? entry : null;
}

function toSafeDirection(value: unknown): ConversationMessageDirection | null {
  return value === 'inbound' || value === 'outbound' || value === 'internal' ? value : null;
}

function toSafeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function readConversationThreadMetadata(value: unknown): ConversationThreadMetadata {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  return {
    ...source,
    provider: toSafeString(source.provider) ?? undefined,
    autoCreated: Boolean(source.autoCreated),
    firstAdClick: toSafeAdClick(source.firstAdClick),
    lastAdClick: toSafeAdClick(source.lastAdClick),
    firstEntryPoint: toSafeEntryPoint(source.firstEntryPoint),
    lastEntryPoint: toSafeEntryPoint(source.lastEntryPoint),
    routingMode:
      source.routingMode === 'ai' || source.routingMode === 'human' || source.routingMode === 'hybrid'
        ? source.routingMode
        : undefined,
    humanLocked: Boolean(source.humanLocked),
    aiLockedReason: toSafeString(source.aiLockedReason),
    handoffRequestedAt: toSafeString(source.handoffRequestedAt),
    handoffReason: toSafeString(source.handoffReason),
    lastHandoff: readConversationHandoff(source.lastHandoff),
    confirmedMeetingActivityId: toSafeString(source.confirmedMeetingActivityId),
    resolvedAt: toSafeString(source.resolvedAt),
    resolvedBy: toSafeString(source.resolvedBy),
    queueAssignedUserId: toSafeString(source.queueAssignedUserId),
    lastEvent: toSafeString(source.lastEvent),
    lastDirection: toSafeDirection(source.lastDirection),
    lastMessagePreview: toSafeString(source.lastMessagePreview),
    lastMessageType: toSafeString(source.lastMessageType),
    lastMessageSentAt: toSafeString(source.lastMessageSentAt),
    lastMessageAuthor: toSafeString(source.lastMessageAuthor),
    lastInboundAt: toSafeString(source.lastInboundAt),
    lastOutboundAt: toSafeString(source.lastOutboundAt),
    unreadCount: toSafeNumber(source.unreadCount),
  };
}

export function buildConversationThreadMetadataUpdate(
  currentValue: unknown,
  update: {
    direction?: ConversationMessageDirection | null;
    preview?: string | null;
    messageType?: string | null;
    sentAt?: string | null;
    authorName?: string | null;
    event?: string | null;
    routingMode?: 'ai' | 'human' | 'hybrid' | null;
    humanLocked?: boolean | null;
    aiLockedReason?: string | null;
    handoffRequestedAt?: string | null;
    handoffReason?: string | null;
    handoff?: ConversationHandoff | null;
    /** `null` limpa (cancelamento); `undefined` mantem o que ja estava. */
    confirmedMeetingActivityId?: string | null;
    resolvedAt?: string | null;
    resolvedBy?: string | null;
    queueAssignedUserId?: string | null;
    unreadCount?: number | null;
    incrementUnread?: boolean;
    provider?: string | null;
    /** Clique de anúncio que veio nesta mensagem (só inbound). */
    adClick?: ConversationThreadAdClick | null;
    /** Ponto de entrada que veio nesta mensagem (só inbound). Separado do anúncio de propósito. */
    entryPoint?: ConversationThreadEntryPoint | null;
  }
): ConversationThreadMetadata {
  const current = readConversationThreadMetadata(currentValue);
  const currentUnreadCount = current.unreadCount ?? 0;
  const nextUnreadCount = update.unreadCount ?? (
    update.incrementUnread
      ? currentUnreadCount + 1
      : currentUnreadCount
  );

  return {
    ...current,
    provider: update.provider ?? current.provider ?? undefined,
    firstAdClick: current.firstAdClick ?? update.adClick ?? null,
    lastAdClick: update.adClick ?? current.lastAdClick ?? null,
    firstEntryPoint: current.firstEntryPoint ?? update.entryPoint ?? null,
    lastEntryPoint: update.entryPoint ?? current.lastEntryPoint ?? null,
    routingMode: update.routingMode ?? current.routingMode ?? undefined,
    humanLocked: update.humanLocked ?? current.humanLocked ?? false,
    aiLockedReason: update.aiLockedReason ?? current.aiLockedReason ?? null,
    handoffRequestedAt: update.handoffRequestedAt ?? current.handoffRequestedAt ?? null,
    handoffReason: update.handoffReason ?? current.handoffReason ?? null,
    lastHandoff: update.handoff ?? current.lastHandoff ?? null,
    // `null` explicito limpa (cancelamento); ausente mantem, para o vinculo com a reuniao
    // confirmada sobreviver ao handoff seguinte.
    confirmedMeetingActivityId: update.confirmedMeetingActivityId === undefined
      ? current.confirmedMeetingActivityId ?? null
      : update.confirmedMeetingActivityId,
    resolvedAt: update.resolvedAt ?? current.resolvedAt ?? null,
    resolvedBy: update.resolvedBy ?? current.resolvedBy ?? null,
    queueAssignedUserId: update.queueAssignedUserId ?? current.queueAssignedUserId ?? null,
    lastEvent: update.event ?? current.lastEvent ?? null,
    lastDirection: update.direction ?? current.lastDirection ?? null,
    lastMessagePreview: update.preview ?? current.lastMessagePreview ?? null,
    lastMessageType: update.messageType ?? current.lastMessageType ?? null,
    lastMessageSentAt: update.sentAt ?? current.lastMessageSentAt ?? null,
    lastMessageAuthor: update.authorName ?? current.lastMessageAuthor ?? null,
    lastInboundAt:
      update.direction === 'inbound'
        ? (update.sentAt ?? current.lastInboundAt ?? null)
        : current.lastInboundAt ?? null,
    lastOutboundAt:
      update.direction === 'outbound'
        ? (update.sentAt ?? current.lastOutboundAt ?? null)
        : current.lastOutboundAt ?? null,
    unreadCount: Math.max(0, nextUnreadCount ?? 0),
  };
}

export function buildConversationPhoneCandidates(value: string | null | undefined) {
  const raw = (value ?? '').trim();
  if (!raw) return [];

  const digitsOnly = raw.replace(/\D+/g, '');
  const normalized = normalizePhoneE164(raw);
  const normalizedDigits = normalizePhoneE164(digitsOnly);

  return Array.from(
    new Set(
      [raw, digitsOnly, normalized, normalizedDigits]
        .map(candidate => candidate?.trim())
        .filter((candidate): candidate is string => Boolean(candidate))
    )
  );
}

export function getCanonicalConversationPhone(value: string | null | undefined) {
  const candidates = buildConversationPhoneCandidates(value);
  return candidates.find(candidate => candidate.startsWith('+')) || candidates[0] || null;
}
