import 'server-only';

import { randomUUID } from 'node:crypto';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { z } from 'zod';
import { AI_DEFAULT_MODELS } from '@/lib/ai/defaults';
import { getModel, type AIProvider } from '@/lib/ai/config';
import { getResolvedPrompt } from '@/lib/ai/prompts/server';
import { renderPromptTemplate } from '@/lib/ai/prompts/render';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { loadConversationThreadInboxItem } from '@/lib/conversations/server';
import {
  DEFAULT_MEETING_HOST_NAME,
  formatLocalDateTimeForPrompt,
  pickMeetingHostName,
  readConfiguredMeetingHostName,
} from '@/lib/conversations/aiPromptContext';
import {
  buildClosingReplyMetadata,
  buildClosingStageContext,
  buildConfirmedMeetingStageContext,
  readMeetingChannelText,
  resolveClosingReplyEligibility,
} from '@/lib/conversations/closingReply';
import { repairStructuredOutputText } from '@/lib/conversations/aiOutputRepair';
import { buildContactProfileUpdate, normalizeLeadEmail, normalizeLeadSegment } from '@/lib/conversations/leadProfile';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';
import { buildIdleNudgeClearedMetadata } from '@/lib/conversations/idleNudge';
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
import { loadGoogleBusyIntervals } from '@/lib/googleCalendar/freeBusy';
import { readInboundMediaMetadata } from '@/lib/conversations/inboundMedia';
import {
  describeInboundMediaForAI,
  INBOUND_MEDIA_AI_RULES,
  resolveConfirmedLeadEmail,
} from '@/lib/conversations/inboundMediaPrompt';
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
  /** So `metadata.media` e lido aqui (selo de midia recebida, escrito pelo servidor). */
  metadata?: unknown;
};

export const ConversationAutoReplySchema = z.object({
  replyText: z.string().min(1).max(4000),
  summary: z.string().max(2000).nullable().optional(),
  shouldHandoff: z.boolean().optional().default(false),
  handoffType: ConversationHandoffTypeSchema.nullable().optional(),
  handoffReason: z.string().max(240).nullable().optional(),
  // Sem `.datetime()` aqui de proposito: uma data fora do formato ("amanha 10h", sem offset) vira
  // null na normalizacao logo abaixo, em vez de derrubar a resposta inteira por formato.
  requestedScheduleAt: z.string().max(64).nullable().optional()
    .describe('Data e hora ISO 8601 com offset (ex.: 2026-09-22T10:00:00-03:00) ou null'),
  requestedScheduleText: z.string().max(160).nullable().optional(),
  // Dados minimos antes da reuniao (Junior, 20/09): e-mail para o convite e segmento da empresa.
  leadEmail: z.string().max(160).nullable().optional()
    .describe('E-mail que o lead informou nesta conversa, ou null'),
  leadSegment: z.string().max(120).nullable().optional()
    .describe('Segmento ou nicho da empresa do lead, ou null'),
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
  /** Resposta de encerramento depois do handoff: a conversa fica na fila humana e nada de novo e aberto. */
  closingReply?: boolean;
  /** E-mail e segmento informados pelo lead; vao para o contato (sem sobrescrever e-mail ja cadastrado). */
  leadEmail?: string | null;
  leadSegment?: string | null;
};

export function formatRecentMessages(messages: RecentMessage[]) {
  if (!messages.length) {
    return 'Sem historico anterior. Considere que pode ser o primeiro contato.';
  }

  let hasMedia = false;
  const lines = messages
    .map((message) => {
      const direction =
        message.direction === 'outbound'
          ? 'CRM'
          : message.direction === 'internal'
            ? 'INTERNO'
            : 'LEAD';
      // Midia recebida: a marca vem de `metadata.media`, nunca do texto; mensagem so de midia nao
      // tem texto do lead (o `content` e um marcador do sistema), entao entra como [sem texto].
      const media = readInboundMediaMetadata(message.metadata);
      if (media) hasMedia = true;
      const label = media ? `${direction} (${describeInboundMediaForAI(media)})` : direction;
      const author = String(message.author_name || direction).trim();
      const typed = (media?.placeholder ? '' : String(message.content || '').trim()) || '[sem texto]';
      // Foto com legenda: o que o lead digitou vem primeiro; a descricao automatica vai a parte.
      const content = media?.description ? `${typed} [descricao automatica da midia: ${media.description}]` : typed;
      const sentAt = String(message.sent_at || '').trim();
      return `- ${label} | ${author}${sentAt ? ` | ${sentAt}` : ''}: ${content}`;
    })
    .join('\n');

  // Sem midia no historico o texto e identico ao de sempre, para qualquer agente.
  return hasMedia ? `${INBOUND_MEDIA_AI_RULES}\n${lines}` : lines;
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

export async function loadAvailableMeetingSlots(input: {
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

  // Google Agenda (Fatia 2): sem conexao `connected` para o responsavel, `[]` sem nenhuma
  // chamada de rede — nada muda pra quem nao conecta (teste de regressao byte a byte).
  const googleBusyIntervals = await loadGoogleBusyIntervals({
    admin: input.admin,
    organizationId: input.organizationId,
    ownerId: calendar.ownerId,
    timeMin: rangeStart,
    timeMax: rangeEnd,
  });

  const availableMeetingSlots = buildMeetingSlots({
    calendar,
    now: input.now,
    busyStarts: (busyResult.data || []).map(row => String(row.date || '')).filter(Boolean),
    busyIntervals: googleBusyIntervals,
    calendarBlocks: (blocksResult.data || []).map(mapConversationCalendarBlockRow),
    maxSlots: 200,
  });
  const calendarContext = formatMeetingAvailabilityContext(availableMeetingSlots, calendar);

  return { calendar, availableMeetingSlots, calendarContext };
}

/**
 * Quem conduz as reunioes, para o prompt: nome configurado no numero (`config.meetingHostName`),
 * senao o nome do responsavel da agenda, senao um padrao neutro (o login por e-mail nunca entra).
 */
async function resolveMeetingHostName(input: {
  admin: AdminClient;
  organizationId: string;
  connectionConfig: Record<string, unknown> | null | undefined;
  ownerId: string | null;
}) {
  const configured = readConfiguredMeetingHostName(input.connectionConfig);
  if (configured) return configured;
  if (!input.ownerId) return DEFAULT_MEETING_HOST_NAME;

  const owner = await input.admin
    .from('profiles')
    .select('email, first_name, last_name, nickname')
    .eq('id', input.ownerId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (owner.error) {
    console.warn('[Conversation AI] Failed to load meeting host profile', {
      organizationId: input.organizationId,
      error: owner.error.message,
    });
    return DEFAULT_MEETING_HOST_NAME;
  }
  return pickMeetingHostName({ connectionConfig: input.connectionConfig, ownerProfile: owner.data });
}

export async function generateConversationAutoReply(params: {
  admin: AdminClient;
  organizationId: string;
  connectionId: string;
  contactName: string | null;
  contactPhone: string;
  recentMessages: RecentMessage[];
  promptKey?: string;
  /** Encerramento depois do handoff (ver closingReply.ts): muda a situacao no prompt e proibe novo handoff. */
  closing?: { handoff: ConversationHandoff; repliesUsed: number } | null;
  /** Metadata da conversa (lastHandoff): a IA reconhece lead que volta com reuniao ja confirmada. */
  threadMetadata?: Record<string, unknown> | null;
}) {
  const {
    admin,
    organizationId,
    connectionId,
    contactName,
    contactPhone,
    recentMessages,
    promptKey = 'task_conversations_whatsapp_auto_reply',
    closing = null,
    threadMetadata = null,
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
  const timezone = calendarAvailability.calendar?.timezone
    || (typeof orgSettings?.automation_timezone === 'string' && orgSettings.automation_timezone.trim()
      ? orgSettings.automation_timezone.trim().slice(0, 64)
      : 'America/Sao_Paulo');
  const meetingHostName = await resolveMeetingHostName({
    admin,
    organizationId,
    connectionConfig: generationConnectionConfig,
    ownerId: calendarAvailability.calendar?.ownerId ?? null,
  });
  // Encerramento so vale para prompt desenhado para ele (tem {{conversationStageContext}}). O prompt
  // padrao e overrides antigos continuam mudos depois do handoff, como antes; nada de instrucao colada no topo.
  if (closing && !/\{\{\s*conversationStageContext\s*\}\}/.test(resolvedPrompt.content)) {
    return { ok: false as const, reason: 'closing_unsupported' as const };
  }
  const meetingChannelText = readMeetingChannelText(generationConnectionConfig);
  const conversationStageContext = closing
    ? buildClosingStageContext({
        handoff: closing.handoff,
        repliesUsed: closing.repliesUsed,
        meetingHostName,
        timezone,
        meetingChannelText,
      })
    : buildConfirmedMeetingStageContext({
        metadata: threadMetadata,
        meetingHostName,
        timezone,
        meetingChannelText,
        now: currentDateTime,
      }) ?? 'ATENDIMENTO EM ANDAMENTO.';
  const prompt = renderPromptTemplate(resolvedPrompt.content, {
    organizationName: organization?.name || 'Organizacao',
    contactName: contactName || 'Lead',
    contactPhone,
    currentDateTime,
    // Data local com dia da semana: "amanha" e "terca" so fazem sentido no fuso da agenda.
    currentDateTimeLocal: formatLocalDateTimeForPrompt(currentDateTime, timezone),
    timezone,
    meetingHostName,
    meetingChannelText,
    conversationStageContext,
    recentMessagesText: formatRecentMessages(recentMessages),
    calendarContext: calendarAvailability.calendarContext,
  });

  const generateOnce = () => generateText({
    model,
    maxRetries: 2,
    // No Gemini 3 os tokens de raciocinio contam neste teto; 1.200 truncava o JSON e derrubava a
    // resposta (falha "provider" no ensaio de 20/09). A resposta util continua limitada pelo prompt.
    maxOutputTokens: 4096,
    output: Output.object({ schema: ConversationAutoReplySchema }),
    prompt,
  });

  // 2a janela de 20/09: o Gemini devolveu, de vez em quando, algo que nao era o objeto esperado
  // (`AI_NoObjectGeneratedError: could not parse the response`) e a conversa caia na fila humana.
  // Primeiro tenta-se recortar o objeto do texto cru (cerca de markdown, raciocinio em volta); se nao
  // der, uma segunda geracao. So a segunda falha vira falha de provedor.
  let generated: z.infer<typeof ConversationAutoReplySchema>;
  try {
    generated = (await generateOnce()).output;
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    const rawText = typeof error.text === 'string' ? error.text : null;
    const repairedText = repairStructuredOutputText(rawText);
    const repaired = repairedText ? ConversationAutoReplySchema.safeParse(JSON.parse(repairedText)) : null;
    if (repaired?.success) {
      console.warn('[Conversation AI] Structured output repaired from raw text', { organizationId });
      generated = repaired.data;
    } else {
      console.warn('[Conversation AI] Structured output could not be parsed; retrying once', {
        organizationId,
        finishReason: error.finishReason ?? null,
        text: rawText ? rawText.slice(0, 300) : null,
      });
      generated = (await generateOnce()).output;
    }
  }
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

  if (closing) {
    // Encerramento nunca abre handoff novo nem mexe na agenda.
    handoffType = null;
    requestedScheduleAt = null;
  } else {
    ({ replyText, handoffType, requestedScheduleAt } = applyMeetingReplyPolicy({
      replyText,
      handoffType,
      requestedScheduleAt: normalizedScheduleAt,
      requestedScheduleText: generated.requestedScheduleText,
      requiresHumanConfirmation,
      availableSlots: calendarAvailability.availableMeetingSlots,
      confirmedSlotIsAvailable: Boolean(confirmedSlotIsAvailable),
    }));
  }
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
      // Trava em codigo (SPEC-midia-recebida + emenda de 21/09): e-mail que so existe na transcricao de um
      // audio nunca vai para o contato, mesmo que o modelo o devolva. Vale o digitado, ou o que a resposta
      // anterior escreveu para o lead conferir ("voce disse que seu e-mail e X, esta certo?") e ele confirmou.
      leadEmail: resolveConfirmedLeadEmail(recentMessages, normalizeLeadEmail(generated.leadEmail)),
      leadSegment: normalizeLeadSegment(generated.leadSegment),
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
  const closingReply = payload.closingReply === true;
  // Encerramento (closingReply) so passa em human_queue: human_active e um humano falando.
  if (thread.status === 'human_active' || (thread.status === 'human_queue' && !closingReply)) {
    return { ok: true as const, ignored: true as const, reason: 'thread_em_atendimento_humano' };
  }

  const now = new Date().toISOString();
  let closingMetadata: Record<string, unknown> | null = null;
  if (closingReply) {
    // Revisao de 20/09: a elegibilidade e re-checada no estado fresco e a resposta e REIVINDICADA de
    // forma atomica antes do envio (compare-and-set no contador e no status). Duas geracoes sobrepostas
    // nunca passam do limite; um humano que assumiu, resolveu ou devolveu a conversa no meio do
    // caminho faz a reivindicacao falhar e nada e enviado.
    const eligibility = resolveClosingReplyEligibility({ status: thread.status, metadata: thread.metadata, now });
    if (!eligibility.eligible) {
      return { ok: true as const, ignored: true as const, reason: 'closing_not_eligible' as const };
    }
    const claimedMetadata = buildClosingReplyMetadata(
      (thread.metadata || {}) as Record<string, unknown>,
      { sentAt: now, repliesUsed: eligibility.repliesUsed },
    );
    const claimBase = admin
      .from('conversation_threads')
      .update({ updated_at: now, metadata: claimedMetadata })
      .eq('id', thread.id)
      .eq('organization_id', activeConnection.organization_id)
      .eq('status', 'human_queue');
    const claim = await (eligibility.repliesUsed === 0
      ? claimBase.or('metadata->>aiClosingReplies.is.null,metadata->>aiClosingReplies.eq.0')
      : claimBase.eq('metadata->>aiClosingReplies', String(eligibility.repliesUsed))
    ).select('id');
    if (claim.error) throw new Error(claim.error.message);
    if (!claim.data || claim.data.length === 0) {
      return { ok: true as const, ignored: true as const, reason: 'closing_claimed' as const };
    }
    closingMetadata = claimedMetadata;
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

  const agentName = payload.authorName?.trim()
    || resolveConversationAIAgentConfig(activeConnection.config).agentName;
  let effectiveReplyText = payload.replyText;
  let effectiveHandoffType = closingReply ? null : payload.handoffType ?? null;
  let effectiveScheduleAt = closingReply ? null : payload.requestedScheduleAt ?? null;
  let shouldHandoff = !closingReply && Boolean(payload.shouldHandoff || effectiveHandoffType);
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

  // E-mail e segmento que o lead informou vao para o contato. Nunca sobrescreve e-mail existente;
  // falha aqui nao derruba a resposta (ja enviada), so avisa.
  if (thread.contact_id && (payload.leadEmail || payload.leadSegment)) {
    const contactResult = await admin
      .from('contacts')
      .select('email, notes')
      .eq('id', thread.contact_id)
      .eq('organization_id', activeConnection.organization_id)
      .maybeSingle();
    const profileUpdate = contactResult.error
      ? null
      : buildContactProfileUpdate({
          contact: contactResult.data,
          leadEmail: payload.leadEmail,
          leadSegment: payload.leadSegment,
        });
    if (profileUpdate) {
      const contactUpdate = await admin
        .from('contacts')
        .update({ ...profileUpdate, updated_at: now })
        .eq('id', thread.contact_id)
        .eq('organization_id', activeConnection.organization_id);
      if (contactUpdate.error) {
        console.warn('[Conversation AI] Failed to save lead profile on contact', {
          organizationId: activeConnection.organization_id,
          contactId: thread.contact_id,
          error: contactUpdate.error.message,
        });
      }
    }
  }

  const deliveryFailed = Boolean(deliveryWarning);
  const requiresHumanAttention = shouldHandoff || deliveryFailed;
  const failureReason = deliveryFailed ? 'ai_delivery_failure' : null;
  // Encerramento: a conversa continua na fila humana, com travas, motivo e nao lidas como estavam;
  // so se registra a saida e se conta a resposta.
  const nextStatus = requiresHumanAttention || closingReply ? 'human_queue' : 'ai_active';
  const nextMetadata = closingReply
    ? buildConversationThreadMetadataUpdate(closingMetadata ?? thread.metadata, {
        direction: 'outbound',
        preview: replyParts.at(-1)?.trim().slice(0, 160) || effectiveReplyText.trim().slice(0, 160),
        messageType: 'text',
        sentAt: now,
        authorName: agentName,
        routingMode: 'human',
        humanLocked: true,
        provider: 'evolution',
      })
    // Toda resposta da IA torna obsoleta a cutucada pendente do silencio anterior: ela sai limpa daqui
    // e processDeferredAIReply agenda a do silencio novo. Sem isso, a foto lida antes do envio podia
    // ressuscitar uma cutucada que o tick ja tinha cancelado porque o lead respondeu (21/09).
    : buildIdleNudgeClearedMetadata({
        metadata: buildConversationThreadMetadataUpdate(thread.metadata, {
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
        }),
      });

  const threadUpdateBase = admin
    .from('conversation_threads')
    .update({
      status: nextStatus,
      last_message_at: now,
      updated_at: now,
      metadata: nextMetadata,
    })
    .eq('id', payload.threadId)
    .eq('organization_id', activeConnection.organization_id);
  // Encerramento: se um humano assumiu, resolveu ou devolveu a conversa durante o envio, o estado dele
  // fica; so o registro da saida e perdido (a mensagem ja esta na conversa).
  // Resposta comum (decisao do Junior, 21/09): a mesma regra. O envio leva segundos; se nesse meio tempo
  // o operador assumiu ou resolveu a conversa, a escrita final nao devolve a conversa para a IA.
  const threadUpdate = closingReply && !deliveryFailed
    ? await threadUpdateBase.eq('status', 'human_queue').select('id')
    : await threadUpdateBase.eq('status', thread.status).select('id');

  if (threadUpdate.error) throw new Error(threadUpdate.error.message);
  const threadStateChanged = Array.isArray(threadUpdate.data) && threadUpdate.data.length === 0;
  if (threadStateChanged) {
    console.warn(closingReply
      ? '[Conversation AI] Closing reply sent but the thread state changed meanwhile'
      : '[Conversation AI] Reply sent but the thread state changed meanwhile; the human state was kept', {
      organizationId: activeConnection.organization_id,
      threadId: payload.threadId,
    });
  }

  if (deliveryFailed) {
    const failureResult = await recordConversationAIFailure({
      admin,
      organizationId: activeConnection.organization_id,
      threadId: payload.threadId,
      eventId: payload.notificationEventId || `${payload.threadId}:${now}`,
      contactLabel: thread.contact_name || thread.contact_phone || 'Lead',
      stage: 'delivery',
      metadata: nextMetadata,
      errorMessage: deliveryWarning,
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
    // Se o estado mudou durante o envio, quem chama (ex.: agendar a cutucada) ve o status de verdade.
    status: threadStateChanged ? threadItem?.status ?? nextStatus : nextStatus,
  };
}
