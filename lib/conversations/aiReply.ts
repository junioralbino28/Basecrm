import 'server-only';

import { randomUUID } from 'node:crypto';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { AI_DEFAULT_MODELS } from '@/lib/ai/defaults';
import { getModel, type AIProvider } from '@/lib/ai/config';
import { getResolvedPrompt } from '@/lib/ai/prompts/server';
import { renderPromptTemplate } from '@/lib/ai/prompts/render';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { loadConversationThreadInboxItem } from '@/lib/conversations/server';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';
import { resolveConversationAIAgentConfig } from '@/lib/conversations/aiAgentConfig';
import {
  buildConversationHandoff,
  buildConversationHandoffNotification,
  ConversationHandoffTypeSchema,
  type ConversationHandoff,
  type ConversationHandoffType,
} from '@/lib/conversations/handoff';
import { buildConversationScopedEventId } from '@/lib/conversations/handoffEventId';
import { buildConversationMeetingActivity } from '@/lib/conversations/meetingRequest';
import { applyMeetingReplyPolicy } from '@/lib/conversations/meetingReplyPolicy';
import { loadFreshConversationAIGate } from '@/lib/conversations/conversationAIGate';
import { recordConversationAIFailure } from '@/lib/conversations/conversationAIFailure';
import { mergeConversationDeliveryMetadata } from '@/lib/conversations/conversationDeliveryMetadata';
import {
  buildMeetingSlots,
  formatMeetingAvailabilityContext,
  isHumanConfirmationMeetingRequest,
  resolveConversationCalendarConfig,
  type MeetingSlot,
} from '@/lib/conversations/meetingAvailability';
import { mapConversationCalendarBlockRow } from '@/lib/conversations/calendarBlocks';
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
  contact_id: string | null;
  deal_id: string | null;
  contact_name: string | null;
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
  handoffType: ConversationHandoffTypeSchema.nullable().optional(),
  handoffReason: z.string().max(240).nullable().optional(),
  requestedScheduleAt: z.string().datetime({ offset: true }).nullable().optional(),
  requestedScheduleText: z.string().max(160).nullable().optional(),
});

export type ConversationAIReplyPayload = {
  threadId: string;
  replyText: string;
  summary?: string | null;
  shouldHandoff?: boolean;
  handoffType?: ConversationHandoffType | null;
  handoffReason?: string | null;
  requestedScheduleAt?: string | null;
  requestedScheduleText?: string | null;
  notificationEventId?: string;
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

function splitReplyIntoParts(replyText: string) {
  const normalized = String(replyText || '').replace(/\r/g, '').trim();
  if (!normalized) return [];

  const explicitParts = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const sourceParts = explicitParts.length > 1 ? explicitParts : [normalized];
  const finalParts: string[] = [];

  for (const part of sourceParts) {
    if (part.length <= 240) {
      finalParts.push(part);
      continue;
    }

    const sentences = part
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    if (sentences.length <= 1) {
      finalParts.push(part);
      continue;
    }

    let buffer = '';
    for (const sentence of sentences) {
      const candidate = buffer ? `${buffer} ${sentence}` : sentence;
      if (candidate.length > 240 && buffer) {
        finalParts.push(buffer.trim());
        buffer = sentence;
      } else {
        buffer = candidate;
      }
    }

    if (buffer.trim()) {
      finalParts.push(buffer.trim());
    }
  }

  return finalParts.slice(0, 3);
}

async function loadAvailableMeetingSlots(input: {
  admin: AdminClient;
  organizationId: string;
  connectionId: string;
  connectionConfig: Record<string, unknown> | null | undefined;
  now: string;
}) {
  const calendar = resolveConversationCalendarConfig(input.connectionConfig);
  if (!calendar) {
    return {
      calendar: null,
      availableMeetingSlots: [] as MeetingSlot[],
      calendarContext: 'AGENDA_NAO_CONFIGURADA. Nao ofereca nem confirme horarios.',
    };
  }

  const nowTimestamp = new Date(input.now).getTime();
  const rangeStart = new Date(nowTimestamp - 60 * 60_000).toISOString();
  const rangeEnd = new Date(
    nowTimestamp + (calendar.schedulingHorizonDays + 1) * 24 * 60 * 60_000,
  ).toISOString();
  let busyQuery = input.admin
    .from('activities')
    .select('date')
    .eq('organization_id', input.organizationId)
    .eq('type', 'MEETING')
    .eq('completed', false)
    .is('deleted_at', null)
    .gte('date', rangeStart)
    .lte('date', rangeEnd);
  busyQuery = calendar.ownerId
    ? busyQuery.eq('owner_id', calendar.ownerId)
    : busyQuery.is('owner_id', null);

  const busyResult = await busyQuery;
  if (busyResult.error) {
    console.warn('[Conversation AI] Failed to load calendar availability', {
      organizationId: input.organizationId,
      error: busyResult.error.message,
    });
    return {
      calendar: null,
      availableMeetingSlots: [] as MeetingSlot[],
      calendarContext: 'AGENDA_TEMPORARIAMENTE_INDISPONIVEL. Nao ofereca nem confirme horarios.',
    };
  }

  const blocksResult = await input.admin
    .from('conversation_calendar_blocks')
    .select('id, title, kind, recurrence, block_date, weekdays, start_time, end_time, all_day')
    .eq('organization_id', input.organizationId)
    .eq('channel_connection_id', input.connectionId)
    .eq('owner_id', calendar.ownerId);
  if (blocksResult.error) {
    console.warn('[Conversation AI] Failed to load calendar blocks', {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      error: blocksResult.error.message,
    });
    return {
      calendar: null,
      availableMeetingSlots: [] as MeetingSlot[],
      calendarContext: 'AGENDA_TEMPORARIAMENTE_INDISPONIVEL. Nao ofereca nem confirme horarios.',
    };
  }

  const availableMeetingSlots = buildMeetingSlots({
    calendar,
    now: input.now,
    busyStarts: (busyResult.data || []).map(row => String(row.date || '')).filter(Boolean),
    calendarBlocks: (blocksResult.data || []).map(mapConversationCalendarBlockRow),
    maxSlots: 200,
  });
  const calendarContext = formatMeetingAvailabilityContext(availableMeetingSlots, calendar);

  return { calendar, availableMeetingSlots, calendarContext };
}

export async function generateConversationAutoReply(params: {
  admin: AdminClient;
  organizationId: string;
  connectionId: string;
  contactName: string | null;
  contactPhone: string;
  recentMessages: RecentMessage[];
  promptKey?: string;
}) {
  const {
    admin,
    organizationId,
    connectionId,
    contactName,
    contactPhone,
    recentMessages,
    promptKey = 'task_conversations_whatsapp_auto_reply',
  } = params;

  const generationGate = await loadFreshConversationAIGate({
    admin,
    connectionId,
    organizationId,
  });
  if (!generationGate.ok) {
    return { ok: false as const, reason: generationGate.reason };
  }
  const generationConnectionConfig = generationGate.connection.config;

  const { data: orgSettings, error: orgError } = await admin
    .from('organization_settings')
    .select('ai_enabled, ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key, automation_timezone')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (orgError) throw new Error(orgError.message);

  if (orgSettings?.ai_enabled !== true) {
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
    promptKey
  );
  if (!resolvedPrompt) {
    return { ok: false as const, reason: 'missing_prompt' };
  }

  const currentDateTime = new Date().toISOString();
  const calendarAvailability = await loadAvailableMeetingSlots({
    admin,
    organizationId,
    connectionId,
    connectionConfig: generationConnectionConfig,
    now: currentDateTime,
  });
  const prompt = renderPromptTemplate(resolvedPrompt.content, {
    organizationName: organization?.name || 'Organizacao',
    contactName: contactName || 'Lead',
    contactPhone,
    currentDateTime,
    timezone: calendarAvailability.calendar?.timezone
      || (typeof orgSettings?.automation_timezone === 'string' && orgSettings.automation_timezone.trim()
        ? orgSettings.automation_timezone.trim().slice(0, 64)
        : 'America/Sao_Paulo'),
    recentMessagesText: formatRecentMessages(recentMessages),
    calendarContext: calendarAvailability.calendarContext,
  });

  const result = await generateText({
    model,
    maxRetries: 2,
    maxOutputTokens: 1200,
    output: Output.object({ schema: ConversationAutoReplySchema }),
    prompt,
  });

  const generated = result.output;
  let replyText = generated.replyText.trim();
  let handoffType = generated.handoffType ?? null;
  let requestedScheduleAt = generated.requestedScheduleAt ?? null;
  const normalizedScheduleAt = requestedScheduleAt
    && Number.isFinite(new Date(requestedScheduleAt).getTime())
    ? new Date(requestedScheduleAt).toISOString()
    : null;
  const confirmedSlotIsAvailable = handoffType === 'meeting_confirmed'
    && normalizedScheduleAt
    && calendarAvailability.availableMeetingSlots.some(slot => slot.startAt === normalizedScheduleAt);
  const requiresHumanConfirmation = Boolean(
    calendarAvailability.calendar
    && isHumanConfirmationMeetingRequest({
      calendar: calendarAvailability.calendar,
      requestedScheduleAt: normalizedScheduleAt,
      requestedScheduleText: generated.requestedScheduleText,
    }),
  );

  ({ replyText, handoffType, requestedScheduleAt } = applyMeetingReplyPolicy({
    replyText,
    handoffType,
    requestedScheduleAt: normalizedScheduleAt,
    requestedScheduleText: generated.requestedScheduleText,
    requiresHumanConfirmation,
    availableSlots: calendarAvailability.availableMeetingSlots,
    confirmedSlotIsAvailable: Boolean(confirmedSlotIsAvailable),
  }));
  const shouldHandoff = Boolean(handoffType);

  return {
    ok: true as const,
    source: resolvedPrompt.source,
    object: {
      replyText,
      summary: generated.summary?.trim() || null,
      shouldHandoff,
      handoffType: shouldHandoff ? handoffType ?? 'other' : null,
      handoffReason: generated.handoffReason?.trim() || null,
      requestedScheduleAt,
      requestedScheduleText: generated.requestedScheduleText?.trim() || null,
    },
  };
}

async function reserveConfirmedMeeting(input: {
  admin: AdminClient;
  activity: NonNullable<ReturnType<typeof buildConversationMeetingActivity>>;
  connectionId: string;
  timezone: string;
}) {
  const { admin, activity, connectionId, timezone } = input;
  const result = await admin.rpc('reserve_conversation_meeting', {
    p_activity_id: activity.id,
    p_organization_id: activity.organization_id,
    p_channel_connection_id: connectionId,
    p_owner_id: activity.owner_id,
    p_contact_id: activity.contact_id,
    p_deal_id: activity.deal_id,
    p_title: activity.title,
    p_description: activity.description,
    p_date: activity.date,
    p_created_at: activity.created_at,
    p_timezone: timezone,
    p_allow_update: false,
  });
  if (result.error) {
    console.warn('[Conversation AI] Failed to reserve confirmed meeting', {
      organizationId: activity.organization_id,
      error: result.error.message,
    });
    return false;
  }
  return result.data === true;
}

export async function executeConversationAIReply(params: {
  admin: AdminClient;
  connection: ChannelConnectionRow;
  payload: ConversationAIReplyPayload;
}) {
  const { admin, connection, payload } = params;

  if (connection.config?.aiEnabled !== true) {
    return { ok: true as const, ignored: true as const, reason: 'connection_ai_disabled' };
  }

  const gate = await loadFreshConversationAIGate({
    admin,
    connectionId: connection.id,
    organizationId: connection.organization_id,
  });
  if (!gate.ok) {
    return { ok: true as const, ignored: true as const, reason: gate.reason };
  }
  const activeConnection = gate.connection;

  const threadResult = await admin
    .from('conversation_threads')
    .select('id, organization_id, channel_connection_id, contact_id, deal_id, contact_name, contact_phone, status, metadata, assigned_user_id')
    .eq('id', payload.threadId)
    .eq('organization_id', activeConnection.organization_id)
    .eq('channel_connection_id', activeConnection.id)
    .maybeSingle();

  if (threadResult.error) throw new Error(threadResult.error.message);
  if (!threadResult.data) throw new Error('Thread nao encontrada');

  const thread = threadResult.data as ConversationThreadRow;
  if (thread.status === 'human_active' || thread.status === 'human_queue') {
    return { ok: true as const, ignored: true as const, reason: 'thread_em_atendimento_humano' };
  }

  const instanceName = String((activeConnection.config || {}).instanceName || '').trim();
  const resolved = await resolveEvolutionCredentials({
    admin,
    tenantId: activeConnection.organization_id,
    connectionConfig: activeConnection.config || {},
  });

  const sendMode = (((activeConnection.config || {}).sendMode || 'auto') as
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
  const agentName = payload.authorName?.trim()
    || resolveConversationAIAgentConfig(activeConnection.config).agentName;
  let effectiveReplyText = payload.replyText;
  let effectiveHandoffType = payload.handoffType ?? null;
  let effectiveScheduleAt = payload.requestedScheduleAt ?? null;
  let shouldHandoff = Boolean(payload.shouldHandoff || effectiveHandoffType);
  const handoffEventId = shouldHandoff
    ? buildConversationScopedEventId({
        organizationId: activeConnection.organization_id,
        threadId: payload.threadId,
        eventId: payload.notificationEventId || randomUUID(),
      })
    : null;
  const makeHandoff = (): ConversationHandoff | null => shouldHandoff
    ? buildConversationHandoff({
        type: effectiveHandoffType ?? 'other',
        eventId: handoffEventId,
        summary: payload.summary,
        reason: payload.handoffReason,
        requestedAt: now,
        requestedScheduleAt: effectiveScheduleAt,
        requestedScheduleText: payload.requestedScheduleText,
        contactName: thread.contact_name,
        contactPhone: phone,
      })
    : null;
  let handoff = makeHandoff();
  let meetingWasReserved = false;

  if (handoff?.type === 'meeting_confirmed') {
    const latestAvailability = await loadAvailableMeetingSlots({
      admin,
      organizationId: activeConnection.organization_id,
      connectionId: activeConnection.id,
      connectionConfig: activeConnection.config,
      now,
    });
    const confirmedSlotIsStillAvailable = Boolean(
      handoff.requestedScheduleAt
      && latestAvailability.availableMeetingSlots.some(
        slot => slot.startAt === handoff?.requestedScheduleAt,
      ),
    );
    const confirmedActivity = latestAvailability.calendar && confirmedSlotIsStillAvailable
      ? buildConversationMeetingActivity({
          organizationId: activeConnection.organization_id,
          eventId: handoff.eventId!,
          contactId: thread.contact_id,
          dealId: thread.deal_id,
          ownerId: latestAvailability.calendar.ownerId,
          agentName,
          handoff,
        })
      : null;
    meetingWasReserved = Boolean(
      confirmedActivity
      && await reserveConfirmedMeeting({
        admin,
        activity: confirmedActivity,
        connectionId: activeConnection.id,
        timezone: latestAvailability.calendar!.timezone,
      }),
    );

    if (!meetingWasReserved) {
      effectiveReplyText = 'Esse horario acabou de ficar indisponivel ou a agenda nao respondeu. Registrei sua preferencia para continuarmos com voce.';
      effectiveHandoffType = 'meeting_requested';
      effectiveScheduleAt = null;
      shouldHandoff = true;
      handoff = makeHandoff();
    }
  }

  const replyParts = splitReplyIntoParts(effectiveReplyText);
  if (replyParts.length === 0) {
    throw new Error('Resposta da IA vazia.');
  }

  let deliveryMetadata: Record<string, unknown> = mergeConversationDeliveryMetadata(payload.metadata, {
    provider: 'evolution',
    automation_source: payload.automationSource || 'native_crm',
    ai_summary: payload.summary ?? null,
    ai_handoff_type: handoff?.type ?? null,
    ai_handoff_reason: payload.handoffReason ?? null,
    ai_requested_schedule_at: handoff?.requestedScheduleAt ?? null,
    ai_requested_schedule_text: handoff?.requestedScheduleText ?? null,
    ai_reply_parts: replyParts.length,
  });
  let deliveryWarning: string | null = null;

  try {
    const sendResults: Array<Awaited<ReturnType<typeof sendEvolutionTextMessage>>> = [];

    for (const part of replyParts) {
      const sendResult = await sendEvolutionTextMessage({
        apiUrl: resolved.apiUrl,
        instanceName,
        apiKey: resolved.apiKey,
        phone,
        text: part,
        sendMode,
      });
      sendResults.push(sendResult);
    }

    deliveryMetadata = {
      ...deliveryMetadata,
      provider_message_id: sendResults.at(-1)?.providerMessageId ?? null,
      provider_message_ids: sendResults.map((result) => result.providerMessageId).filter(Boolean),
      delivery_status: 'sent',
      delivery_provider: 'evolution',
      delivery_attempt: sendResults.at(-1)?.attemptLabel ?? 'unknown',
      delivery_raw: sendResults.map((result) => result.raw),
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

  const outboundRows = replyParts.map((part, index) => ({
    thread_id: payload.threadId,
    organization_id: activeConnection.organization_id,
    direction: 'outbound' as const,
    message_type: 'text',
    author_name: agentName,
    content: part,
    metadata: {
      ...deliveryMetadata,
      reply_part_index: index,
      reply_part_total: replyParts.length,
    },
    sent_at: now,
    created_at: now,
  }));

  const insertedMessages = await admin
    .from('conversation_messages')
    .insert(outboundRows)
    .select('id');

  if (insertedMessages.error) throw new Error(insertedMessages.error.message);

  const deliveryFailed = Boolean(deliveryWarning);
  const requiresHumanAttention = shouldHandoff || deliveryFailed;
  const failureReason = deliveryFailed ? 'ai_delivery_failure' : null;
  const nextStatus = requiresHumanAttention ? 'human_queue' : 'ai_active';
  const nextMetadata = buildConversationThreadMetadataUpdate(thread.metadata, {
    direction: 'outbound',
    preview: replyParts.at(-1)?.trim().slice(0, 160) || effectiveReplyText.trim().slice(0, 160),
    messageType: 'text',
    sentAt: now,
    authorName: agentName,
    unreadCount: 0,
    routingMode: requiresHumanAttention ? 'human' : 'ai',
    humanLocked: requiresHumanAttention,
    aiLockedReason: requiresHumanAttention ? handoff?.reason ?? failureReason ?? 'human_handoff' : null,
    handoffRequestedAt: requiresHumanAttention ? now : null,
    handoffReason: requiresHumanAttention ? handoff?.reason ?? failureReason ?? 'human_handoff' : null,
    handoff,
    queueAssignedUserId: shouldHandoff ? thread.assigned_user_id ?? null : null,
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
    .eq('organization_id', activeConnection.organization_id);

  if (threadUpdate.error) throw new Error(threadUpdate.error.message);

  if (deliveryFailed) {
    const failureResult = await recordConversationAIFailure({
      admin,
      organizationId: activeConnection.organization_id,
      threadId: payload.threadId,
      eventId: payload.notificationEventId || `${payload.threadId}:${now}`,
      contactLabel: thread.contact_name || thread.contact_phone || 'Lead',
      stage: 'delivery',
      metadata: nextMetadata,
    });
    if (!failureResult.ok) {
      const warning = 'Falha ao registrar alerta operacional da resposta automatica.';
      deliveryWarning = deliveryWarning ? `${deliveryWarning} | ${warning}` : warning;
      console.warn('[Conversation AI] Failed to persist delivery failure alert', {
        organizationId: activeConnection.organization_id,
        threadId: payload.threadId,
        threadError: failureResult.threadError,
        notificationError: failureResult.notificationError,
      });
    }
  }

  if (handoff) {
    const configuredCalendar = resolveConversationCalendarConfig(activeConnection.config);
    const meetingActivity = buildConversationMeetingActivity({
      organizationId: activeConnection.organization_id,
      eventId: handoff.eventId!,
      contactId: thread.contact_id,
      dealId: thread.deal_id,
      ownerId: configuredCalendar?.ownerId ?? thread.assigned_user_id,
      agentName,
      handoff,
    });

    if (meetingActivity && !meetingWasReserved) {
      const meetingResult = await admin
        .from('activities')
        .upsert(meetingActivity, { onConflict: 'id' });

      if (meetingResult.error) {
        const warning = `Falha ao registrar reuniao solicitada: ${meetingResult.error.message}`;
        deliveryWarning = deliveryWarning ? `${deliveryWarning} | ${warning}` : warning;
        console.warn('[Conversation AI] Failed to persist meeting activity', {
          organizationId: activeConnection.organization_id,
          threadId: payload.threadId,
          error: meetingResult.error.message,
        });
      }
    }

    const handoffNotification = buildConversationHandoffNotification({
      organizationId: activeConnection.organization_id,
      threadId: payload.threadId,
      eventId: handoff.eventId!,
      handoff,
    });
    const notificationResult = await admin
      .from('system_notifications')
      .upsert(handoffNotification, { onConflict: 'id' });

    if (notificationResult.error) {
      const warning = `Falha ao registrar alerta de handoff: ${notificationResult.error.message}`;
      deliveryWarning = deliveryWarning ? `${deliveryWarning} | ${warning}` : warning;
      console.warn('[Conversation AI] Failed to persist handoff notification', {
        organizationId: activeConnection.organization_id,
        threadId: payload.threadId,
        error: notificationResult.error.message,
      });
    }
  }

  if (requiresHumanAttention) {
    const paused = await admin.rpc('pause_automation_enrollments_for_thread', {
      p_thread_id: payload.threadId,
      p_actor_id: null,
      p_reason: deliveryFailed ? 'ai_delivery_failure' : 'ai_handoff',
    });
    if (paused.error) {
      const warning = `Falha ao pausar automacoes no handoff: ${paused.error.message}`;
      deliveryWarning = deliveryWarning ? `${deliveryWarning} | ${warning}` : warning;
      console.warn('[Conversation AI] Failed to pause automations after handoff', {
        organizationId: activeConnection.organization_id,
        threadId: payload.threadId,
        error: paused.error.message,
      });
    }
  }

  if (payload.summary?.trim()) {
    const summaryInsert = await admin.from('conversation_messages').insert({
      thread_id: payload.threadId,
      organization_id: activeConnection.organization_id,
      direction: 'internal',
      message_type: 'note',
      author_name: agentName,
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

  const threadItem = await loadConversationThreadInboxItem(admin, activeConnection.organization_id, payload.threadId);
  return {
    ok: true as const,
    warning: deliveryWarning,
    thread: threadItem,
    status: nextStatus,
  };
}
