import 'server-only';

import { buildConversationScopedEventId } from '@/lib/conversations/handoffEventId';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';
import { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;
type ConversationAIFailureStage = 'configuration' | 'generation' | 'provider' | 'delivery';

export function buildConversationAIFailureNotification(input: {
  organizationId: string;
  threadId: string;
  eventId: string;
  contactLabel: string;
  stage: ConversationAIFailureStage;
  createdAt: string;
}) {
  return {
    id: buildConversationScopedEventId({
      organizationId: input.organizationId,
      threadId: input.threadId,
      eventId: `ai-failure:${input.eventId}:${input.stage}`,
    }),
    organization_id: input.organizationId,
    type: 'SYSTEM_ALERT',
    title: 'Atendimento automatico precisa de voce',
    message: `${input.contactLabel}: a resposta automatica nao foi concluida. Continue o atendimento manualmente.`.slice(0, 600),
    link: `/platform/tenants/${input.organizationId}/conversations?thread=${encodeURIComponent(input.threadId)}`,
    severity: 'high' as const,
    read_at: null,
    created_at: input.createdAt,
  };
}

export async function recordConversationAIFailure(input: {
  admin: AdminClient;
  organizationId: string;
  threadId: string;
  eventId: string;
  contactLabel: string;
  stage: ConversationAIFailureStage;
  metadata: Record<string, unknown> | null | undefined;
}) {
  const now = new Date().toISOString();
  const nextMetadata = {
    ...buildConversationThreadMetadataUpdate(input.metadata, {
      routingMode: 'human',
      humanLocked: true,
      aiLockedReason: `ai_failure_${input.stage}`,
      handoffRequestedAt: now,
      handoffReason: 'ai_automation_failure',
    }),
    aiFailureStage: input.stage,
    aiFailureAt: now,
  };

  const [threadResult, notificationResult] = await Promise.all([
    input.admin
      .from('conversation_threads')
      .update({ status: 'human_queue', metadata: nextMetadata, updated_at: now })
      .eq('id', input.threadId)
      .eq('organization_id', input.organizationId),
    input.admin
      .from('system_notifications')
      .upsert(buildConversationAIFailureNotification({
        organizationId: input.organizationId,
        threadId: input.threadId,
        eventId: input.eventId,
        contactLabel: input.contactLabel,
        stage: input.stage,
        createdAt: now,
      }), { onConflict: 'id' }),
  ]);

  return {
    ok: !threadResult.error && !notificationResult.error,
    threadError: threadResult.error?.message ?? null,
    notificationError: notificationResult.error?.message ?? null,
  };
}
