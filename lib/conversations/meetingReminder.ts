import 'server-only';

import type { createStaticAdminClient } from '@/lib/supabase/server';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { redactChannelSecrets } from '@/lib/channels/redactChannelSecrets';
import { buildConversationScopedEventId } from '@/lib/conversations/handoffEventId';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';
import { resolveConversationAIAgentConfig } from '@/lib/conversations/aiAgentConfig';
import { toWhatsAppPhone } from '@/lib/phone';
import { getGoogleCalendarAccessToken } from '@/lib/googleCalendar/oauth';
import { getGoogleCalendarEvent, GoogleApiError } from '@/lib/googleCalendar/googleApiClient';
import { loadFreshConversationAIGate } from '@/lib/conversations/conversationAIGate';
import {
  firstNameForGoogleMeetingEvent,
  GOOGLE_MEETING_EVENT_TABLE,
  type GoogleMeetingEventStatus,
} from '@/lib/googleCalendar/meetingEventQueue';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

/** Decisao do Junior, 22/09: o link do Meet sai 15 minutos antes da reuniao. */
export const MEETING_REMINDER_LEAD_MINUTES = 15;

/**
 * Quando falta MENOS que isto, um problema que nao se resolveu sozinho vira aviso no sino.
 *
 * Antes, o PRIMEIRO tick dentro da janela ja escalava e carimbava `reminder_escalated_at` — e
 * como a consulta exige os dois carimbos nulos, a linha saia da janela PARA SEMPRE. Um Meet que
 * ficou `pending` no Google e recebeu o link no ciclo seguinte nunca mais era enviado (achado
 * medio da revisao de correcao). Agora o tick espera: so escala perto da hora, ou na hora em que
 * o problema e definitivo (evento apagado no Google).
 */
export const MEETING_REMINDER_ESCALATION_MINUTES = 5;

/** Texto aprovado (SPEC-google-agenda). Conteudo operacional, nunca gerado pelo LLM. */
export function buildMeetingLinkReminderText(input: { contactName: string | null; meetLink: string }): string {
  const firstName = firstNameForGoogleMeetingEvent(input.contactName);
  return `${firstName}, nossa reunião começa daqui a pouco. Aqui está o link do Google Meet: ${input.meetLink}`;
}

export type MeetingReminderRunSummary = {
  due: number;
  sent: number;
  escalated: number;
  /** problema que ainda pode se resolver sozinho; sera reavaliado no proximo ciclo */
  waiting: number;
  /** outro tick reivindicou primeiro, ou o estado mudou entre a leitura e a reivindicacao */
  claimed: number;
  failed: number;
  errors: string[];
  truncated: boolean;
};

type ReminderRow = {
  activity_id: string;
  organization_id: string;
  thread_id: string;
  channel_connection_id: string | null;
  owner_id: string;
  contact_name: string | null;
  scheduled_at: string;
  google_calendar_id: string;
  google_event_id: string | null;
  meet_link: string | null;
  status: GoogleMeetingEventStatus;
};

type ThreadRow = {
  id: string;
  organization_id: string;
  channel_connection_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  metadata: Record<string, unknown> | null;
};

type ConnectionRow = {
  id: string;
  organization_id: string;
  name: string;
  config: Record<string, unknown> | null;
};

const ROW_COLUMNS =
  'activity_id, organization_id, thread_id, channel_connection_id, owner_id, contact_name, '
  + 'scheduled_at, google_calendar_id, google_event_id, meet_link, status';

/**
 * Manda o link do Meet pelo WhatsApp 15 minutos antes da reuniao.
 *
 * Roda no relogio de 5 min, com lote e prazo proprios. Antes de enviar, confere no Google
 * (`events.get`) que o evento continua existindo e nao foi cancelado — evento apagado a mao
 * nao vira link morto na mao do lead.
 *
 * Reivindicacao atomica: o carimbo `reminder_sent_at` e gravado ANTES do envio, com a condicao
 * de ele ainda estar nulo. Dois ticks concorrentes nunca mandam duas vezes.
 *
 * Quando a janela chega e nao ha link pronto (evento falhou, token morto, evento apagado no
 * Google), nada e enviado e sobe um aviso de ALTA severidade daquela reuniao, uma vez so
 * (`reminder_escalated_at`) — o humano manda na mao.
 */
export async function sendDueMeetingLinkReminders(input: {
  admin: AdminClient;
  now?: string;
  batchLimit?: number;
  deadlineMs?: number;
}): Promise<MeetingReminderRunSummary> {
  const { admin } = input;
  const now = input.now ?? new Date().toISOString();
  const batchLimit = input.batchLimit ?? 10;
  const deadlineMs = input.deadlineMs ?? 8_000;
  const startedAt = Date.now();
  const summary: MeetingReminderRunSummary = {
    due: 0, sent: 0, escalated: 0, waiting: 0, claimed: 0, failed: 0, errors: [], truncated: false,
  };

  const windowEnd = new Date(new Date(now).getTime() + MEETING_REMINDER_LEAD_MINUTES * 60_000).toISOString();
  const dueResult = await admin
    .from(GOOGLE_MEETING_EVENT_TABLE)
    .select(ROW_COLUMNS)
    .is('reminder_sent_at', null)
    .is('reminder_escalated_at', null)
    .gte('scheduled_at', now)
    .lte('scheduled_at', windowEnd)
    .order('scheduled_at', { ascending: true })
    .limit(batchLimit);
  if (dueResult.error) throw new Error(dueResult.error.message);

  const rows = (dueResult.data || []) as unknown as ReminderRow[];
  summary.due = rows.length;
  if (rows.length === 0) return summary;

  for (const row of rows) {
    if (Date.now() - startedAt > deadlineMs) {
      summary.truncated = true;
      break;
    }

    // Ainda da tempo de o problema se resolver sozinho (Meet que fica `pending`, token sendo
    // renovado, conexao voltando)? Entao nao carimba nada: a linha continua elegivel no
    // proximo ciclo. So perto da hora um problema pendente vira aviso.
    const waitBeforeEscalating =
      new Date(row.scheduled_at).getTime() - new Date(now).getTime()
      > MEETING_REMINDER_ESCALATION_MINUTES * 60_000;

    try {
      // Sem evento criado com link: nada a enviar — escala em vez de ficar em silencio.
      if (row.status !== 'created' || !row.meet_link || !row.google_event_id) {
        if (waitBeforeEscalating) { summary.waiting += 1; continue; }
        if (await escalate({ admin, row, reason: 'sem link do Google', now })) summary.escalated += 1;
        else summary.claimed += 1;
        continue;
      }

      // O evento pode ter sido apagado/cancelado a mao no Google depois de criado.
      const verdict = await confirmGoogleEvent({ admin, row });
      if (verdict === 'gone') {
        // Definitivo: nao adianta esperar, o evento nao existe mais.
        if (await escalate({ admin, row, reason: 'o evento não está mais no Google', now })) summary.escalated += 1;
        else summary.claimed += 1;
        continue;
      }
      if (verdict === 'unknown') {
        // Falha passageira (rede, token, 5xx): tenta de novo no proximo ciclo.
        if (waitBeforeEscalating) { summary.waiting += 1; continue; }
        if (await escalate({ admin, row, reason: 'não deu para confirmar o evento no Google', now })) summary.escalated += 1;
        else summary.claimed += 1;
        continue;
      }

      const context = await loadReminderContext({ admin, row });
      if (!context) {
        if (waitBeforeEscalating) { summary.waiting += 1; continue; }
        if (await escalate({ admin, row, reason: 'a conversa não está pronta para enviar', now })) summary.escalated += 1;
        else summary.claimed += 1;
        continue;
      }

      // Reivindica ANTES de enviar: dois ticks nunca mandam duas vezes.
      const sentAt = new Date().toISOString();
      const claim = await admin
        .from(GOOGLE_MEETING_EVENT_TABLE)
        .update({ reminder_sent_at: sentAt, updated_at: sentAt })
        .eq('activity_id', row.activity_id)
        .eq('organization_id', row.organization_id)
        .is('reminder_sent_at', null)
        .select('activity_id');
      if (claim.error) throw new Error(claim.error.message);
      if (!claim.data || claim.data.length === 0) {
        summary.claimed += 1;
        continue;
      }

      await deliverReminder({ admin, row, context, sentAt });
      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      // A credencial da Evolution pode vir dentro do erro do provedor: nada de segredo no
      // resumo do tick nem no log (achado baixo da revisao de seguranca).
      const message = redactChannelSecrets(error, [], 'Falha ao enviar o lembrete da reunião.');
      summary.errors.push(`${row.activity_id}: ${message}`);
      console.warn('[meeting reminder] Failed to send meeting link reminder', {
        organizationId: row.organization_id,
        activityId: row.activity_id,
        error: message,
      });
      // O carimbo de envio ja foi gravado (reivindicacao antes do envio): sem um aviso aqui o
      // lead ficaria esperando um link que nunca chega, e ninguem saberia.
      await escalate({ admin, row, reason: 'a mensagem não saiu pelo WhatsApp', now, force: true });
    }
  }

  return summary;
}

/**
 * Tres respostas, nao duas — a diferenca entre elas decide se o lead recebe o link:
 *
 * - `ok`      o evento existe e nao foi cancelado: pode mandar;
 * - `gone`    o evento sumiu/foi cancelado no Google (404, 410 ou `status: cancelled`): nao
 *             adianta esperar, escala agora;
 * - `unknown` falha passageira (rede, 5xx, token sendo renovado): tentar de novo no proximo
 *             ciclo. Tratar isto como `gone` queimava a janela do lembrete para sempre por
 *             causa de um soluco de rede, e o lead ficava sem link.
 */
async function confirmGoogleEvent(input: {
  admin: AdminClient;
  row: ReminderRow;
}): Promise<'ok' | 'gone' | 'unknown'> {
  const { row } = input;
  let accessToken: string | null = null;
  try {
    accessToken = await getGoogleCalendarAccessToken({
      admin: input.admin,
      organizationId: row.organization_id,
      ownerId: row.owner_id,
    });
    if (!accessToken) return 'unknown';

    const event = await getGoogleCalendarEvent({
      accessToken,
      calendarId: row.google_calendar_id,
      eventId: row.google_event_id!,
    });
    return event.status === 'cancelled' ? 'gone' : 'ok';
  } catch (error) {
    const gone = error instanceof GoogleApiError && (error.status === 404 || error.status === 410);
    console.warn('[meeting reminder] Could not confirm the Google event before sending', {
      organizationId: row.organization_id,
      activityId: row.activity_id,
      gone,
      error: redactChannelSecrets(error, [accessToken], 'Falha ao conferir o evento no Google.'),
    });
    return gone ? 'gone' : 'unknown';
  }
}

type ReminderContext = {
  thread: ThreadRow;
  connection: ConnectionRow;
  phone: string;
  agentName: string;
};

async function loadReminderContext(input: { admin: AdminClient; row: ReminderRow }): Promise<ReminderContext | null> {
  const { admin, row } = input;

  const threadResult = await admin
    .from('conversation_threads')
    .select('id, organization_id, channel_connection_id, contact_name, contact_phone, metadata')
    .eq('id', row.thread_id)
    .eq('organization_id', row.organization_id)
    .maybeSingle();
  if (threadResult.error) throw new Error(threadResult.error.message);
  const thread = threadResult.data as ThreadRow | null;
  if (!thread) return null;

  const connectionId = row.channel_connection_id ?? thread.channel_connection_id;
  if (!connectionId) return null;

  // Respeita as TRES travas que param a IA, nao so a da conexao: a chave da conexao, a bandeira
  // `ai_conversation_auto_reply` da organizacao e o interruptor `ai_enabled` que o proprio
  // cliente mexe no painel dele. Olhar so `config.aiEnabled` fazia o lembrete continuar saindo
  // sozinho depois de o cliente ter pausado a IA (achado alto da revisao de seguranca).
  const gate = await loadFreshConversationAIGate({
    admin,
    connectionId,
    organizationId: row.organization_id,
  });
  if (!gate.ok) return null;
  const connection = gate.connection as ConnectionRow;

  const phone = toWhatsAppPhone(thread.contact_phone);
  if (!phone) return null;

  return {
    thread,
    connection,
    phone,
    agentName: resolveConversationAIAgentConfig(connection.config).agentName,
  };
}

async function deliverReminder(input: {
  admin: AdminClient;
  row: ReminderRow;
  context: ReminderContext;
  sentAt: string;
}): Promise<void> {
  const { admin, row, context, sentAt } = input;
  const { connection, thread } = context;

  const instanceName = String((connection.config || {}).instanceName || '').trim();
  const resolved = await resolveEvolutionCredentials({
    admin,
    tenantId: connection.organization_id,
    connectionConfig: connection.config || {},
  });
  if (!instanceName || !resolved?.apiUrl || !resolved.apiKey) {
    throw new Error('Conexao WhatsApp sem instanceName ou credencial Evolution configurada.');
  }

  const text = buildMeetingLinkReminderText({
    contactName: row.contact_name ?? thread.contact_name,
    meetLink: row.meet_link!,
  });

  const sendResult = await sendEvolutionTextMessage({
    apiUrl: resolved.apiUrl,
    instanceName,
    apiKey: resolved.apiKey,
    phone: context.phone,
    text,
    sendMode: ((connection.config || {}).sendMode || 'auto') as 'auto',
  });

  const inserted = await admin.from('conversation_messages').insert({
    thread_id: row.thread_id,
    organization_id: row.organization_id,
    direction: 'outbound',
    message_type: 'text',
    author_name: context.agentName,
    content: text,
    metadata: {
      provider: 'evolution',
      automation_source: 'google_meeting_reminder',
      meeting_activity_id: row.activity_id,
      delivery_status: 'sent',
      delivery_provider: 'evolution',
      delivery_attempt: sendResult.attemptLabel ?? 'unknown',
      provider_message_id: sendResult.providerMessageId ?? null,
      credential_source: resolved.source,
    },
    sent_at: sentAt,
    created_at: sentAt,
  });
  // A mensagem JA SAIU pelo WhatsApp neste ponto. Lançar aqui faria o aviso no sino dizer "a
  // mensagem não saiu" sobre uma mensagem que saiu (achado baixo da revisao de correcao): o
  // humano mandaria o link de novo, e o lead receberia duas vezes. O que falhou foi o registro.
  if (inserted.error) {
    console.warn('[meeting reminder] Reminder was sent but could not be recorded', {
      organizationId: row.organization_id,
      activityId: row.activity_id,
      error: inserted.error.message,
    });
  }

  // Registra a saida SEM mexer no estado da conversa: ela continua na fila humana, como estava
  // desde a confirmacao da reuniao.
  const updated = await admin
    .from('conversation_threads')
    .update({
      last_message_at: sentAt,
      updated_at: sentAt,
      metadata: buildConversationThreadMetadataUpdate(thread.metadata, {
        direction: 'outbound',
        preview: text.slice(0, 160),
        messageType: 'text',
        sentAt,
        authorName: context.agentName,
        provider: 'evolution',
      }),
    })
    .eq('id', row.thread_id)
    .eq('organization_id', row.organization_id);
  if (updated.error) {
    console.warn('[meeting reminder] Failed to record the reminder on the thread', {
      threadId: row.thread_id,
      error: updated.error.message,
    });
  }
}

/** Aviso de ALTA severidade daquela reuniao, uma vez so. `false` quando outro tick ja escalou. */
async function escalate(input: {
  admin: AdminClient;
  row: ReminderRow;
  reason: string;
  now: string;
  force?: boolean;
}): Promise<boolean> {
  const { admin, row } = input;
  const escalatedAt = new Date().toISOString();

  const claimBase = admin
    .from(GOOGLE_MEETING_EVENT_TABLE)
    .update({ reminder_escalated_at: escalatedAt, updated_at: escalatedAt })
    .eq('activity_id', row.activity_id)
    .eq('organization_id', row.organization_id);
  const claim = await (input.force ? claimBase : claimBase.is('reminder_escalated_at', null)).select('activity_id');
  if (claim.error) {
    console.warn('[meeting reminder] Failed to claim the escalation', {
      activityId: row.activity_id,
      error: claim.error.message,
    });
    return false;
  }
  if (!claim.data || claim.data.length === 0) return false;

  const contactLabel = row.contact_name || 'o lead';
  const id = buildConversationScopedEventId({
    organizationId: row.organization_id,
    threadId: row.thread_id,
    eventId: `google-reminder-missing:${row.activity_id}`,
  });
  const notified = await admin.from('system_notifications').upsert({
    id,
    organization_id: row.organization_id,
    type: 'SYSTEM_ALERT',
    title: 'Reunião em 15 min sem link do Google',
    message: `A reunião com ${contactLabel} começa em ${MEETING_REMINDER_LEAD_MINUTES} minutos e `
      + `${input.reason}; mande o link na mão pelo WhatsApp.`.slice(0, 600),
    link: `/platform/tenants/${row.organization_id}/conversations?thread=${encodeURIComponent(row.thread_id)}`,
    severity: 'high',
    read_at: null,
    created_at: escalatedAt,
  }, { onConflict: 'id' });
  if (notified.error) {
    console.warn('[meeting reminder] Failed to record the escalation notification', {
      activityId: row.activity_id,
      error: notified.error.message,
    });
  }
  return true;
}
