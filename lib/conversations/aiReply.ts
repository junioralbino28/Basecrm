import 'server-only';

import { generateObject } from 'ai';
import { z } from 'zod';
import { AI_DEFAULT_MODELS } from '@/lib/ai/defaults';
import { isAIFeatureEnabled } from '@/lib/ai/features/server';
import { getModel, type AIProvider } from '@/lib/ai/config';
import { getResolvedPrompt } from '@/lib/ai/prompts/server';
import { renderPromptTemplate } from '@/lib/ai/prompts/render';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { loadConversationThreadInboxItem } from '@/lib/conversations/server';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';
import { toWhatsAppPhone } from '@/lib/phone';
import { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

type ChannelConnectionRow = {
  id: string;
  organization_id: string;
  name: string;
  config: Record<string, unknown> | null;
};

type ConversationThreadRow = {
  id: string;
  organization_id: string;
  channel_connection_id: string | null;
  contact_phone: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  assigned_user_id: string | null;
};

type RecentMessage = {
  direction?: string | null;
  author_name?: string | null;
  content?: string | null;
  sent_at?: string | null;
};

const ConversationAutoReplySchema = z.object({
  replyText: z.string().min(1).max(4000),
  summary: z.string().max(2000).nullable().optional(),
  shouldHandoff: z.boolean().optional().default(false),
  handoffReason: z.string().max(240).nullable().optional(),
});

export type ConversationAIReplyPayload = {
  threadId: string;
  replyText: string;
  summary?: string | null;
  shouldHandoff?: boolean;
  handoffReason?: string | null;
  authorName?: string;
  metadata?: Record<string, unknown>;
  automationSource?: string;
};

function formatRecentMessages(messages: RecentMessage[]) {
  if (!messages.length) {
    return 'Sem historico anterior. Considere que pode ser o primeiro contato.';
  }

  return messages
    .map((message) => {
      const direction =
        message.direction === 'outbound'
          ? 'CRM'
          : message.direction === 'internal'
            ? 'INTERNO'
            : 'LEAD';
      const author = String(message.author_name || direction).trim();
      const content = String(message.content || '').trim() || '[sem texto]';
      const sentAt = String(message.sent_at || '').trim();
      return `- ${direction} | ${author}${sentAt ? ` | ${sentAt}` : ''}: ${content}`;
    })
    .join('\n');
}

export async function generateConversationAutoReply(params: {
  admin: AdminClient;
  organizationId: string;
  contactName: string | null;
  contactPhone: string;
  recentMessages: RecentMessage[];
}) {
  const { admin, organizationId, contactName, contactPhone, recentMessages } = params;

  const enabled = await isAIFeatureEnabled(admin as any, organizationId, 'ai_conversation_auto_reply');
  if (!enabled) {
    return { ok: false as const, reason: 'feature_disabled' };
  }

  const { data: orgSettings, error: orgError } = await admin
    .from('organization_settings')
    .select('ai_enabled, ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (orgError) throw new Error(orgError.message);

  const aiEnabled = typeof orgSettings?.ai_enabled === 'boolean' ? orgSettings.ai_enabled : true;
  if (!aiEnabled) {
    return { ok: false as const, reason: 'ai_disabled' };
  }

  const provider = (orgSettings?.ai_provider ?? 'google') as AIProvider;
  const apiKey =
    provider === 'google'
      ? (orgSettings?.ai_google_key ?? null)
      : provider === 'openai'
        ? (orgSettings?.ai_openai_key ?? null)
        : (orgSettings?.ai_anthropic_key ?? null);

  if (!apiKey) {
    return { ok: false as const, reason: 'missing_api_key' };
  }

  const { data: organization } = await admin
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .maybeSingle();

  const model = getModel(
    provider,
    apiKey,
    orgSettings?.ai_model || AI_DEFAULT_MODELS[provider] || AI_DEFAULT_MODELS.google
  );

  const resolvedPrompt = await getResolvedPrompt(
    admin as any,
    organizationId,
    'task_conversations_whatsapp_auto_reply'
  );

  const fallbackPrompt =
    `Voce e Julia, assistente virtual do consultorio da Dra. Jessica Barros. ` +
    `Atenda o lead de forma curta, natural, humana e objetiva, em portugues do Brasil, ` +
    `com foco em qualificar e conduzir para avaliacao. Nunca informe preco fechado, ` +
    `nunca faca diagnostico, faca uma pergunta por vez e encaminhe para humano quando o lead pedir humano, quando houver remarcacao, no-show ou necessidade de follow-up humano. ` +
    `Retorne apenas um objeto com replyText, summary, shouldHandoff e handoffReason.`;

  const prompt = renderPromptTemplate(resolvedPrompt?.content || fallbackPrompt, {
    organizationName: organization?.name || 'Clinica',
    contactName: contactName || 'Lead',
    contactPhone,
    recentMessagesText: formatRecentMessages(recentMessages),
  });

  const result = await generateObject({
    model,
    maxRetries: 2,
    schema: ConversationAutoReplySchema,
    prompt,
  });

  return {
    ok: true as const,
    source: resolvedPrompt?.source || 'default',
    object: {
      replyText: result.object.replyText.trim(),
      summary: result.object.summary?.trim() || null,
      shouldHandoff: Boolean(result.object.shouldHandoff),
      handoffReason: result.object.handoffReason?.trim() || null,
    },
  };
}

export async function executeConversationAIReply(params: {
  admin: AdminClient;
  connection: ChannelConnectionRow;
  payload: ConversationAIReplyPayload;
}) {
  const { admin, connection, payload } = params;

  const threadResult = await admin
    .from('conversation_threads')
    .select('id, organization_id, channel_connection_id, contact_phone, status, metadata, assigned_user_id')
    .eq('id', payload.threadId)
    .eq('organization_id', connection.organization_id)
    .eq('channel_connection_id', connection.id)
    .maybeSingle();

  if (threadResult.error) throw new Error(threadResult.error.message);
  if (!threadResult.data) throw new Error('Thread nao encontrada');

  const thread = threadResult.data as ConversationThreadRow;
  if (thread.status === 'human_active' || thread.status === 'human_queue') {
    return { ok: true as const, ignored: true as const, reason: 'thread_em_atendimento_humano' };
  }

  const instanceName = String((connection.config || {}).instanceName || '').trim();
  const resolved = await resolveEvolutionCredentials({
    admin,
    tenantId: connection.organization_id,
    connectionConfig: connection.config || {},
  });

  const sendMode = (((connection.config || {}).sendMode || 'auto') as
    | 'auto'
    | 'number_text'
    | 'number_textMessage'
    | 'number_message'
    | 'number_body');

  const phone = toWhatsAppPhone(thread.contact_phone);
  if (!instanceName || !resolved?.apiUrl || !resolved.apiKey) {
    throw new Error('Conexao WhatsApp sem instanceName ou credencial Evolution configurada.');
  }
  if (!phone) {
    throw new Error('Thread sem telefone valido para envio.');
  }

  const now = new Date().toISOString();
  let deliveryMetadata: Record<string, unknown> = {
    provider: 'evolution',
    automation_source: payload.automationSource || 'native_crm',
    ai_summary: payload.summary ?? null,
    ai_handoff_reason: payload.handoffReason ?? null,
    ...(payload.metadata || {}),
  };
  let deliveryWarning: string | null = null;

  try {
    const sendResult = await sendEvolutionTextMessage({
      apiUrl: resolved.apiUrl,
      instanceName,
      apiKey: resolved.apiKey,
      phone,
      text: payload.replyText.trim(),
      sendMode,
    });

    deliveryMetadata = {
      ...deliveryMetadata,
      provider_message_id: sendResult.providerMessageId,
      delivery_status: 'sent',
      delivery_provider: 'evolution',
      delivery_attempt: sendResult.attemptLabel,
      delivery_raw: sendResult.raw,
      credential_source: resolved.source,
    };
  } catch (error) {
    deliveryWarning = error instanceof Error ? error.message : 'Falha ao enviar resposta automatica.';
    deliveryMetadata = {
      ...deliveryMetadata,
      delivery_status: 'failed',
      delivery_provider: 'evolution',
      delivery_attempt: 'all-failed',
      delivery_error: deliveryWarning,
      credential_source: resolved.source,
    };
  }

  const insertedMessage = await admin
    .from('conversation_messages')
    .insert({
      thread_id: payload.threadId,
      organization_id: connection.organization_id,
      direction: 'outbound',
      message_type: 'text',
      author_name: payload.authorName?.trim() || 'Julia',
      content: payload.replyText.trim(),
      metadata: deliveryMetadata,
      sent_at: now,
      created_at: now,
    })
    .select('id')
    .single();

  if (insertedMessage.error) throw new Error(insertedMessage.error.message);

  const nextStatus = payload.shouldHandoff ? 'human_queue' : 'ai_active';
  const nextMetadata = buildConversationThreadMetadataUpdate(thread.metadata, {
    direction: 'outbound',
    preview: payload.replyText.trim().slice(0, 160),
    messageType: 'text',
    sentAt: now,
    authorName: payload.authorName?.trim() || 'Julia',
    unreadCount: 0,
    routingMode: payload.shouldHandoff ? 'human' : 'ai',
    humanLocked: payload.shouldHandoff ? true : false,
    aiLockedReason: payload.shouldHandoff ? (payload.handoffReason?.trim() || 'human_handoff') : null,
    handoffRequestedAt: payload.shouldHandoff ? now : null,
    handoffReason: payload.shouldHandoff ? (payload.handoffReason?.trim() || 'human_handoff') : null,
    queueAssignedUserId: payload.shouldHandoff ? thread.assigned_user_id ?? null : null,
    provider: 'evolution',
  });

  const threadUpdate = await admin
    .from('conversation_threads')
    .update({
      status: nextStatus,
      last_message_at: now,
      updated_at: now,
      metadata: nextMetadata,
    })
    .eq('id', payload.threadId)
    .eq('organization_id', connection.organization_id);

  if (threadUpdate.error) throw new Error(threadUpdate.error.message);

  if (payload.summary?.trim()) {
    const summaryInsert = await admin.from('conversation_messages').insert({
      thread_id: payload.threadId,
      organization_id: connection.organization_id,
      direction: 'internal',
      message_type: 'note',
      author_name: payload.authorName?.trim() || 'Julia',
      content: `Resumo IA: ${payload.summary.trim()}`,
      metadata: {
        provider: 'evolution',
        automation_source: payload.automationSource || 'native_crm',
        note_type: 'ai_summary',
      },
      sent_at: now,
      created_at: now,
    });

    if (summaryInsert.error) throw new Error(summaryInsert.error.message);
  }

  const threadItem = await loadConversationThreadInboxItem(admin, connection.organization_id, payload.threadId);
  return {
    ok: true as const,
    warning: deliveryWarning,
    thread: threadItem,
    status: nextStatus,
  };
}
