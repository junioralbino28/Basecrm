import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { carregarVersaoPublicada, type VersaoPublicadaDoAgente } from '@/lib/agents/agentRuntime';
import { AI_DEFAULT_MODELS } from '@/lib/ai/defaults';
import { getModel, type AIProvider } from '@/lib/ai/config';
import { criarFetchContador } from '@/lib/ai/medicaoResposta';
import { getResolvedPrompt } from '@/lib/ai/prompts/server';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { loadConversationThreadInboxItem } from '@/lib/conversations/server';
import { aplicarGateCapacidade } from '@/lib/conversations/gateCapacidade';
import {
  aplicarEtiquetasSugeridas,
  loadTagCatalog,
  resolverEtiquetasSugeridas,
} from '@/lib/conversations/etiquetasSugeridas';
import {
  buildClosingReplyMetadata,
  resolveClosingReplyEligibility,
} from '@/lib/conversations/closingReply';
import { registrarEventoDeResposta, type EventoDeResposta } from '@/lib/conversations/aiReplyEvents';
import { buildContactProfileUpdate, mesmaEmpresa } from '@/lib/conversations/leadProfile';
import {
  buildConversationThreadMetadataUpdate,
  readConversationThreadMetadata,
} from '@/lib/conversations/threadMetadata';
import { buildIdleNudgeClearedMetadata } from '@/lib/conversations/idleNudge';
import { resolveConversationAIAgentConfig } from '@/lib/conversations/aiAgentConfig';
import {
  buildConversationHandoff,
  buildConversationHandoffNotification,
  type ConversationHandoff,
  type ConversationHandoffType,
} from '@/lib/conversations/handoff';
import { buildConversationScopedEventId } from '@/lib/conversations/handoffEventId';
import { buildConversationMeetingActivity } from '@/lib/conversations/meetingRequest';
import { loadFreshConversationAIGate } from '@/lib/conversations/conversationAIGate';
import { recordConversationAIFailure } from '@/lib/conversations/conversationAIFailure';
import { mergeConversationDeliveryMetadata } from '@/lib/conversations/conversationDeliveryMetadata';
import { resolveConversationCalendarConfig } from '@/lib/conversations/meetingAvailability';
import { enqueueGoogleCalendarMeetingEvent } from '@/lib/googleCalendar/meetingEventQueue';
import { toWhatsAppPhone } from '@/lib/phone';
import { createStaticAdminClient } from '@/lib/supabase/server';
import {
  carregarContextoDaResposta,
  loadAvailableMeetingSlots,
  responderComModelo,
  splitReplyIntoParts,
  type RecentMessage,
} from '@/lib/conversations/aiReplyCore';

export { ConversationAutoReplySchema, formatRecentMessages, loadAvailableMeetingSlots } from '@/lib/conversations/aiReplyCore';

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
  /**
   * Central de Agentes: dados do evento de prova. Só o webhook (caminho nativo) manda; a rota do n8n e a
   * cutucada não mandam e não gravam evento. O evento só é gravado depois da entrega.
   */
  replyEvent?: Pick<EventoDeResposta, 'promptSha256' | 'promptKey' | 'promptSource' | 'agentId' | 'agentVersion'>;
  /** E-mail e segmento informados pelo lead; vao para o contato (sem sobrescrever e-mail ja cadastrado). */
  leadEmail?: string | null;
  leadSegment?: string | null;
  /** Nome que o lead disse ter; so troca o do perfil do WhatsApp, nunca o editado a mao. */
  leadName?: string | null;
  /** Empresa ONDE ele trabalha (o ramo continua em leadSegment). */
  leadCompany?: string | null;
  /** Resultado do gate de capacidade decidido neste turno (Cenoura Hub, 27/09). */
  capacityGate?: 'passed' | 'failed' | 'unanswered' | null;
  /** Etiquetas do catalogo apontadas pela IA neste turno; o servidor valida e aplica no negocio. */
  suggestedTags?: string[] | null;
};

export async function generateConversationAutoReply(params: {
  admin: AdminClient;
  organizationId: string;
  connectionId: string;
  contactName: string | null;
  contactPhone: string;
  recentMessages: RecentMessage[];
  /**
   * Chave do prompt da conexão. Ausente = chave padrão, como sempre. `null` = a conexão tem uma chave
   * inválida: sem agente, a resposta falha com `missing_prompt` em vez de cair no prompt padrão.
   */
  promptKey?: string | null;
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
  const inicio = Date.now();

  const generationGate = await loadFreshConversationAIGate({
    admin,
    connectionId,
    organizationId,
  });
  if (!generationGate.ok) {
    return { ok: false as const, reason: generationGate.reason };
  }
  const generationConnectionConfig = generationGate.connection.config;
  // Central de Agentes (fatia 1): número com agente usa a versão publicada. Só o prompt (e o modelo, se a
  // versão tiver um) muda de fonte; variáveis, histórico, render e esquema de saída seguem iguais.
  const agentId = generationGate.connection.ai_agent_id ?? null;
  let agentVersion: VersaoPublicadaDoAgente | null = null;
  if (agentId) {
    const agente = await carregarVersaoPublicada(admin as never, { organizationId, agentId });
    if (!agente.ok) {
      console.warn('[Conversation AI] Linked agent unavailable', { organizationId, connectionId, agentId, reason: agente.motivo });
      return { ok: false as const, reason: 'agent_unavailable' as const };
    }
    agentVersion = agente.versao;
  }

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

  const fetchContador = criarFetchContador();
  const model = getModel(
    provider,
    apiKey,
    agentVersion?.model || orgSettings?.ai_model || AI_DEFAULT_MODELS[provider] || AI_DEFAULT_MODELS.google,
    { fetch: fetchContador.fetch },
  );

  // Com agente, o prompt é o da versão publicada. Sem agente e sem chave válida (`null`), falha como o
  // webhook falhava antes de chamar o gerador, em vez de cair no prompt padrão (corrida de desligar o
  // agente durante o debounce).
  const resolvedPrompt = agentVersion
    ? { content: agentVersion.prompt, source: 'agent' as const }
    : promptKey
      ? await getResolvedPrompt(admin as any, organizationId, promptKey)
      : null;
  if (!resolvedPrompt) {
    return { ok: false as const, reason: 'missing_prompt' };
  }
  // Impressão digital do texto usado, antes de trocar as variáveis. Prova, na resposta real, qual prompt
  // respondeu, e é o que o script de migração compara antes de ligar um número a um agente.
  const promptSha256 = createHash('sha256').update(resolvedPrompt.content, 'utf8').digest('hex');

  const carregado = await carregarContextoDaResposta({
    admin,
    organizationId,
    connection: { id: connectionId, config: generationConnectionConfig ?? null },
    promptContent: resolvedPrompt.content,
    organizationName: organization?.name ?? null,
    automationTimezone: orgSettings?.automation_timezone,
    contactName,
    contactPhone,
    recentMessages,
    closing,
    threadMetadata,
  });
  if (!carregado.ok) return { ok: false as const, reason: carregado.reason };
  const resposta = await responderComModelo({
    model,
    fetchContador,
    organizationId,
    inicio,
    contexto: carregado.contexto,
    closing: Boolean(closing),
    recentMessages,
  });
  return {
    ok: true as const,
    source: resolvedPrompt.source,
    promptSha256,
    agent: agentVersion ? { id: agentVersion.agentId, version: agentVersion.version } : null,
    timing: resposta.timing,
    object: resposta.object,
  };
}

async function reserveConfirmedMeeting(input: {
  admin: AdminClient;
  activity: NonNullable<ReturnType<typeof buildConversationMeetingActivity>>;
  connectionId: string;
  timezone: string;
  /**
   * Remarcacao da MESMA reuniao (a conversa ja tinha uma confirmada): atualiza a activity
   * existente em vez de criar outra, para o evento do Google nao ficar orfao.
   */
  allowUpdate?: boolean;
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
    p_allow_update: input.allowUpdate === true,
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

  // Reuniao ja confirmada nesta conversa. Quando o lead volta para remarcar, a IA abre um handoff
  // NOVO (eventId novo) e a referencia a reuniao antiga se perdia: a activity ficava ocupando o
  // horario para sempre e o evento do Google seguia vivo, com o lembrete saindo na hora errada
  // (achado bloqueante da critica de operacao, 22/09). Reusando a MESMA activity, remarcar
  // atualiza o CRM e o Google em vez de duplicar.
  const previousMeetingActivityId = await resolveReusableMeetingActivityId({
    admin,
    organizationId: activeConnection.organization_id,
    activityId: readConversationThreadMetadata(thread.metadata).confirmedMeetingActivityId ?? null,
    now,
  });
  const isMeetingHandoff = effectiveHandoffType === 'meeting_requested' || effectiveHandoffType === 'meeting_confirmed';
  const handoffEventId = shouldHandoff
    ? (isMeetingHandoff && previousMeetingActivityId
        ? previousMeetingActivityId
        : buildConversationScopedEventId({
            organizationId: activeConnection.organization_id,
            threadId: payload.threadId,
            eventId: payload.notificationEventId || randomUUID(),
          }))
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
  // Preenchido so quando a reserva do CRM deu certo; e o que amarra a conversa a reuniao e o que
  // o passo do tick usa para criar/atualizar o evento no Google.
  let confirmedMeeting: {
    activityId: string;
    ownerId: string | null;
    timezone: string;
    scheduledAt: string;
  } | null = null;

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
        // So quando e a MESMA reuniao de antes (remarcacao): reserva nova continua sem update.
        allowUpdate: Boolean(previousMeetingActivityId) && confirmedActivity?.id === previousMeetingActivityId,
      }),
    );

    if (meetingWasReserved && confirmedActivity) {
      confirmedMeeting = {
        activityId: confirmedActivity.id,
        ownerId: latestAvailability.calendar!.ownerId,
        timezone: latestAvailability.calendar!.timezone,
        scheduledAt: confirmedActivity.date,
      };
    }

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
  // Hora em que a ÚLTIMA parte foi aceita pela Evolution. O sent_at das mensagens é fixado antes do envio
  // (`now`), e envios simultâneos podem terminar em ordem inversa: a prova da migração ordena por isto.
  let deliveredAt: string | null = null;
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
    deliveredAt = new Date().toISOString();

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

  // Evento de prova da Central de Agentes: só com a entrega feita e só quando quem chama é o caminho nativo.
  // Falha aqui só avisa (dentro da função), nunca derruba nem marca a resposta.
  if (payload.replyEvent && deliveredAt) {
    await registrarEventoDeResposta(admin, {
      organizationId: activeConnection.organization_id,
      channelConnectionId: activeConnection.id,
      threadId: payload.threadId,
      deliveredAt,
      ...payload.replyEvent,
    });
  }

  // E-mail e segmento que o lead informou vao para o contato. Nunca sobrescreve e-mail existente;
  // falha aqui nao derruba a resposta (ja enviada), so avisa.
  if (thread.contact_id && (payload.leadEmail || payload.leadSegment || payload.leadName || payload.leadCompany)) {
    const contactResult = await admin
      .from('contacts')
      .select('email, notes, name, company_name, client_company_id')
      .eq('id', thread.contact_id)
      .eq('organization_id', activeConnection.organization_id)
      .maybeSingle();
    const profileUpdate = contactResult.error
      ? null
      : buildContactProfileUpdate({
          contact: contactResult.data,
          // O que o CRM gravou a partir do perfil do WhatsApp. Serve para saber se o nome do
          // contato ainda e o do perfil (pode trocar) ou se alguem ja corrigiu a mao (nao toca).
          profileName: thread.contact_name,
          leadEmail: payload.leadEmail,
          leadSegment: payload.leadSegment,
          leadName: payload.leadName,
          leadCompany: payload.leadCompany,
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
      } else if (profileUpdate.name && thread.deal_id) {
        // O card do funil mostra o TITULO DO NEGOCIO, nao o nome do contato — e o titulo e
        // carimbado na criacao da conversa ("... - WhatsApp") e nunca mais reescrito. Sem isto o
        // nome certo entraria no contato e o funil continuaria mostrando o antigo, que e
        // exatamente onde o Junior viu o problema (24/09).
        // O `.eq('title', ...)` e a trava: so o titulo PADRAO e trocado. Titulo que alguem
        // reescreveu na tela nao casa com o padrao, entao fica como esta.
        const nomeAnterior = (contactResult.data?.name || '').trim();
        const tituloPadraoAntigo = `${nomeAnterior || thread.contact_phone || ''} - WhatsApp`;
        const dealUpdate = await admin
          .from('deals')
          .update({ title: `${profileUpdate.name} - WhatsApp`, updated_at: now })
          .eq('id', thread.deal_id)
          .eq('organization_id', activeConnection.organization_id)
          .eq('title', tituloPadraoAntigo);
        if (dealUpdate.error) {
          console.warn('[Conversation AI] Failed to rename deal after lead said their name', {
            organizationId: activeConnection.organization_id,
            dealId: thread.deal_id,
            error: dealUpdate.error.message,
          });
        }
      }

      // EMPRESA: a Aurora guarda o que o lead falou em `contacts.company_name` (texto), e
      // vincula sozinha SO quando ja existe uma empresa cadastrada com esse nome. Criar
      // empresa automatica encheria o CRM de duplicata por grafia; sem par exato, o nome fica
      // de sugestao no card do negocio, a um clique de virar empresa de verdade.
      if (profileUpdate.company_name && !contactResult.data?.client_company_id) {
        const empresas = await admin
          .from('crm_companies')
          .select('id, name')
          .eq('organization_id', activeConnection.organization_id)
          .is('deleted_at', null)
          .limit(200);
        const par = (empresas.data || []).find((empresa: { id: string; name: string | null }) =>
          mesmaEmpresa(empresa.name || '', profileUpdate.company_name as string));
        if (par?.id) {
          await admin.from('contacts')
            .update({ client_company_id: par.id, updated_at: now })
            .eq('id', thread.contact_id)
            .eq('organization_id', activeConnection.organization_id);
          if (thread.deal_id) {
            // So preenche negocio que ainda esta SEM empresa — nunca troca a que alguem escolheu.
            await admin.from('deals')
              .update({ client_company_id: par.id, updated_at: now })
              .eq('id', thread.deal_id)
              .eq('organization_id', activeConnection.organization_id)
              .is('client_company_id', null);
          }
        }
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
          // Sobrevive ao proximo handoff (que sobrescreve `lastHandoff`): e por ele que uma
          // remarcacao futura acha a reuniao antiga em vez de deixa-la orfa.
          confirmedMeetingActivityId: confirmedMeeting?.activityId,
          queueAssignedUserId: shouldHandoff ? thread.assigned_user_id ?? null : null,
          provider: 'evolution',
        }),
      });

  // Gate de capacidade (27/09): grava o resultado do turno na conversa — e a campanha le por
  // anuncio de origem. Turno sem gate (capacityGate null) passa direto, inclusive encerramento.
  const nextMetadataComGate = aplicarGateCapacidade(
    nextMetadata,
    thread.metadata,
    payload.capacityGate,
    now,
  );

  // Etiquetas apontadas pela IA (27/09): validadas de novo contra o catalogo e aplicadas no negocio
  // da conversa (provenance 'ai'); o gatilho do banco inscreve nas automacoes publicadas. Vale
  // tambem quando a entrega falha (a classificacao veio da mensagem do LEAD). Erro aqui nunca
  // derruba a resposta.
  if (payload.suggestedTags?.length && thread.deal_id) {
    try {
      const catalogo = await loadTagCatalog(admin, activeConnection.organization_id);
      const tagIds = resolverEtiquetasSugeridas(catalogo, payload.suggestedTags);
      if (tagIds.length) {
        await aplicarEtiquetasSugeridas({
          admin,
          organizationId: activeConnection.organization_id,
          dealId: thread.deal_id,
          tagIds,
        });
      }
    } catch (error) {
      console.warn('[Conversation AI] Failed to apply suggested tags', {
        organizationId: activeConnection.organization_id,
        threadId: payload.threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const threadUpdateBase = admin
    .from('conversation_threads')
    .update({
      status: nextStatus,
      last_message_at: now,
      updated_at: now,
      metadata: nextMetadataComGate,
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

  // O vinculo com a reuniao e FATO CONSUMADO (a activity ja esta reservada) — nao pode depender
  // de quem estava atendendo durante os segundos do envio. Quando o update condicional acima
  // casa zero linhas, a metadata inteira e descartada junto com o vinculo, e a remarcacao
  // seguinte criaria uma reuniao nova deixando a antiga ocupando o horario e o evento vivo no
  // Google (achado alto da revisao de correcao). Aqui ele e gravado sozinho, sem condicao.
  if (threadStateChanged && confirmedMeeting) {
    await persistConfirmedMeetingLink({
      admin,
      organizationId: activeConnection.organization_id,
      threadId: payload.threadId,
      activityId: confirmedMeeting.activityId,
      now,
    });
  }
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
      // O gate vem da mensagem do LEAD, entao vale mesmo com a entrega da resposta falhando.
      metadata: nextMetadataComGate,
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

  // Google Agenda (Fatia 3): so enfileira a linha `pending`, e so se o responsavel da agenda
  // tiver conexao `connected`. ZERO rede aqui — `events.insert` acontece no relogio de 5 min,
  // depois de a resposta ja ter saido para o lead.
  if (confirmedMeeting) {
    await enqueueGoogleCalendarMeetingEvent({
      admin,
      organizationId: activeConnection.organization_id,
      threadId: payload.threadId,
      activityId: confirmedMeeting.activityId,
      channelConnectionId: activeConnection.id,
      ownerId: confirmedMeeting.ownerId,
      contactId: thread.contact_id,
      contactName: thread.contact_name,
      scheduledAt: confirmedMeeting.scheduledAt,
      timezone: confirmedMeeting.timezone,
      now,
    });
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

/**
 * Vinculo com a reuniao confirmada, gravado sozinho e SEM condicao de estado.
 *
 * Le a metadata fresca e reescreve so este campo (o merge de
 * `buildConversationThreadMetadataUpdate` preserva o resto). Melhor esforco: perder o vinculo e
 * pior do que qualquer corrida aqui — sem ele a remarcacao duplica a reuniao e deixa o evento
 * antigo vivo no Google.
 */
export async function persistConfirmedMeetingLink(input: {
  admin: ReturnType<typeof createStaticAdminClient>;
  organizationId: string;
  threadId: string;
  activityId: string;
  now: string;
}): Promise<void> {
  try {
    const fresh = await input.admin
      .from('conversation_threads')
      .select('metadata')
      .eq('id', input.threadId)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (fresh.error) throw new Error(fresh.error.message);
    if (!fresh.data) return;

    const updated = await input.admin
      .from('conversation_threads')
      .update({
        updated_at: input.now,
        metadata: buildConversationThreadMetadataUpdate(
          (fresh.data as { metadata?: Record<string, unknown> | null }).metadata,
          { confirmedMeetingActivityId: input.activityId },
        ),
      })
      .eq('id', input.threadId)
      .eq('organization_id', input.organizationId);
    if (updated.error) throw new Error(updated.error.message);
  } catch (error) {
    console.warn('[Conversation AI] Failed to persist the confirmed meeting link', {
      organizationId: input.organizationId,
      threadId: input.threadId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * So reusa a activity da reuniao anterior se ela AINDA VALE: existe, nao foi concluida nem
 * apagada e esta no futuro.
 *
 * O vinculo nunca expirava (achado medio da revisao de correcao): o lead que voltasse semanas
 * depois para marcar OUTRA reuniao reescrevia a activity historica — titulo, descricao, data e
 * `completed` — e o `events.patch` mexia no evento da reuniao que ja tinha acontecido. O
 * historico da primeira sumia do CRM e da agenda. Reuniao passada e historia: a nova nasce
 * separada.
 */
export async function resolveReusableMeetingActivityId(input: {
  admin: ReturnType<typeof createStaticAdminClient>;
  organizationId: string;
  activityId: string | null;
  now: string;
}): Promise<string | null> {
  if (!input.activityId) return null;
  try {
    const result = await input.admin
      .from('activities')
      .select('id, date, completed, deleted_at')
      .eq('id', input.activityId)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    const activity = result.data as {
      id: string; date: string | null; completed: boolean | null; deleted_at: string | null;
    } | null;
    if (!activity || activity.completed || activity.deleted_at || !activity.date) return null;
    return new Date(activity.date).getTime() > new Date(input.now).getTime() ? activity.id : null;
  } catch (error) {
    // Na duvida, NAO reusa: criar uma reuniao nova e recuperavel; reescrever a errada, nao.
    console.warn('[Conversation AI] Could not check the previous meeting activity', {
      organizationId: input.organizationId,
      activityId: input.activityId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
