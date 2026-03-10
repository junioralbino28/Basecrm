export type ConversationThreadStatus = 'open' | 'waiting' | 'closed';
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
  metadata: Record<string, unknown>;
  sent_at: string;
  created_at: string;
};
