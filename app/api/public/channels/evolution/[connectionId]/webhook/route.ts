import { after } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { parseEvolutionWebhookPayload } from '@/lib/conversations/evolutionWebhook';
import {
  buildConversationThreadMetadataUpdate,
  buildConversationPhoneCandidates,
  getCanonicalConversationPhone,
  readConversationThreadMetadata,
} from '@/lib/conversations/threadMetadata';
import { getConversationStatusAfterInbound } from '@/lib/conversations/routing';
import { notifyConversationAutomation } from '@/lib/conversations/n8nAutomation';
import { executeConversationAIReply, generateConversationAutoReply } from '@/lib/conversations/aiReply';
import { resolveConversationAIAgentConfig } from '@/lib/conversations/aiAgentConfig';
import { evaluateWebhookAuth, readWebhookSecretFromRequest } from '@/lib/conversations/webhookAuth';
import { buildEvolutionMessageMetadata } from '@/lib/conversations/messageMetadata';
import { loadFreshConversationAIGate } from '@/lib/conversations/conversationAIGate';
import { recordConversationAIFailure } from '@/lib/conversations/conversationAIFailure';
import { consumeConversationRateLimit } from '@/lib/conversations/conversationRateLimit';
import {
  buildIdleNudgeScheduleMetadata,
  resolveIdleNudgeConfig,
  shouldScheduleIdleNudge,
} from '@/lib/conversations/idleNudge';
import { resolveClosingReplyEligibility } from '@/lib/conversations/closingReply';
import { resolveInboundMediaMode } from '@/lib/conversations/inboundMedia';
import { buildInboundMediaNotification } from '@/lib/conversations/inboundMediaNotification';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function processDeferredAIReply(params: {
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

  if (connectionConfig.aiEnabled !== true) return;

  const admin = createStaticAdminClient();

  await sleep(aiDebounceMs);

  const gate = await loadFreshConversationAIGate({
    admin,
    connectionId,
    organizationId,
  });
  if (!gate.ok) return;
  const freshConnection = gate.connection;
  const freshConnectionConfig = freshConnection.config || {};
  const { agentName, promptKey } = resolveConversationAIAgentConfig(freshConnectionConfig);

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

  // Encerramento (decisao do Junior, 20/09): depois do handoff da propria IA a conversa esta na fila
  // humana, mas o lead nao fica no vacuo: ela ainda responde curto, ate 2 vezes, e encerra. A decisao
  // e tomada pelo estado FRESCO (depois do debounce), nunca pelo que o inbound viu: se um humano
  // devolveu a conversa para a IA nesse meio tempo, a resposta e normal; se a moveu para a fila, silencio.
  const closingEligibility = latestThreadStatus === 'human_queue'
    ? resolveClosingReplyEligibility({ status: latestThreadStatus, metadata: latestThreadMetadata })
    : null;
  const closingReply = Boolean(closingEligibility?.eligible);
  if (latestThreadStatus !== 'ai_active' && !closingReply) {
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
  let nativeExecutionStarted = false;
  let fallbackSucceeded = false;
  let nativeFailureStage: 'configuration' | 'generation' | 'provider' = 'generation';
  let nativeFailureError: string | null = null;
  let executedReply:
    | Awaited<ReturnType<typeof executeConversationAIReply>>
    | null = null;

  try {
    const nativeReply = promptKey ? await generateConversationAutoReply({
      admin,
      organizationId,
      connectionId,
      contactName,
      contactPhone: canonicalPhone,
      recentMessages,
      promptKey,
      closing: closingEligibility?.eligible
        ? { handoff: closingEligibility.handoff, repliesUsed: closingEligibility.repliesUsed }
        : null,
      threadMetadata: latestThreadMetadata,
    }) : { ok: false as const, reason: 'missing_prompt' as const };

    if (nativeReply.ok) {
      // 2a janela de 20/09: duas mensagens do lead com 9 s de intervalo (fora do debounce) geraram duas
      // respostas, a primeira ja obsoleta. Se chegou mensagem nova enquanto esta resposta era gerada,
      // ela nao sai: a geracao da mensagem nova responde com o contexto completo.
      const staleCheck = await admin
        .from('conversation_threads')
        .select('metadata')
        .eq('id', threadId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      const latestPendingToken = (staleCheck.data?.metadata as Record<string, unknown> | null)?.aiPendingToken;
      if (!staleCheck.error && latestPendingToken !== aiPendingToken) {
        console.warn('[Evolution webhook] Reply discarded: a newer inbound message arrived during generation', {
          connectionId,
          threadId,
        });
        return;
      }
      nativeExecutionStarted = true;
      executedReply = await executeConversationAIReply({
        admin,
        connection: {
          id: connectionId,
          organization_id: organizationId,
          name: freshConnection.name,
          config: freshConnectionConfig,
        },
        payload: {
          threadId,
          replyText: nativeReply.object.replyText,
          summary: nativeReply.object.summary,
          shouldHandoff: nativeReply.object.shouldHandoff,
          handoffType: nativeReply.object.handoffType,
          handoffReason: nativeReply.object.handoffReason,
          requestedScheduleAt: nativeReply.object.requestedScheduleAt,
          requestedScheduleText: nativeReply.object.requestedScheduleText,
          leadEmail: nativeReply.object.leadEmail,
          leadSegment: nativeReply.object.leadSegment,
          notificationEventId: insertedMessageId,
          authorName: agentName,
          metadata: {
            trigger_message_id: insertedMessageId,
            native_ai: true,
            prompt_source: nativeReply.source,
            ai_debounce_ms: aiDebounceMs,
            ai_pending_token: aiPendingToken,
            closing_reply: closingReply,
          },
          automationSource: 'native_crm',
          closingReply,
        },
      });
      nativeReplySucceeded = true;
    } else {
      nativeFailureStage = nativeReply.reason === 'missing_api_key' || nativeReply.reason === 'missing_prompt'
        ? 'configuration'
        : 'generation';
      nativeFailureError = `skipped: ${nativeReply.reason}`;
      console.warn('[Evolution webhook] Native AI reply skipped', {
        connectionId,
        threadId,
        reason: nativeReply.reason,
      });
    }
  } catch (nativeAiError) {
    if (nativeExecutionStarted) {
      const failureResult = await recordConversationAIFailure({
        admin,
        organizationId,
        threadId,
        eventId: insertedMessageId,
        contactLabel: contactName || canonicalPhone,
        stage: 'delivery',
        metadata: latestThreadMetadata,
        errorMessage: nativeAiError instanceof Error ? nativeAiError.message : String(nativeAiError),
      });
      console.warn('[Evolution webhook] Native AI execution failed after taking ownership', {
        connectionId,
        threadId,
        error: nativeAiError instanceof Error ? nativeAiError.message : String(nativeAiError),
        threadError: failureResult.threadError,
        notificationError: failureResult.notificationError,
      });
      return;
    }
    nativeFailureStage = 'provider';
    // O texto cru do modelo (quando o SDK nao conseguiu interpretar) fica no registro da falha, cortado:
    // sem isso nao da para saber POR QUE o JSON nao veio (ensaio de 20/09).
    const rawModelText = nativeAiError && typeof nativeAiError === 'object' && typeof (nativeAiError as { text?: unknown }).text === 'string'
      ? ` | texto: ${String((nativeAiError as { text: string }).text).replace(/\s+/g, ' ').slice(0, 160)}`
      : '';
    nativeFailureError = (nativeAiError instanceof Error ? `${nativeAiError.name}: ${nativeAiError.message}` : String(nativeAiError)) + rawModelText;
    console.warn('[Evolution webhook] Native AI reply failed', {
      connectionId,
      threadId,
      error: nativeAiError instanceof Error ? nativeAiError.message : String(nativeAiError),
    });
  }

  if (!nativeReplySucceeded && closingReply) {
    // Encerramento que nao saiu nao vira alerta nem n8n: a conversa ja esta na fila humana.
    console.warn('[Evolution webhook] Closing reply skipped', { connectionId, threadId, reason: nativeFailureError });
    return;
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
        name: freshConnection.name,
      },
      aiReplyUrl: `${requestOrigin}/api/public/channels/evolution/${connectionId}/ai-reply`,
    };

    try {
      await notifyConversationAutomation({
        webhookUrl: automationWebhookUrl,
        secret: expectedSecret || requestSecret,
        payload: automationPayload,
      });
      fallbackSucceeded = true;
    } catch (automationError) {
      console.warn('[Evolution webhook] Failed to notify automation webhook', {
        connectionId,
        threadId,
        error: automationError instanceof Error ? automationError.message : String(automationError),
      });
    }
  }

  if (!nativeReplySucceeded && !fallbackSucceeded) {
    const failureResult = await recordConversationAIFailure({
      admin,
      organizationId,
      threadId,
      eventId: insertedMessageId,
      contactLabel: contactName || canonicalPhone,
      stage: nativeFailureStage,
      metadata: latestThreadMetadata,
      errorMessage: nativeFailureError,
    });
    if (!failureResult.ok) {
      console.warn('[Evolution webhook] Failed to persist AI failure handoff', {
        connectionId,
        threadId,
        threadError: failureResult.threadError,
        notificationError: failureResult.notificationError,
      });
    }
    return;
  }

  // Cutucada de inatividade: aqui so se AGENDA. Quinze minutos nao cabem numa espera dentro do
  // pedido do webhook, entao quem envia e o relogio do tick (sendDueConversationNudges), lendo
  // aiInactivityNudgeDueAt. Prazo, texto e liga/desliga sao por numero (config.aiIdleNudge).
  if (
    executedReply &&
    'thread' in executedReply &&
    executedReply.thread &&
    !executedReply.warning &&
    executedReply.status === 'ai_active'
  ) {
    const threadMetadata = (executedReply.thread.metadata as Record<string, unknown> | null) || {};
    const idleNudge = resolveIdleNudgeConfig(freshConnectionConfig);
    if (!idleNudge.enabled || !shouldScheduleIdleNudge(threadMetadata)) return;

    const nudgeScheduledAt = new Date().toISOString();
    const markNudgeResult = await admin
      .from('conversation_threads')
      .update({
        updated_at: nudgeScheduledAt,
        metadata: buildIdleNudgeScheduleMetadata({
          metadata: threadMetadata,
          token: `${insertedMessageId}:idle-nudge:${Date.now()}`,
          scheduledAt: nudgeScheduledAt,
          delayMinutes: idleNudge.delayMinutes,
        }),
      })
      .eq('id', threadId)
      .eq('organization_id', organizationId);

    if (markNudgeResult.error) {
      console.warn('[Evolution webhook] Failed to schedule inactivity nudge', {
        connectionId,
        threadId,
        error: markNudgeResult.error.message,
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

  if (connectionResult.error) {
    console.error('[Evolution webhook] Failed to load connection', { connectionId, error: connectionResult.error.message });
    return json({ error: 'Falha interna ao carregar a conexao.' }, 500);
  }
  if (!connectionResult.data) return json({ error: 'Conexao nao encontrada' }, 404);
  const connection = connectionResult.data;
  const connectionConfig = (connection.config as Record<string, unknown> | null) || {};
  const aiEnabled = connectionConfig.aiEnabled === true;

  const requestSecret = readWebhookSecretFromRequest(req);
  const expectedSecret = String(connectionConfig.webhookSecret || '').trim();
  const configuredInstanceName = String(connectionConfig.instanceName || '').trim();
  const payloadInstanceName = getPayloadInstanceName(payload);

  const { authorized, authMode } = evaluateWebhookAuth({
    expectedSecret,
    requestSecret,
    configuredInstanceName,
    payloadInstanceName,
  });

  if (!authorized) {
    // Conexão sem segredo não é mais "legada": é recusada (parecer do Codex, B1/G11). A tela de
    // conexões, ao rodar o healthcheck ou "Gerar QR code", registra o segredo na Evolution.
    if (authMode === 'no_secret_configured') {
      return json({ error: 'Conexao sem segredo de webhook. Abra a tela de conexoes do CRM e gere o QR code de novo.' }, 401);
    }
    return json({ error: 'Secret invalido' }, 401);
  }

  const rateLimit = await consumeConversationRateLimit({
    admin,
    scopeKey: `evolution-webhook:${connectionId}`,
    limit: 180,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'Muitas requisicoes. Tente novamente em instantes.' }), {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(rateLimit.retryAfterSeconds),
      },
    });
  }

  // Chave de mídia por conexão (SPEC-midia-recebida). Ausente = `off` = parser de sempre.
  const parsed = parseEvolutionWebhookPayload(payload, { mediaMode: resolveInboundMediaMode(connectionConfig) });
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
      .eq('channel_connection_id', connectionId)
      .eq('provider_message_id', parsed.providerMessageId)
      .limit(1)
      .maybeSingle();

    if (existingMessage.error) {
      console.error('[Evolution webhook] Failed to check duplicate message', { connectionId, error: existingMessage.error.message });
      return json({ error: 'Falha interna ao verificar a mensagem.' }, 500);
    }
    if (existingMessage.data) {
      if (parsed.direction === 'inbound') {
        const waitResolution = await admin.rpc('resolve_automation_wait_from_inbox', {
          p_channel_connection_id: connectionId,
          p_provider_message_id: parsed.providerMessageId,
          p_thread_id: existingMessage.data.thread_id,
          p_message_id: existingMessage.data.id,
          p_quoted_provider_message_id: parsed.quotedProviderMessageId,
          p_received_at: parsed.sentAt,
        });
        if (waitResolution.error) {
          return json({ error: 'Falha ao correlacionar resposta da automação.' }, 500);
        }
      }
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
    console.error('[Evolution webhook] Failed to materialize contact', {
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Falha interna ao materializar o contato.' }, 500);
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

  if (threadResult.error) {
    console.error('[Evolution webhook] Failed to load thread', { connectionId, error: threadResult.error.message });
    return json({ error: 'Falha interna ao carregar a conversa.' }, 500);
  }

  let threadId = threadResult.data?.id ?? null;
  const inboundThreadStatus = getConversationStatusAfterInbound(threadResult.data?.status, aiEnabled);

  // 3a: resumo do clique de anúncio fica na conversa (a caixa mostra "veio do anúncio X");
  // o histórico auditável vai para lead_source_attributions mais abaixo.
  const threadAdClick =
    parsed.direction === 'inbound' && parsed.adClick
      ? {
          ctwaClid: parsed.adClick.ctwaClid,
          title: parsed.adClick.title,
          sourceId: parsed.adClick.sourceId,
          sourceApp: parsed.adClick.sourceApp,
          at: parsed.sentAt,
        }
      : null;

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
        status: parsed.direction === 'inbound' ? inboundThreadStatus : 'resolved',
        metadata: buildConversationThreadMetadataUpdate(
          {
            provider: 'evolution',
            autoCreated: true,
            routingMode: aiEnabled ? 'ai' : 'human',
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
            humanLocked: !aiEnabled,
            aiLockedReason: aiEnabled ? null : 'connection_ai_disabled',
            adClick: threadAdClick,
          }
        ),
        last_message_at: parsed.sentAt,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (createdThread.error) {
      console.error('[Evolution webhook] Failed to create thread', { connectionId, error: createdThread.error.message });
      return json({ error: 'Falha interna ao criar a conversa.' }, 500);
    }
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
            ? inboundThreadStatus
            : threadResult.data?.status ?? 'resolved',
        last_message_at: parsed.sentAt,
        updated_at: now,
        metadata: buildConversationThreadMetadataUpdate(threadResult.data?.metadata, {
          provider: 'evolution',
          adClick: threadAdClick,
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
              ? ['human_active', 'human_queue'].includes(inboundThreadStatus)
              : undefined,
          aiLockedReason:
            parsed.direction === 'inbound'
              ? aiEnabled
                ? threadResult.data?.status === 'resolved'
                  ? null
                  : undefined
                : 'connection_ai_disabled'
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

    if (updatedThread.error) {
      console.error('[Evolution webhook] Failed to update thread', { connectionId, error: updatedThread.error.message });
      return json({ error: 'Falha interna ao atualizar a conversa.' }, 500);
    }
  }

  const insertedMessage = await admin
    .from('conversation_messages')
    .insert({
      thread_id: threadId,
      organization_id: connectionResult.data.organization_id,
      channel_connection_id: connectionId,
      direction: parsed.direction,
      message_type: parsed.messageType,
      author_name: parsed.direction === 'inbound' ? parsed.contactName : connectionResult.data.name,
      content,
      provider_message_id: parsed.providerMessageId,
      delivery_status: 'sent',
      // Fix achado X: sem raw_payload (PII crua redundante — conteúdo já vai em `content`).
      metadata: buildEvolutionMessageMetadata({
        event: parsed.event,
        providerMessageId: parsed.providerMessageId,
        media: parsed.media ? { ...parsed.media, status: 'recorded' } : null,
      }),
      sent_at: parsed.sentAt,
      created_at: now,
    })
    .select('id')
    .single();

  if (insertedMessage.error) {
    if (insertedMessage.error.code === '23505' && parsed.providerMessageId) {
      const duplicate = await admin
        .from('conversation_messages')
        .select('id, thread_id')
        .eq('channel_connection_id', connectionId)
        .eq('provider_message_id', parsed.providerMessageId)
        .single();
      if (!duplicate.error && duplicate.data) {
        return json({
          ok: true,
          duplicate: true,
          thread_id: duplicate.data.thread_id,
          message_id: duplicate.data.id,
        });
      }
    }
    console.error('[Evolution webhook] Failed to insert message', { connectionId, error: insertedMessage.error.message });
    return json({ error: 'Falha interna ao registrar a mensagem.' }, 500);
  }

  // 2c (decisão do Junior, 13/09): NÃO existe palavra de parada fixa. Quem reconhece que o lead
  // não quer mais ("não tenho interesse", "já marquei com outro") é a IA de atendimento (1a),
  // que então chama `record_automation_opt_out`; o gate no banco continua recusando envio real
  // a contato com opt-out.

  if (parsed.direction === 'inbound' && parsed.providerMessageId) {
    const waitResolution = await admin.rpc('resolve_automation_wait_from_inbox', {
      p_channel_connection_id: connectionId,
      p_provider_message_id: parsed.providerMessageId,
      p_thread_id: threadId,
      p_message_id: insertedMessage.data.id,
      p_quoted_provider_message_id: parsed.quotedProviderMessageId,
      p_received_at: parsed.sentAt,
    });
    if (waitResolution.error) {
      return json({ error: 'Falha ao correlacionar resposta da automação.' }, 500);
    }
  }

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
      console.error('[Evolution webhook] Failed to create opportunity', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return json({ error: 'Falha interna ao criar a oportunidade.' }, 500);
    }
  }

  // 3a: etiqueta do clique (ctwa_clid) + anúncio no histórico de origem, com primeiro/último
  // toque no negócio. Não derruba o webhook se falhar: a mensagem já está gravada e um
  // reenvio da Evolution cairia no dedupe sem repetir esta etapa. Fica no log do servidor e
  // na resposta, que aparece no painel de webhooks da Evolution.
  let adAttributionError: string | null = null;
  if (parsed.direction === 'inbound' && parsed.adClick) {
    const attribution = await admin.rpc('record_whatsapp_ad_attribution', {
      p_organization_id: connectionResult.data.organization_id,
      p_channel_connection_id: connectionId,
      p_provider_message_id: parsed.providerMessageId ?? insertedMessage.data.id,
      p_observed_at: parsed.sentAt,
      p_deal_id: dealId,
      p_contact_id: contactId,
      p_ctwa_clid: parsed.adClick.ctwaClid,
      p_ad_title: parsed.adClick.title,
      p_ad_source_id: parsed.adClick.sourceId,
      p_ad_source_url: parsed.adClick.sourceUrl,
      p_ad_source_app: parsed.adClick.sourceApp,
      p_ad_media_url: parsed.adClick.mediaUrl,
    });
    if (attribution.error) {
      adAttributionError = attribution.error.message;
      console.warn('[Evolution webhook] Falha ao registrar clique de anúncio', {
        connectionId,
        threadId,
        dealId,
        providerMessageId: parsed.providerMessageId,
        error: attribution.error.message,
      });
    }
  }

  // 3d: "lead respondeu" = mensagem do lead numa conversa em que a clínica já tinha falado
  // (a leitura da conversa feita ANTES desta mensagem diz se houve saída). Um marco por
  // negócio (a função devolve o que já existe); a região por DDD é decidida no banco. Não
  // derruba o webhook se falhar.
  const previousOutboundAt = readConversationThreadMetadata(threadResult.data?.metadata).lastOutboundAt;
  if (parsed.direction === 'inbound' && dealId && previousOutboundAt) {
    const replied = await admin.rpc('record_lead_replied_event', {
      p_organization_id: connectionResult.data.organization_id,
      p_deal_id: dealId,
      p_contact_id: contactId,
      p_occurred_at: parsed.sentAt,
      p_phone: canonicalPhone,
    });
    if (replied.error) {
      console.warn('[Evolution webhook] Falha ao registrar resposta do lead', {
        connectionId,
        threadId,
        dealId,
        error: replied.error.message,
      });
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

  if (connectionUpdate.error) {
    console.error('[Evolution webhook] Failed to update connection metadata', { connectionId, error: connectionUpdate.error.message });
    return json({ error: 'Falha interna ao atualizar a conexao.' }, 500);
  }

  const automationWebhookUrl = String(connectionConfig.webhookUrl || '').trim();
  const threadStatus =
    parsed.direction === 'inbound'
      ? inboundThreadStatus
      : threadResult.data?.status ?? 'resolved';

  // Encerramento: conversa na fila humana por handoff da IA, lead escreveu de novo, humano ainda nao assumiu.
  const closingCandidate =
    parsed.direction === 'inbound' && aiEnabled && threadStatus === 'human_queue'
      ? resolveClosingReplyEligibility({
          status: threadStatus,
          metadata: (threadResult.data?.metadata as Record<string, unknown> | null) ?? null,
        })
      : null;
  const closingReply = Boolean(closingCandidate?.eligible);

  // Mídia sem texto (só existe com a chave de mídia da conexão ligada): está gravada e o humano vê,
  // mas ninguém a entende ainda. A IA não é agendada, porque responderia a um marcador ("Áudio") e
  // queimaria uma das respostas de encerramento; se a conversa está com ela, o sino avisa.
  const mediaOnly = parsed.direction === 'inbound' && parsed.media?.placeholder === true;
  if (mediaOnly && parsed.media && threadStatus === 'ai_active') {
    const mediaNotification = await admin.from('system_notifications').upsert(
      buildInboundMediaNotification({
        organizationId: connection.organization_id,
        threadId,
        contactLabel: resolvedContactName || canonicalPhone,
        kind: parsed.media.kind,
        createdAt: now,
      }),
      { onConflict: 'id' },
    );
    if (mediaNotification.error) {
      console.warn('[Evolution webhook] Falha ao avisar mídia sem texto', {
        connectionId,
        threadId,
        error: mediaNotification.error.message,
      });
    }
  }

  if (parsed.direction === 'inbound' && !mediaOnly && (threadStatus === 'ai_active' || closingReply)) {
    const aiDebounceMs = 7000;
    const aiPendingToken = `${insertedMessage.data.id}:${Date.now()}`;

    // 🐛 BUG REAL (28/07/2026): aqui existia um update REDUNDANTE que reconstruía a
    // metadata a partir de `threadResult.data?.metadata` — a foto lida ANTES do
    // update que soma o não-lido. Efeito: o unreadCount ia a 1 e milissegundos
    // depois voltava a 0 — nenhuma conversa com IA ativa acumulava não-vistas, e
    // o número do menu/notificação nunca aparecia. Todos os campos que ele
    // gravava (prévia, hora, autor…) já foram gravados acima; o marcador do
    // debounce abaixo parte de uma leitura FRESCA e preserva o contador.
    const threadMetadataResult = await admin
      .from('conversation_threads')
      .select('metadata, status')
      .eq('id', threadId)
      .eq('organization_id', connectionResult.data.organization_id)
      .maybeSingle();

    if (threadMetadataResult.error) {
      console.error('[Evolution webhook] Failed to update thread metadata', { connectionId, error: threadMetadataResult.error.message });
      return json({ error: 'Falha interna ao atualizar a conversa.' }, 500);
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
      console.error('[Evolution webhook] Failed to schedule AI reply', { connectionId, error: debounceMarkResult.error.message });
      return json({ error: 'Falha interna ao preparar a resposta automatica.' }, 500);
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
    ...(adAttributionError ? { ad_attribution_error: adAttributionError } : {}),
  });
}
