import 'server-only';

import { generateText, NoObjectGeneratedError, Output } from 'ai';
import type { LanguageModelUsage } from 'ai';
import { z } from 'zod';
import type { getModel } from '@/lib/ai/config';
import type { AIReplyTiming, criarFetchContador } from '@/lib/ai/medicaoResposta';
import { renderPromptTemplate } from '@/lib/ai/prompts/render';
import {
  buildAvailableTagsContext,
  loadTagCatalog,
  resolverEtiquetasSugeridas,
} from '@/lib/conversations/etiquetasSugeridas';
import {
  DEFAULT_MEETING_HOST_NAME,
  formatLocalDateTimeForPrompt,
  pickMeetingHostName,
  readConfiguredMeetingHostName,
} from '@/lib/conversations/aiPromptContext';
import {
  buildClosingStageContext,
  buildConfirmedMeetingStageContext,
  readMeetingChannelText,
} from '@/lib/conversations/closingReply';
import { repairStructuredOutputText } from '@/lib/conversations/aiOutputRepair';
import { normalizeLeadCompany, normalizeLeadEmail, normalizeLeadName, normalizeLeadSegment } from '@/lib/conversations/leadProfile';
import { ConversationHandoffTypeSchema, type ConversationHandoff } from '@/lib/conversations/handoff';
import { applyMeetingReplyPolicy } from '@/lib/conversations/meetingReplyPolicy';
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
import type { createStaticAdminClient } from '@/lib/supabase/server';

/**
 * Miolo do gerador de respostas do WhatsApp (Central de Agentes, fatia 3). O atendimento real
 * (`generateConversationAutoReply`, em aiReply.ts) e o teste sem enviar (`lib/agents/testeDoAgente.ts`) usam as
 * mesmas funções daqui: `carregarContextoDaResposta` só lê e renderiza o prompt; `responderComModelo` chama o modelo e
 * aplica o reparo e a política da agenda. Nada aqui envia, agenda nem grava. Os auxiliares do topo vieram de
 * aiReply.ts sem mudar uma linha (só ganharam `export`).
 */

type AdminClient = ReturnType<typeof createStaticAdminClient>;

export type RecentMessage = {
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
  // O nome do WhatsApp nao e o nome da pessoa: pode ser "...", o nome da loja, ou nada. Quando o
  // lead se apresenta, esse nome vale mais (Junior, 24/09: "nao teria que preencher o nome do lead
  // depois que ele fala?"). Quem decide se entra e `resolveLeadNameUpdate` — nome editado a mao
  // no CRM nunca e sobrescrito.
  leadName: z.string().max(80).nullable().optional()
    .describe('Nome que o lead disse ter nesta conversa (so o nome da pessoa), ou null'),
  // Empresa ONDE ele trabalha, separada do RAMO (que continua em leadSegment). O card do funil
  // mostrava "Sem empresa" sem nenhum jeito de mudar (Junior, 24/09).
  leadCompany: z.string().max(120).nullable().optional()
    .describe('Nome da empresa onde o lead trabalha, como ele falou, ou null'),
  // Gate de capacidade (27/09): a campanha le o resultado por anuncio de origem. So o prompt da
  // Cenoura Hub instrui este campo; nos outros ele simplesmente nunca vem.
  capacityGate: z.enum(['passed', 'failed', 'unanswered']).nullable().optional()
    .describe('Resultado da pergunta de capacidade decidido NESTA mensagem, ou null'),
  // Etiquetas do funil (27/09): a IA APONTA nomes do catalogo ({{availableTagsContext}} no prompt);
  // quem aplica e o servidor (assign_deal_tag_system, provenance 'ai'), e o gatilho do banco inscreve
  // o negocio nas automacoes publicadas. Nome fora do catalogo e descartado. So o prompt que carrega
  // o placeholder instrui este campo; nos outros ele simplesmente nunca vem.
  suggestedTags: z.array(z.string().max(80)).max(5).nullable().optional()
    .describe('Etiquetas da lista ETIQUETAS DISPONIVEIS que passaram a valer NESTA mensagem (nome exato), ou null'),
  // Conversa encerrada (28/09): a cutucada de 15 min saia depois do "Boa noite!" de despedida e o
  // lead respondeu "Ja terminamos a conversa!". Vale para todos os prompts; sem o campo, nada muda.
  conversationEnded: z.boolean().nullable().optional()
    .describe('true se a conversa TERMINOU nesta mensagem (o lead se despediu, recusou de vez ou disse que entrou em contato por engano) e nao ha nada a esperar dele; senao null'),
});

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

export function splitReplyIntoParts(replyText: string) {
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
  /** true só no teste sem enviar: a falha do Google não é registrada e o cache da agenda não é preenchido (freeBusy.ts). */
  somenteLeitura?: boolean;
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
    recordFailures: !input.somenteLeitura,
    fillCache: !input.somenteLeitura,
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
export async function resolveMeetingHostName(input: {
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

export type ContextoDaResposta = {
  prompt: string;
  calendarAvailability: Awaited<ReturnType<typeof loadAvailableMeetingSlots>>;
  calendarMs: number;
  tagCatalog: Awaited<ReturnType<typeof loadTagCatalog>>;
  wantsTagContext: boolean;
};

/** Consumo do modelo somado nas gerações (reparo = 2). Nulo quando o provedor não informa. */
export type UsoDoModelo = { entrada: number | null; saida: number | null; raciocinio: number | null; entradaEmCache: number | null };

/**
 * Tudo o que a resposta precisa além do modelo, só com leituras: agenda, anfitrião, etiquetas e o prompt renderizado.
 * Mesma ordem de leituras do gerador de antes da fatia 3. Sem número (`connection` nulo), a agenda sai "não configurada"
 * e o id não é lido. `somenteLeitura: true` só no teste sem enviar: a falha do Google não é registrada e o cache
 * da agenda não é preenchido.
 */
export async function carregarContextoDaResposta(input: {
  admin: AdminClient;
  organizationId: string;
  connection: { id: string; config: Record<string, unknown> | null } | null;
  promptContent: string;
  organizationName: string | null;
  automationTimezone: unknown;
  contactName: string | null;
  contactPhone: string;
  recentMessages: RecentMessage[];
  closing: { handoff: ConversationHandoff; repliesUsed: number } | null;
  threadMetadata: Record<string, unknown> | null;
  somenteLeitura?: boolean;
}): Promise<{ ok: true; contexto: ContextoDaResposta } | { ok: false; reason: 'closing_unsupported' }> {
  const { admin, organizationId, promptContent, closing } = input;
  const connectionConfig = input.connection?.config ?? null;
  const currentDateTime = new Date().toISOString();
  const inicioAgenda = Date.now();
  const calendarAvailability = await loadAvailableMeetingSlots({
    admin,
    organizationId,
    // Sem número a config é nula, a agenda sai "não configurada" antes de qualquer leitura e o id não é usado.
    connectionId: input.connection?.id ?? '',
    connectionConfig,
    now: currentDateTime,
    somenteLeitura: input.somenteLeitura,
  });
  const calendarMs = Date.now() - inicioAgenda;
  const timezone = calendarAvailability.calendar?.timezone
    || (typeof input.automationTimezone === 'string' && input.automationTimezone.trim()
      ? input.automationTimezone.trim().slice(0, 64)
      : 'America/Sao_Paulo');
  const meetingHostName = await resolveMeetingHostName({
    admin,
    organizationId,
    connectionConfig,
    ownerId: calendarAvailability.calendar?.ownerId ?? null,
  });
  // Encerramento so vale para prompt desenhado para ele (tem {{conversationStageContext}}). O prompt
  // padrao e overrides antigos continuam mudos depois do handoff, como antes; nada de instrucao colada no topo.
  if (closing && !/\{\{\s*conversationStageContext\s*\}\}/.test(promptContent)) {
    return { ok: false, reason: 'closing_unsupported' as const };
  }
  const meetingChannelText = readMeetingChannelText(connectionConfig);
  // Catalogo de etiquetas so para template que pede ({{availableTagsContext}}): nos demais,
  // nem consulta sai — comportamento de hoje intocado.
  const wantsTagContext = /\{\{\s*availableTagsContext\s*\}\}/.test(promptContent);
  const tagCatalog = wantsTagContext ? await loadTagCatalog(admin, organizationId) : [];
  const conversationStageContext = closing
    ? buildClosingStageContext({
        handoff: closing.handoff,
        repliesUsed: closing.repliesUsed,
        meetingHostName,
        timezone,
        meetingChannelText,
      })
    : buildConfirmedMeetingStageContext({
        metadata: input.threadMetadata,
        meetingHostName,
        timezone,
        meetingChannelText,
        now: currentDateTime,
      }) ?? 'ATENDIMENTO EM ANDAMENTO.';
  const prompt = renderPromptTemplate(promptContent, {
    organizationName: input.organizationName || 'Organizacao',
    contactName: input.contactName || 'Lead',
    contactPhone: input.contactPhone,
    currentDateTime,
    // Data local com dia da semana: "amanha" e "terca" so fazem sentido no fuso da agenda.
    currentDateTimeLocal: formatLocalDateTimeForPrompt(currentDateTime, timezone),
    timezone,
    meetingHostName,
    meetingChannelText,
    conversationStageContext,
    recentMessagesText: formatRecentMessages(input.recentMessages),
    calendarContext: calendarAvailability.calendarContext,
    availableTagsContext: buildAvailableTagsContext(tagCatalog),
  });
  return { ok: true, contexto: { prompt, calendarAvailability, calendarMs, tagCatalog, wantsTagContext } };
}

/**
 * Chama o modelo com o prompt já renderizado e aplica o que vem depois dele: reparo da saída, política da agenda e
 * normalização dos dados do lead. Não lê nem grava nada no banco: é o mesmo no atendimento real e no teste sem enviar.
 */
export async function responderComModelo(input: {
  model: ReturnType<typeof getModel>;
  fetchContador: ReturnType<typeof criarFetchContador>;
  organizationId: string;
  /** `Date.now()` na entrada do gerador: o `total_ms` conta dali. */
  inicio: number;
  contexto: ContextoDaResposta;
  /** Encerramento depois do handoff: nunca abre handoff novo nem mexe na agenda. */
  closing: boolean;
  recentMessages: RecentMessage[];
  /** Só no teste sem enviar: prazo para as gerações. No atendimento real a chamada sai sem ele, como sempre. */
  abortSignal?: AbortSignal;
}) {
  const { model, fetchContador, organizationId, inicio, contexto, closing, recentMessages, abortSignal } = input;
  const { prompt, calendarAvailability, calendarMs, tagCatalog, wantsTagContext } = contexto;
  const uso: UsoDoModelo = { entrada: null, saida: null, raciocinio: null, entradaEmCache: null };
  const mais = (a: number | null, b: number | undefined) => (typeof b === 'number' ? (a ?? 0) + b : a);
  const somarUso = (u: LanguageModelUsage | undefined) => {
    if (!u) return;
    uso.entrada = mais(uso.entrada, u.inputTokens);
    uso.saida = mais(uso.saida, u.outputTokens);
    uso.raciocinio = mais(uso.raciocinio, u.outputTokenDetails?.reasoningTokens ?? u.reasoningTokens);
    uso.entradaEmCache = mais(uso.entradaEmCache, u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens);
  };

  let generations = 0;
  let repairedOutput = false;
  // O consumo de cada geracao entra na soma aqui dentro, para as linhas que chamam ficarem como sempre foram.
  const generateOnce = async () => {
    generations += 1;
    const resultado = await generateText({
      model,
      maxRetries: 2,
      // No Gemini 3 os tokens de raciocinio contam neste teto; 1.200 truncava o JSON e derrubava a
      // resposta (falha "provider" no ensaio de 20/09). A resposta util continua limitada pelo prompt.
      maxOutputTokens: 4096,
      output: Output.object({ schema: ConversationAutoReplySchema }),
      prompt,
      ...(abortSignal ? { abortSignal } : {}),
    });
    somarUso(resultado.usage);
    return resultado;
  };
  const inicioModelo = Date.now();
  const medir = (): AIReplyTiming => {
    const agora = Date.now();
    return {
      total_ms: agora - inicio,
      setup_ms: inicioModelo - inicio - calendarMs,
      calendar_ms: calendarMs,
      model_ms: agora - inicioModelo,
      model_http_calls: fetchContador.contagem.chamadas,
      model_http_errors: [...fetchContador.contagem.falhas],
      generations,
      repaired: repairedOutput,
    };
  };

  // 2a janela de 20/09: o Gemini devolveu, de vez em quando, algo que nao era o objeto esperado
  // (`AI_NoObjectGeneratedError: could not parse the response`) e a conversa caia na fila humana.
  // Primeiro tenta-se recortar o objeto do texto cru (cerca de markdown, raciocinio em volta); se nao
  // der, uma segunda geracao. So a segunda falha vira falha de provedor.
  let generated: z.infer<typeof ConversationAutoReplySchema>;
  try {
    try {
      generated = (await generateOnce()).output;
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      somarUso(error.usage);
      const rawText = typeof error.text === 'string' ? error.text : null;
      const repairedText = repairStructuredOutputText(rawText);
      const repaired = repairedText ? ConversationAutoReplySchema.safeParse(JSON.parse(repairedText)) : null;
      if (repaired?.success) {
        console.warn('[Conversation AI] Structured output repaired from raw text', { organizationId });
        generated = repaired.data;
        repairedOutput = true;
      } else {
        // G22 (OK do Junior, 08/10): o texto do modelo pode repetir o que o lead escreveu, entao nunca vai para o log.
        // Fica a forma, que basta para o diagnostico de 20/09 (JSON cortado pelo teto de tokens: abre e nao fecha).
        const aparado = rawText ? rawText.trim() : '';
        console.warn('[Conversation AI] Structured output could not be parsed; retrying once', {
          organizationId,
          finishReason: error.finishReason ?? null,
          textLength: rawText ? rawText.length : null,
          startsWithBrace: aparado.startsWith('{'),
          endsWithBrace: aparado.endsWith('}'),
        });
        generated = (await generateOnce()).output;
      }
    }
  } catch (error) {
    // A medicao vai junto do erro: a falha de provedor e justamente o caso em que mais importa saber
    // quanto tempo passou e quantas vezes o provedor recusou (ver lib/ai/medicaoResposta.ts).
    if (error && typeof error === 'object') {
      (error as { aiTiming?: AIReplyTiming }).aiTiming = medir();
    }
    throw error;
  }
  const modelTiming = medir();
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
    // Pos-processamento (politica de agenda, etiquetas) entra no total: e rapido, mas e tempo do lead.
    timing: { ...modelTiming, total_ms: Date.now() - inicio } satisfies AIReplyTiming,
    uso,
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
      leadName: normalizeLeadName(generated.leadName),
      leadCompany: normalizeLeadCompany(generated.leadCompany),
      capacityGate: generated.capacityGate ?? null,
      // Validado contra o catalogo aqui mesmo: adiante so viajam nomes que existem.
      suggestedTags: wantsTagContext
        ? resolverEtiquetasSugeridas(tagCatalog, generated.suggestedTags)
            .map((id) => tagCatalog.find((t) => t.id === id)?.name)
            .filter((nome): nome is string => Boolean(nome))
        : null,
      conversationEnded: generated.conversationEnded === true,
    },
  };
}
