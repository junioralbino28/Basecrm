import type { ConversationHandoff } from './handoff';

export type ConversationThreadStatus =
  | 'ai_active'
  | 'human_queue'
  | 'human_active'
  | 'resolved'
  | 'closed';
export type ConversationMessageDirection = 'inbound' | 'outbound' | 'internal';

export type ConversationThread = {
  id: string;
  organization_id: string;
  channel_connection_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  title: string;
  contact_name: string | null;
  contact_phone: string | null;
  assigned_user_id: string | null;
  status: ConversationThreadStatus;
  metadata: Record<string, unknown>;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  id: string;
  thread_id: string;
  organization_id: string;
  direction: ConversationMessageDirection;
  message_type: string;
  author_name: string | null;
  content: string;
  metadata: ConversationMessageMetadata;
  sent_at: string;
  created_at: string;
};

export type ConversationMessageMetadata = {
  provider?: string;
  event?: string | null;
  provider_message_id?: string | null;
  raw_payload?: unknown;
  delivery_status?: 'sent' | 'failed' | 'pending' | null;
  delivery_error?: string | null;
  delivery_provider?: string | null;
  delivery_attempt?: string | null;
  delivery_raw?: unknown;
  [key: string]: unknown;
};

/** Resumo do clique de anúncio guardado na conversa (o histórico completo fica em lead_source_attributions). */
export type ConversationThreadAdClick = {
  ctwaClid: string | null;
  title: string | null;
  sourceId: string | null;
  sourceApp: string | null;
  at: string | null;
};

/**
 * De onde a pessoa saiu para abrir a conversa quando NÃO houve anúncio pago — botão do perfil do
 * Instagram, CTA de uma publicação, um Reels orgânico. Antes de 23/09/2026 isso era descartado e
 * essas conversas entravam sem origem nenhuma.
 *
 * ⚠️ Nunca confundir com `ConversationThreadAdClick`: aqui não existe `ctwaClid`, então a Meta não
 * liga esta conversa a anúncio nenhum e ela não pode ser exibida como "veio do anúncio X".
 */
export type ConversationThreadEntryPoint = {
  app: string | null;
  source: string | null;
  delaySeconds: number | null;
  hadAdReply: boolean;
  at: string | null;
};

export type ConversationThreadMetadata = {
  provider?: string;
  autoCreated?: boolean;
  /** Primeiro clique de anúncio visto nesta conversa; nunca é sobrescrito. */
  firstAdClick?: ConversationThreadAdClick | null;
  /** Clique de anúncio mais recente (a pessoa pode voltar por outro anúncio). */
  lastAdClick?: ConversationThreadAdClick | null;
  /** Primeiro ponto de entrada visto; nunca é sobrescrito. */
  firstEntryPoint?: ConversationThreadEntryPoint | null;
  /** Ponto de entrada mais recente. */
  lastEntryPoint?: ConversationThreadEntryPoint | null;
  routingMode?: 'ai' | 'human' | 'hybrid' | null;
  humanLocked?: boolean;
  aiLockedReason?: string | null;
  handoffRequestedAt?: string | null;
  handoffReason?: string | null;
  lastHandoff?: ConversationHandoff | null;
  /**
   * Activity da reuniao ja confirmada nesta conversa. Sobrevive ao handoff seguinte (que
   * sobrescreve `lastHandoff`) para que remarcar/cancelar recaia sobre a MESMA reuniao — e
   * sobre o mesmo evento do Google — em vez de deixar a antiga orfa.
   */
  confirmedMeetingActivityId?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  queueAssignedUserId?: string | null;
  lastEvent?: string | null;
  lastDirection?: ConversationMessageDirection | null;
  lastMessagePreview?: string | null;
  lastMessageType?: string | null;
  lastMessageSentAt?: string | null;
  lastMessageAuthor?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  unreadCount?: number;
  [key: string]: unknown;
};

export type ConversationThreadAssignee = {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  role?: string | null;
};

export type ConversationThreadContact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};

export type ConversationThreadDeal = {
  id: string;
  title: string;
};

export type ConversationThreadChannelConnection = {
  id: string;
  name: string;
  status: string | null;
};

export type ConversationThreadListItem = ConversationThread & {
  metadata: ConversationThreadMetadata;
  channel_connection: ConversationThreadChannelConnection | null;
  contact: ConversationThreadContact | null;
  deal: ConversationThreadDeal | null;
  assignee: ConversationThreadAssignee | null;
  message_count: number;
  unread_count: number;
  last_message_preview: string | null;
  last_message_direction: ConversationMessageDirection | null;
  last_message_type: string | null;
  last_message_author: string | null;
  last_message_sent_at: string | null;
  needs_attention: boolean;
};

export type ConversationsInboxSummary = {
  total: number;
  ai_active: number;
  human_queue: number;
  human_active: number;
  resolved: number;
  closed: number;
  unread: number;
  unassigned: number;
  needs_attention: number;
};
