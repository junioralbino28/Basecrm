import { createStaticAdminClient } from '@/lib/supabase/server';
import { readConversationThreadMetadata } from './threadMetadata';
import type {
  ConversationThreadAssignee,
  ConversationThreadListItem,
  ConversationsInboxSummary,
} from './types';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

type ThreadRow = {
  id: string;
  organization_id: string;
  channel_connection_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  title: string;
  contact_name: string | null;
  contact_phone: string | null;
  assigned_user_id: string | null;
  status: 'ai_active' | 'human_queue' | 'human_active' | 'resolved' | 'closed';
  metadata: Record<string, unknown> | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  channel_connection?: {
    id: string;
    name: string;
    status: string | null;
  } | Array<{
    id: string;
    name: string;
    status: string | null;
  }> | null;
  contact?: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | Array<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  }> | null;
  deal?: {
    id: string;
    title: string;
  } | Array<{
    id: string;
    title: string;
  }> | null;
  assignee?: {
    id: string;
    email: string | null;
    first_name?: string | null;
    last_name?: string | null;
    nickname?: string | null;
    avatar_url?: string | null;
    role?: string | null;
  } | Array<{
    id: string;
    email: string | null;
    first_name?: string | null;
    last_name?: string | null;
    nickname?: string | null;
    avatar_url?: string | null;
    role?: string | null;
  }> | null;
};

function getSingleRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function getConversationAssigneeDisplayName(profile: {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
}) {
  const nickname = profile.nickname?.trim();
  if (nickname) return nickname;

  const firstName = profile.first_name?.trim();
  const lastName = profile.last_name?.trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  if (firstName) return firstName;

  const email = profile.email?.trim();
  return email ? email.split('@')[0] : 'Sem nome';
}

function mapConversationThreadRow(
  row: ThreadRow,
  messageCount: number
): ConversationThreadListItem {
  const metadata = readConversationThreadMetadata(row.metadata);
  const assignee = getSingleRelation(row.assignee);

  return {
    ...row,
    metadata,
    channel_connection: getSingleRelation(row.channel_connection),
    contact: getSingleRelation(row.contact),
    deal: getSingleRelation(row.deal),
    assignee: assignee
      ? {
          id: assignee.id,
          display_name: getConversationAssigneeDisplayName(assignee),
          email: assignee.email ?? null,
          avatar_url: assignee.avatar_url ?? null,
          role: assignee.role ?? null,
        }
      : null,
    message_count: messageCount,
    unread_count: metadata.unreadCount ?? 0,
    last_message_preview: metadata.lastMessagePreview ?? null,
    last_message_direction: metadata.lastDirection ?? null,
    last_message_type: metadata.lastMessageType ?? null,
    last_message_author: metadata.lastMessageAuthor ?? null,
    last_message_sent_at: metadata.lastMessageSentAt ?? row.last_message_at ?? null,
    needs_attention:
      (metadata.unreadCount ?? 0) > 0 ||
      row.status === 'human_queue' ||
      row.status === 'human_active' ||
      (!row.assigned_user_id && row.status !== 'resolved' && row.status !== 'closed'),
  };
}

const THREAD_SELECT = `
  id,
  organization_id,
  channel_connection_id,
  contact_id,
  deal_id,
  title,
  contact_name,
  contact_phone,
  assigned_user_id,
  status,
  metadata,
  last_message_at,
  created_at,
  updated_at,
  channel_connection:channel_connections(id, name, status),
  contact:contacts(id, name, email, phone),
  deal:deals(id, title),
  assignee:profiles!conversation_threads_assigned_user_id_fkey(id, email, first_name, last_name, nickname, avatar_url, role)
`;

export async function loadConversationInbox(
  admin: AdminClient,
  tenantId: string
): Promise<{
  threads: ConversationThreadListItem[];
  assignees: ConversationThreadAssignee[];
  summary: ConversationsInboxSummary;
}> {
  const [threadsResult, assigneesResult] = await Promise.all([
    admin
      .from('conversation_threads')
      .select(THREAD_SELECT)
      .eq('organization_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(100),
    admin
      .from('profiles')
      .select('id, email, first_name, last_name, nickname, avatar_url, role')
      .eq('organization_id', tenantId)
      .order('first_name', { ascending: true }),
  ]);

  if (threadsResult.error) throw new Error(threadsResult.error.message);
  if (assigneesResult.error) throw new Error(assigneesResult.error.message);

  const threadRows = (threadsResult.data ?? []) as unknown as ThreadRow[];
  const threadIds = threadRows.map(thread => thread.id);
  const counts = new Map<string, number>();

  if (threadIds.length > 0) {
    const messageResult = await admin
      .from('conversation_messages')
      .select('id, thread_id')
      .eq('organization_id', tenantId)
      .in('thread_id', threadIds);

    if (messageResult.error) throw new Error(messageResult.error.message);

    for (const row of messageResult.data ?? []) {
      const current = counts.get(row.thread_id) ?? 0;
      counts.set(row.thread_id, current + 1);
    }
  }

  const threads = threadRows.map(thread => mapConversationThreadRow(thread, counts.get(thread.id) ?? 0));
  const summary = threads.reduce<ConversationsInboxSummary>(
    (acc, thread) => {
      acc.total += 1;
      acc[thread.status] += 1;
      if (thread.unread_count > 0) acc.unread += 1;
      if (!thread.assigned_user_id) acc.unassigned += 1;
      if (thread.needs_attention) acc.needs_attention += 1;
      return acc;
    },
    {
      total: 0,
      ai_active: 0,
      human_queue: 0,
      human_active: 0,
      resolved: 0,
      closed: 0,
      unread: 0,
      unassigned: 0,
      needs_attention: 0,
    }
  );

  const assignees = ((assigneesResult.data ?? []) as Array<{
    id: string;
    email: string | null;
    first_name?: string | null;
    last_name?: string | null;
    nickname?: string | null;
    avatar_url?: string | null;
    role?: string | null;
  }>).map(profile => ({
    id: profile.id,
    display_name: getConversationAssigneeDisplayName(profile),
    email: profile.email ?? null,
    avatar_url: profile.avatar_url ?? null,
    role: profile.role ?? null,
  }));

  return { threads, assignees, summary };
}

export async function loadConversationThreadInboxItem(
  admin: AdminClient,
  tenantId: string,
  threadId: string
) {
  const threadResult = await admin
    .from('conversation_threads')
    .select(THREAD_SELECT)
    .eq('organization_id', tenantId)
    .eq('id', threadId)
    .maybeSingle();

  if (threadResult.error) throw new Error(threadResult.error.message);
  if (!threadResult.data) return null;

  const countResult = await admin
    .from('conversation_messages')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', tenantId)
    .eq('thread_id', threadId);

  if (countResult.error) throw new Error(countResult.error.message);

  return mapConversationThreadRow(threadResult.data as unknown as ThreadRow, countResult.count ?? 0);
}
