import { after } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { parseEvolutionWebhookPayload } from '@/lib/conversations/evolutionWebhook';
import {
  buildConversationThreadMetadataUpdate,
  buildConversationPhoneCandidates,
  getCanonicalConversationPhone,
} from '@/lib/conversations/threadMetadata';
import { getConversationStatusAfterInbound } from '@/lib/conversations/routing';
import { notifyConversationAutomation } from '@/lib/conversations/n8nAutomation';
import { executeConversationAIReply, generateConversationAutoReply } from '@/lib/conversations/aiReply';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSecretFromRequest(req: Request) {
  const url = new URL(req.url);
  const querySecret = url.searchParams.get('secret')?.trim();
  if (querySecret) return querySecret;

  const headerSecret = req.headers.get('x-webhook-secret')?.trim();
  if (headerSecret) return headerSecret;

  const auth = req.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();

  return '';
}

function getPayloadInstanceName(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : null;

  const candidates = [
    root.instance,
    root.instanceName,
    root.instance_name,
    data?.instance,
    data?.instanceName,
    data?.instance_name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }

  return '';
}

function buildThreadTitle(contactName: string | null, contactPhone: string) {
  return `WhatsApp - ${contactName || contactPhone}`;
}

function toIsoStringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function shouldScheduleInactivityNudge(metadata: Record<string, unknown>) {
  const lastInboundAt = toIsoStringOrNull(metadata.lastInboundAt);
  const lastNudgeSentAt = toIsoStringOrNull(metadata.aiInactivityNudgeSentAt);

  if (!lastInboundAt) return false;
  if (!lastNudgeSentAt) return true;

  return new Date(lastInboundAt).getTime() > new Date(lastNudgeSentAt).getTime();
}

async function clearInactivityNudgeToken(params: {
  admin: ReturnType<typeof createStaticAdminClient>;
  organizationId: string;
  threadId: string;
  metadata: Record<string, unknown>;
  sentAt?: string | null;
}) {
  const { admin, organizationId, threadId, metadata, sentAt } = params;
  const nextMetadata = {
    ...metadata,
    aiInactivityNudgeToken: null,
    aiInactivityNudgeDueAt: null,
    aiInactivityNudgeScheduledAt: null,
    aiInactivityNudgeSentAt: sentAt ?? metadata.aiInactivityNudgeSentAt ?? null,
  };

  const result = await admin
    .from('conversation_threads')
    .update({
      updated_at: new Date().toISOString(),
      metadata: nextMetadata,
    })
    .eq('id', threadId)
    .eq('organization_id', organizationId);

  if (result.error) {
    console.warn('[Evolution webhook] Failed to clear inactivity nudge token', {
      threadId,
      organizationId,
      error: result.error.message,
    });
  }
}

async function processDeferredAIReply(params: {
  connectionId: string;
  organizationId: string;
  connectionName: string;
  connectionProvider: string;
  connectionChannelType: string;
  connectionConfig: Record<string, unknown>;
  threadId: string;
  contactId: string | null;
  dealId: string | null;
  contactName: string | null;
  canonicalPhone: string;
  insertedMessageId: string;
  aiPendingToken: string;
  aiDebounceMs: number;
  automationWebhookUrl: string;
  expectedSecret: string;
  requestSecret: string;
  requestOrigin: string;
}) {
  const {
    connectionId,
    organizationId,
    connectionName,
    connectionProvider,
    connectionChannelType,
    connectionConfig,
    threadId,
    contactId,
    dealId,
    contactName,
    canonicalPhone,
    insertedMessageId,
    aiPendingToken,
    aiDebounceMs,
    automationWebhookUrl,
    expectedSecret,
    requestSecret,
    requestOrigin,
  } = params;

  const admin = createStaticAdminClient();

  await sleep(aiDebounceMs);

  const debounceCheckResult = await admin
    .from('conversation_threads')
    .select('status, metadata')
    .eq('id', threadId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (debounceCheckResult.error) {
    console.warn('[Evolution webhook] Failed to check pending AI debounce', {
      connectionId,
      threadId,
      error: debounceCheckResult.error.message,
    });
    return;
  }

  const latestThreadStatus = debounceCheckResult.data?.status || 'ai_active';
  const latestThreadMetadata =
    (debounceCheckResult.data?.metadata as Record<string, unknown> | null) || {};

  if (latestThreadMetadata.aiPendingToken !== aiPendingToken) {
    return;
  }

  if (latestThreadStatus !== 'ai_active') {
    return;
  }

  const recentMessagesResult = await admin
    .from('conversation_messages')
    .select('id, direction, message_type, author_name, content, sent_at, metadata')
    .eq('organization_id', organizationId)
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: false })
    .limit(12);

  if (recentMessagesResult.error) {
    console.warn('[Evolution webhook] Failed to load recent conversation messages for automation', {
      connectionId,
      threadId,
      error: recentMessagesResult.error.message,
    });
  }

  const recentMessages = (recentMessagesResult.data || []).slice().reverse();
  let nativeReplySucceeded = false;
  let executedReply:
    | Awaited<ReturnType<typeof executeConversationAIReply>>
    | null = null;

  try {
    const nativeReply = await generateConversationAutoReply({
      admin,
      organizationId,
      contactName,
      contactPhone: canonicalPhone,
      recentMessages,
    });

    if (nativeReply.ok) {
      executedReply = await executeConversationAIReply({
        admin,
        connection: {
          id: connectionId,
          organization_id: organizationId,
          name: connectionName,
          config: connectionConfig,
        },
        payload: {
          threadId,
          replyText: nativeReply.object.replyText,
          summary: nativeReply.object.summary,
          shouldHandoff: nativeReply.object.shouldHandoff,
          handoffReason: nativeReply.object.handoffReason,
          authorName: 'Julia',
          metadata: {
            trigger_message_id: insertedMessageId,
            native_ai: true,
            prompt_source: nativeReply.source,
            ai_debounce_ms: aiDebounceMs,
            ai_pending_token: aiPendingToken,
          },
          automationSource: 'native_crm',
        },
      });
      nativeReplySucceeded = true;
    } else {
      console.warn('[Evolution webhook] Native AI reply skipped', {
        connectionId,
        threadId,
        reason: nativeReply.reason,
      });
    }
  } catch (nativeAiError) {
    console.warn('[Evolution webhook] Native AI reply failed', {
      connectionId,
      threadId,
      error: nativeAiError instanceof Error ? nativeAiError.message : String(nativeAiError),
    });
  }

  if (!nativeReplySucceeded && automationWebhookUrl) {
    const automationPayload = {
      source: 'basecrm.conversations.inbound',
      organizationId,
      connectionId,
      threadId,
      messageId: insertedMessageId,
      status: latestThreadStatus,
      contact: {
        id: contactId,
        name: contactName,
        phone: canonicalPhone,
      },
      deal: {
        id: dealId,
      },
      message: {
        direction: 'inbound',
        type: 'text',
        content: recentMessages.at(-1)?.content || '',
        providerMessageId: null,
        sentAt: recentMessages.at(-1)?.sent_at || new Date().toISOString(),
      },
      recentMessages,
      connection: {
        provider: connectionProvider,
        channelType: connectionChannelType,
        name: connectionName,
      },
      aiReplyUrl: `${requestOrigin}/api/public/channels/evolution/${connectionId}/ai-reply`,
    };

    try {
      await notifyConversationAutomation({
        webhookUrl: automationWebhookUrl,
        secret: expectedSecret || requestSecret,
        payload: automationPayload,
      });
    } catch (automationError) {
      console.warn('[Evolution webhook] Failed to notify automation webhook', {
        connectionId,
        threadId,
        error: automationError instanceof Error ? automationError.message : String(automationError),
      });
    }
  }

  if (
    executedReply &&
    'thread' in executedReply &&
    executedReply.thread &&
    !executedReply.warning &&
    executedReply.status === 'ai_active' &&
    shouldScheduleInactivityNudge(executedReply.thread.metadata as Record<string, unknown>)
  ) {
    const idleNudgeDelayMs = 90_000;
    const idleNudgeToken = `${insertedMessageId}:idle-nudge:${Date.now()}`;
    const nudgeScheduledAt = new Date().toISOString();

    const markNudgeResult = await admin
      .from('conversation_threads')
      .update({
        updated_at: nudgeScheduledAt,
        metadata: {
          ...(executedReply.thread.metadata as Record<string, unknown>),
          aiInactivityNudgeToken: idleNudgeToken,
          aiInactivityNudgeScheduledAt: nudgeScheduledAt,
          aiInactivityNudgeDueAt: new Date(Date.now() + idleNudgeDelayMs).toISOString(),
        },
      })
      .eq('id', threadId)
      .eq('organization_id', organizationId);

    if (markNudgeResult.error) {
      console.warn('[Evolution webhook] Failed to schedule inactivity nudge', {
        connectionId,
        threadId,
        error: markNudgeResult.error.message,
      });
      return;
    }

    await sleep(idleNudgeDelayMs);

    const nudgeCheckResult = await admin
      .from('conversation_threads')
      .select('status, metadata')
      .eq('id', threadId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (nudgeCheckResult.error) {
      console.warn('[Evolution webhook] Failed to validate inactivity nudge state', {
        connectionId,
        threadId,
        error: nudgeCheckResult.error.message,
      });
      return;
    }

    const nudgeMetadata =
      (nudgeCheckResult.data?.metadata as Record<string, unknown> | null) || {};

    if (nudgeCheckResult.data?.status !== 'ai_active') {
      await clearInactivityNudgeToken({
        admin,
        organizationId,
        threadId,
        metadata: nudgeMetadata,
      });
      return;
    }

    if (nudgeMetadata.aiInactivityNudgeToken !== idleNudgeToken) {
      return;
    }

    if (nudgeMetadata.lastDirection === 'inbound') {
      await clearInactivityNudgeToken({
        admin,
        organizationId,
        threadId,
        metadata: nudgeMetadata,
      });
      return;
    }

    const idleNudgeText =
      `Se quiser, eu continuo te ajudando por aqui 😊\n\n` +
      `Posso te explicar melhor e tirar suas duvidas sem pressa.`;

    try {
      await executeConversationAIReply({
        admin,
        connection: {
          id: connectionId,
          organization_id: organizationId,
          name: connectionName,
          config: connectionConfig,
        },
        payload: {
          threadId,
          replyText: idleNudgeText,
          authorName: 'Julia',
          metadata: {
            idle_nudge: true,
            idle_nudge_delay_ms: idleNudgeDelayMs,
            idle_nudge_token: idleNudgeToken,
          },
          automationSource: 'native_crm_idle_nudge',
        },
      });

      await clearInactivityNudgeToken({
        admin,
        organizationId,
        threadId,
        metadata: {
          ...nudgeMetadata,
          aiInactivityNudgeSentAt: new Date().toISOString(),
        },
        sentAt: new Date().toISOString(),
      });
    } catch (idleNudgeError) {
      console.warn('[Evolution webhook] Failed to send inactivity nudge', {
        connectionId,
        threadId,
        error: idleNudgeError instanceof Error ? idleNudgeError.message : String(idleNudgeError),
      });
    }
  }
}

async function upsertConversationContact(params: {
  admin: ReturnType<typeof createStaticAdminClient>;
  organizationId: string;
  phoneCandidates: string[];
  canonicalPhone: string;
  contactName: string | null;
  now: string;
}) {
  const { admin, organizationId, phoneCandidates, canonicalPhone, contactName, now } = params;
  const contactResult = await admin
    .from('contacts')
    .select('id, name, phone')
    .eq('organization_id', organizationId)
    .in('phone', phoneCandidates.length > 0 ? phoneCandidates : [canonicalPhone])
    .limit(1)
    .maybeSingle();

  if (contactResult.error) throw new Error(contactResult.error.message);

  if (contactResult.data?.id) {
    if (contactName && contactResult.data.name !== contactName) {
      const updateResult = await admin
        .from('contacts')
        .update({
          name: contactName,
          phone: canonicalPhone,
          updated_at: now,
        })
        .eq('id', contactResult.data.id)
        .eq('organization_id', organizationId);

      if (updateResult.error) throw new Error(updateResult.error.message);
    }

    return {
      contactId: contactResult.data.id,
      contactName: contactName || contactResult.data.name || null,
    };
  }

  const fallbackName =
    contactName || `Lead WhatsApp ${canonicalPhone.slice(-4) || canonicalPhone}`;

  const createdContact = await admin
    .from('contacts')
    .insert({
      organization_id: organizationId,
      name: fallbackName,
      phone: canonicalPhone,
      status: 'ACTIVE',
      stage: 'LEAD',
      created_at: now,
      updated_at: now,
    })
    .select('id, name')
    .single();

  if (createdContact.error) throw new Error(createdContact.error.message);

  return {
    contactId: createdContact.data.id,
    contactName: createdContact.data.name || fallbackName,
  };
}

async function resolveDefaultBoardAndStage(params: {
  admin: ReturnType<typeof createStaticAdminClient>;
  organizationId: string;
}) {
  const { admin, organizationId } = params;

  const boardResult = await admin
    .from('boards')
    .select('id, name, key, position, created_at')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (boardResult.error) throw new Error(boardResult.error.message);
  if (!boardResult.data?.id) return null;

  const stageResult = await admin
    .from('board_stages')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('board_id', boardResult.data.id)
    .order('order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (stageResult.error) throw new Error(stageResult.error.message);
  if (!stageResult.data?.id) return null;

  return {
    boardId: boardResult.data.id,
    stageId: stageResult.data.id,
  };
}

async function ensureConversationDeal(params: {
  admin: ReturnType<typeof createStaticAdminClient>;
  organizationId: string;
  threadId: string;
  threadDealId: string | null;
  contactId: string | null;
  canonicalPhone: string;
  contactName: string | null;
  preview: string;
  now: string;
}) {
  const {
    admin,
    organizationId,
    threadId,
    threadDealId,
    contactId,
    canonicalPhone,
    contactName,
    preview,
    now,
  } = params;

  if (threadDealId) return threadDealId;
  if (!contactId) return null;

  const existingDeal = await admin
    .from('deals')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('contact_id', contactId)
    .eq('is_won', false)
    .eq('is_lost', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingDeal.error) throw new Error(existingDeal.error.message);

  if (existingDeal.data?.id) {
    const threadUpdate = await admin
      .from('conversation_threads')
      .update({
        deal_id: existingDeal.data.id,
        updated_at: now,
      })
      .eq('id', threadId)
      .eq('organization_id', organizationId);

    if (threadUpdate.error) throw new Error(threadUpdate.error.message);
    return existingDeal.data.id;
  }

  const boardStage = await resolveDefaultBoardAndStage({ admin, organizationId });
  if (!boardStage) return null;

  const createdDeal = await admin
    .from('deals')
    .insert({
      organization_id: organizationId,
      title: `${contactName || canonicalPhone} - WhatsApp`,
      value: 0,
      probability: 0,
      status: boardStage.stageId,
      priority: 'medium',
      board_id: boardStage.boardId,
      stage_id: boardStage.stageId,
      contact_id: contactId,
      tags: ['whatsapp', 'novo-lead'],
      custom_fields: {
        source: 'whatsapp',
        origin_channel: 'evolution',
        first_inbound_preview: preview,
      },
      is_won: false,
      is_lost: false,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (createdDeal.error) throw new Error(createdDeal.error.message);

  const threadUpdate = await admin
    .from('conversation_threads')
    .update({
      deal_id: createdDeal.data.id,
      updated_at: now,
    })
    .eq('id', threadId)
    .eq('organization_id', organizationId);

  if (threadUpdate.error) throw new Error(threadUpdate.error.message);

  return createdDeal.data.id;
}

export async function POST(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await ctx.params;
  const requestOrigin = new URL(req.url).origin;
  const payload = await req.json().catch(() => null);
  if (!payload) return json({ error: 'JSON invalido' }, 400);

  const admin = createStaticAdminClient();
  const connectionResult = await admin
    .from('channel_connections')
    .select('id, organization_id, provider, channel_type, name, config, metadata')
    .eq('id', connectionId)
    .eq('provider', 'evolution')
    .eq('channel_type', 'whatsapp')
    .maybeSingle();

  if (connectionResult.error) return json({ error: connectionResult.error.message }, 500);
  if (!connectionResult.data) return json({ error: 'Conexao nao encontrada' }, 404);
  const connection = connectionResult.data;

  const requestSecret = getSecretFromRequest(req);
  const expectedSecret = String((connection.config as Record<string, unknown> | null)?.webhookSecret || '').trim();
  const configuredInstanceName = String((connection.config as Record<string, unknown> | null)?.instanceName || '').trim();
  const payloadInstanceName = getPayloadInstanceName(payload);

  const authorizedBySecret = Boolean(expectedSecret && requestSecret && requestSecret === expectedSecret);
  const authorizedByInstanceFallback = Boolean(
    !requestSecret &&
      configuredInstanceName &&
      payloadInstanceName &&
      configuredInstanceName.toLowerCase() === payloadInstanceName.toLowerCase()
  );

  if (expectedSecret && !authorizedBySecret && !authorizedByInstanceFallback) {
    return json({ error: 'Secret invalido' }, 401);
  }

  const authMode = authorizedBySecret
    ? 'secret'
    : authorizedByInstanceFallback
      ? 'instance_fallback'
      : 'no_secret_configured';

  const parsed = parseEvolutionWebhookPayload(payload);
  if (!parsed) {
    const nowIgnored = new Date().toISOString();
    const ignoredMetadata = (connectionResult.data.metadata as Record<string, unknown> | null) || {};
    await admin
      .from('channel_connections')
      .update({
        updated_at: nowIgnored,
        metadata: {
          ...ignoredMetadata,
          lastWebhookAt: nowIgnored,
          lastWebhookAuthMode: authMode,
          lastWebhookIgnoredReason: 'payload sem mensagem suportada',
        },
      })
      .eq('id', connectionId)
          .eq('organization_id', connection.organization_id);

    return json({
      ok: true,
      ignored: true,
      reason: 'payload sem mensagem suportada',
    });
  }
  const contactPhone = parsed.contactPhone;
  const content = parsed.content;
  if (!contactPhone || !content) {
    return json({ ok: true, ignored: true, reason: 'mensagem sem telefone ou conteudo' });
  }

  if (parsed.providerMessageId) {
    const existingMessage = await admin
      .from('conversation_messages')
      .select('id, thread_id')
      .eq('organization_id', connectionResult.data.organization_id)
      .eq('metadata->>provider_message_id', parsed.providerMessageId)
      .limit(1)
      .maybeSingle();

    if (existingMessage.error) return json({ error: existingMessage.error.message }, 500);
    if (existingMessage.data) {
      return json({
        ok: true,
        duplicate: true,
        thread_id: existingMessage.data.thread_id,
        message_id: existingMessage.data.id,
      });
    }
  }

  const phoneCandidates = buildConversationPhoneCandidates(contactPhone);
  const canonicalPhone = getCanonicalConversationPhone(contactPhone) || contactPhone;
  const now = new Date().toISOString();
  let contactId: string | null = null;
  let resolvedContactName: string | null = parsed.contactName;

  try {
    const contact = await upsertConversationContact({
      admin,
      organizationId: connectionResult.data.organization_id,
      phoneCandidates,
      canonicalPhone,
      contactName: parsed.contactName,
      now,
    });
    contactId = contact.contactId;
    resolvedContactName = contact.contactName;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao materializar contato.' }, 500);
  }

  const threadResult = await admin
    .from('conversation_threads')
    .select('id, status, metadata, deal_id')
    .eq('organization_id', connectionResult.data.organization_id)
    .eq('channel_connection_id', connectionId)
    .in('contact_phone', phoneCandidates.length > 0 ? phoneCandidates : [contactPhone])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (threadResult.error) return json({ error: threadResult.error.message }, 500);

  let threadId = threadResult.data?.id ?? null;

  if (!threadId) {
    const createdThread = await admin
      .from('conversation_threads')
      .insert({
        organization_id: connectionResult.data.organization_id,
        channel_connection_id: connectionId,
        contact_id: contactId,
        title: buildThreadTitle(resolvedContactName, canonicalPhone),
        contact_name: resolvedContactName,
        contact_phone: canonicalPhone,
        status: parsed.direction === 'inbound' ? 'ai_active' : 'resolved',
        metadata: buildConversationThreadMetadataUpdate(
          {
            provider: 'evolution',
            autoCreated: true,
            routingMode: 'ai',
          },
          {
            direction: parsed.direction,
            event: parsed.event,
            preview: content.slice(0, 160),
            messageType: parsed.messageType,
            sentAt: parsed.sentAt,
            authorName: parsed.direction === 'inbound' ? parsed.contactName : connectionResult.data.name,
            incrementUnread: parsed.direction === 'inbound',
            provider: 'evolution',
            humanLocked: false,
            aiLockedReason: null,
          }
        ),
        last_message_at: parsed.sentAt,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (createdThread.error) return json({ error: createdThread.error.message }, 500);
    threadId = createdThread.data.id;
  } else {
    const updatedThread = await admin
      .from('conversation_threads')
      .update({
        contact_id: contactId ?? undefined,
        contact_name: resolvedContactName || undefined,
        contact_phone: canonicalPhone,
        status:
          parsed.direction === 'inbound'
            ? getConversationStatusAfterInbound(threadResult.data?.status)
            : threadResult.data?.status ?? 'resolved',
        last_message_at: parsed.sentAt,
        updated_at: now,
        metadata: buildConversationThreadMetadataUpdate(threadResult.data?.metadata, {
          provider: 'evolution',
          direction: parsed.direction,
          event: parsed.event,
          preview: content.slice(0, 160),
          messageType: parsed.messageType,
          sentAt: parsed.sentAt,
          authorName: parsed.direction === 'inbound' ? parsed.contactName : connectionResult.data.name,
          incrementUnread: parsed.direction === 'inbound',
          unreadCount: parsed.direction === 'outbound' ? 0 : null,
          humanLocked:
            parsed.direction === 'inbound'
              ? ['human_active', 'human_queue'].includes(threadResult.data?.status || '')
              : undefined,
          aiLockedReason:
            parsed.direction === 'inbound' && threadResult.data?.status === 'resolved'
              ? null
              : undefined,
          resolvedAt:
            parsed.direction === 'inbound' && threadResult.data?.status === 'resolved'
              ? null
              : undefined,
          resolvedBy:
            parsed.direction === 'inbound' && threadResult.data?.status === 'resolved'
              ? null
              : undefined,
        }),
      })
      .eq('id', threadId)
      .eq('organization_id', connection.organization_id);

    if (updatedThread.error) return json({ error: updatedThread.error.message }, 500);
  }

  const insertedMessage = await admin
    .from('conversation_messages')
    .insert({
      thread_id: threadId,
      organization_id: connectionResult.data.organization_id,
      direction: parsed.direction,
      message_type: parsed.messageType,
      author_name: parsed.direction === 'inbound' ? parsed.contactName : connectionResult.data.name,
      content,
      metadata: {
        provider: 'evolution',
        event: parsed.event,
        provider_message_id: parsed.providerMessageId,
        raw_payload: parsed.raw,
      },
      sent_at: parsed.sentAt,
      created_at: now,
    })
    .select('id')
    .single();

  if (insertedMessage.error) return json({ error: insertedMessage.error.message }, 500);

  let dealId: string | null = threadResult.data?.deal_id ?? null;
  if (parsed.direction === 'inbound') {
    try {
      dealId = await ensureConversationDeal({
        admin,
        organizationId: connectionResult.data.organization_id,
        threadId,
        threadDealId: threadResult.data?.deal_id ?? null,
        contactId,
        canonicalPhone,
        contactName: resolvedContactName,
        preview: content.slice(0, 160),
        now,
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Falha ao criar oportunidade.' }, 500);
    }
  }

  const currentConnectionMetadata = (connection.metadata as Record<string, unknown> | null) || {};
  const connectionUpdate = await admin
    .from('channel_connections')
    .update({
      updated_at: now,
      metadata: {
        ...currentConnectionMetadata,
        lastWebhookAt: now,
        lastWebhookAuthMode: authMode,
        lastWebhookIgnoredReason: null,
        lastInboundAt: parsed.sentAt,
        lastInboundPhone: contactPhone,
        lastInboundPreview: content.slice(0, 160),
      },
    })
    .eq('id', connectionId)
    .eq('organization_id', connection.organization_id);

  if (connectionUpdate.error) return json({ error: connectionUpdate.error.message }, 500);

  const connectionConfig = (connection.config as Record<string, unknown> | null) || {};
  const automationWebhookUrl = String(connectionConfig.webhookUrl || '').trim();
  const threadStatus =
    threadResult.data?.status && parsed.direction === 'inbound'
      ? getConversationStatusAfterInbound(threadResult.data.status)
      : parsed.direction === 'inbound'
        ? 'ai_active'
        : threadResult.data?.status ?? 'resolved';

  if (parsed.direction === 'inbound' && threadStatus === 'ai_active') {
    const aiDebounceMs = 7000;
    const aiPendingToken = `${insertedMessage.data.id}:${Date.now()}`;

    const pendingMetadataUpdate = await admin
      .from('conversation_threads')
      .update({
        updated_at: now,
        metadata: buildConversationThreadMetadataUpdate(threadResult.data?.metadata, {
          provider: 'evolution',
          direction: parsed.direction,
          event: parsed.event,
          preview: content.slice(0, 160),
          messageType: parsed.messageType,
          sentAt: parsed.sentAt,
          authorName: parsed.contactName,
          incrementUnread: false,
        }),
      })
      .eq('id', threadId)
      .eq('organization_id', connectionResult.data.organization_id);

    if (pendingMetadataUpdate.error) {
      return json({ error: pendingMetadataUpdate.error.message }, 500);
    }

    const threadMetadataResult = await admin
      .from('conversation_threads')
      .select('metadata, status')
      .eq('id', threadId)
      .eq('organization_id', connectionResult.data.organization_id)
      .maybeSingle();

    if (threadMetadataResult.error) {
      return json({ error: threadMetadataResult.error.message }, 500);
    }

    const currentThreadMetadata =
      (threadMetadataResult.data?.metadata as Record<string, unknown> | null) || {};

    const debounceMarkResult = await admin
      .from('conversation_threads')
      .update({
        updated_at: now,
        metadata: {
          ...currentThreadMetadata,
          aiPendingToken: aiPendingToken,
          aiPendingSince: now,
          aiPendingMessageId: insertedMessage.data.id,
          aiDebounceMs,
        },
      })
      .eq('id', threadId)
      .eq('organization_id', connectionResult.data.organization_id);

    if (debounceMarkResult.error) {
      return json({ error: debounceMarkResult.error.message }, 500);
    }
    after(async () => {
      await processDeferredAIReply({
        connectionId,
        organizationId: connection.organization_id,
        connectionName: connection.name,
        connectionProvider: connection.provider,
        connectionChannelType: connection.channel_type,
        connectionConfig,
        threadId,
        contactId,
        dealId,
        contactName: resolvedContactName,
        canonicalPhone,
        insertedMessageId: insertedMessage.data.id,
        aiPendingToken,
        aiDebounceMs,
        automationWebhookUrl,
        expectedSecret,
        requestSecret,
        requestOrigin,
      });
    });
  }

  return json({
    ok: true,
    thread_id: threadId,
    deal_id: dealId,
    message_id: insertedMessage.data.id,
    direction: parsed.direction,
  });
}
