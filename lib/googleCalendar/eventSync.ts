import 'server-only';

import { randomUUID } from 'node:crypto';

import type { createStaticAdminClient } from '@/lib/supabase/server';
import { buildConversationScopedEventId } from '@/lib/conversations/handoffEventId';
import {
  MEETING_TARGET_DURATION_MINUTES,
  resolveConversationCalendarConfig,
} from '@/lib/conversations/meetingAvailability';
import { redactChannelSecrets } from '@/lib/channels/redactChannelSecrets';
import { markGoogleCalendarConnectionIssue } from './connectionStore';
import { getGoogleCalendarAccessToken } from './oauth';
import {
  deleteGoogleCalendarEvent,
  getGoogleCalendarEvent,
  GoogleApiError,
  insertGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  type GoogleCalendarEvent,
  type GoogleCalendarEventInput,
} from './googleApiClient';
import {
  buildGoogleMeetingEventTitle,
  GOOGLE_INVITE_LOG_TABLE,
  googleMeetingEventIdFor,
  googleMeetingRetryDelayMs,
  GOOGLE_MEETING_EVENT_DESCRIPTION,
  GOOGLE_MEETING_EVENT_TABLE,
  MAX_GOOGLE_MEETING_ATTEMPTS,
  PENDING_GOOGLE_MEETING_STATUSES,
  type GoogleMeetingEventStatus,
} from './meetingEventQueue';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

/**
 * Teto de convites NOVOS por conexao do Google (organizacao + responsavel) em 24 h. O e-mail
 * vem do lead e nao tem prova de posse: sem teto, a Aurora viraria remetente de convite
 * arbitrario usando a identidade Google verdadeira do responsavel (critica de seguranca).
 */
export const GOOGLE_MEETING_DAILY_INVITE_LIMIT = 20;

const INVITE_WINDOW_MS = 24 * 60 * 60_000;
/** Enquanto o Meet nao fica pronto, o evento e relido daqui a pouco (nao e falha). */
const MEET_PENDING_RETRY_MS = 60_000;

export type GoogleMeetingSyncSummary = {
  due: number;
  created: number;
  updated: number;
  cancelled: number;
  /** releituras que finalmente trouxeram o link do Meet */
  linked: number;
  skipped: number;
  failed: number;
  errors: string[];
  truncated: boolean;
};

type MeetingEventRow = {
  activity_id: string;
  organization_id: string;
  thread_id: string;
  channel_connection_id: string | null;
  owner_id: string;
  contact_id: string | null;
  contact_name: string | null;
  invitee_email: string | null;
  invited_at: string | null;
  invited_email: string | null;
  scheduled_at: string;
  timezone: string;
  google_calendar_id: string;
  google_event_id: string | null;
  meet_link: string | null;
  status: GoogleMeetingEventStatus;
  attempts: number;
};

const ROW_COLUMNS =
  'activity_id, organization_id, thread_id, channel_connection_id, owner_id, contact_id, '
  + 'contact_name, invitee_email, invited_at, invited_email, scheduled_at, timezone, '
  + 'google_calendar_id, google_event_id, meet_link, status, attempts';

function meetingEndAt(scheduledAt: string): string {
  return new Date(new Date(scheduledAt).getTime() + MEETING_TARGET_DURATION_MINUTES * 60_000).toISOString();
}

/**
 * Convidados do evento: o lead (quando ha e-mail e ele nao foi barrado pelo teto) e os fixos da
 * conexao, sem repetir (compara em minusculas) e sem passar do limite. Conexao sem
 * `extraAttendees` monta exatamente a mesma lista de antes.
 */
export function buildGoogleMeetingAttendees(input: {
  inviteeEmail: string | null;
  extraAttendees: string[];
}): string[] {
  const attendees: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [input.inviteeEmail, ...input.extraAttendees]) {
    const email = typeof candidate === 'string' ? candidate.trim() : '';
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    attendees.push(email);
  }
  return attendees;
}

/**
 * Corpo do evento. `mode` decide as duas coisas que NAO podem ser iguais nas duas operacoes:
 *
 * - `insert` manda `id` proprio (idempotencia: retentativa recebe 409 em vez de criar um
 *   segundo evento) e pede a conferencia do Meet;
 * - `patch` NAO manda nenhum dos dois. `conferenceData.createRequest` num evento que JA tem
 *   conferencia pede ao Google para criar outra: ou o link do Meet muda depois de o lead ja
 *   ter recebido o antigo por e-mail, ou a conferencia volta `pending` e o link velho congela
 *   na linha (achado alto da revisao de correcao). Remarcacao mexe so em horario e convidados.
 */
function buildEventInput(
  row: MeetingEventRow,
  attendeeEmails: string[],
  mode: 'insert' | 'patch',
): GoogleCalendarEventInput {
  return {
    // Titulo e descricao FIXOS: nada que veio do LLM entra no convite que sai por e-mail (G16).
    summary: buildGoogleMeetingEventTitle(row.contact_name),
    description: GOOGLE_MEETING_EVENT_DESCRIPTION,
    startAt: row.scheduled_at,
    endAt: meetingEndAt(row.scheduled_at),
    timezone: row.timezone,
    attendeeEmails,
    conferenceRequestId: mode === 'insert' ? randomUUID() : null,
    eventId: mode === 'insert' ? googleMeetingEventIdFor(row.activity_id) : null,
  };
}

/**
 * E-mails fixos configurados na conexao (`config.calendar.extraAttendees`). Nao contam nos
 * limites anti-abuso: o teto existe por causa do e-mail do LEAD, que nao tem prova de posse;
 * estes sao configuracao do proprio cliente do CRM.
 */
async function loadExtraAttendees(input: {
  admin: AdminClient;
  organizationId: string;
  channelConnectionId: string | null;
}): Promise<string[]> {
  if (!input.channelConnectionId) return [];
  const result = await input.admin
    .from('channel_connections')
    .select('config')
    .eq('id', input.channelConnectionId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (result.error) return [];
  const calendar = resolveConversationCalendarConfig(
    (result.data as { config?: Record<string, unknown> | null } | null)?.config,
  );
  return calendar?.extraAttendees ?? [];
}

async function notify(input: {
  admin: AdminClient;
  organizationId: string;
  threadId: string;
  eventKey: string;
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  /** `connection` = aviso do responsavel/conexao, nao de uma conversa (muda o link do sino). */
  scope?: 'conversation' | 'connection';
  now: string;
}): Promise<void> {
  const id = buildConversationScopedEventId({
    organizationId: input.organizationId,
    threadId: input.threadId,
    eventId: input.eventKey,
  });
  const result = await input.admin.from('system_notifications').upsert({
    id,
    organization_id: input.organizationId,
    type: 'SYSTEM_ALERT',
    title: input.title,
    message: input.message.slice(0, 600),
    // Aviso de conversa leva para a conversa; aviso de conexao (reconectar, orfao) leva para a
    // tela de canais, que e onde a acao acontece — antes apontava para uma conversa inexistente.
    link: input.scope === 'connection'
      ? `/platform/tenants/${input.organizationId}/channels`
      : `/platform/tenants/${input.organizationId}/conversations?thread=${encodeURIComponent(input.threadId)}`,
    severity: input.severity,
    read_at: null,
    created_at: input.now,
  }, { onConflict: 'id' });
  if (result.error) {
    console.warn('[GoogleCalendar] Failed to record meeting event notification', {
      organizationId: input.organizationId,
      eventKey: input.eventKey,
      error: result.error.message,
    });
  }
}

/** Aviso de reconexao: um por responsavel por dia, nao um por reuniao. */
async function notifyReconnectRequired(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string;
  now: string;
}): Promise<void> {
  const dayBucket = Math.floor(new Date(input.now).getTime() / INVITE_WINDOW_MS);
  await notify({
    admin: input.admin,
    organizationId: input.organizationId,
    threadId: input.ownerId,
    eventKey: `google-reconnect:${dayBucket}`,
    scope: 'connection',
    title: 'Google Agenda precisa ser reconectado',
    message: 'O acesso do Google expirou ou foi revogado. As reuniões confirmadas não estão indo '
      + 'para a sua agenda nem gerando link do Meet. Reconecte na tela da conexão.',
    severity: 'high',
    now: input.now,
  });
}

/**
 * Quantos convites de fato SAIRAM desta conexao nas ultimas 24 h.
 *
 * Conta linhas do LOG de convites, nao linhas da fila de reunioes. A primeira versao contava a
 * fila, e como a remarcacao reusa a MESMA linha (activity_id e a chave), o contador de uma
 * conversa nunca passava de 1: dava para informar um e-mail, remarcar, trocar o e-mail, remarcar
 * de novo, e cada volta disparava um convite real da conta Google da empresa para um endereco
 * novo sem nunca encostar no teto (achado alto da revisao dos consertos).
 */
async function countRecentInvites(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string;
  now: string;
}): Promise<number> {
  const since = new Date(new Date(input.now).getTime() - INVITE_WINDOW_MS).toISOString();
  const result = await input.admin
    .from(GOOGLE_INVITE_LOG_TABLE)
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .gte('sent_at', since);
  if (result.error) throw new Error(result.error.message);
  return (result.data || []).length;
}

/** Registra o convite que acabou de sair. E o que o teto conta e o historico de auditoria. */
async function recordInviteSent(input: {
  admin: AdminClient;
  row: MeetingEventRow;
  email: string;
  now: string;
}): Promise<void> {
  const inserted = await input.admin.from(GOOGLE_INVITE_LOG_TABLE).insert({
    organization_id: input.row.organization_id,
    owner_id: input.row.owner_id,
    invitee_email: input.email,
    source_activity_id: input.row.activity_id,
    sent_at: input.now,
  });
  if (inserted.error) {
    // Nao desfaz nada: o convite ja saiu. Mas sem o registro o teto perde a conta, entao o
    // aviso precisa aparecer em algum lugar.
    console.warn('[GoogleCalendar] Invite sent but not recorded in the log', {
      organizationId: input.row.organization_id,
      activityId: input.row.activity_id,
      error: inserted.error.message,
    });
  }
}

/**
 * Cria/atualiza/apaga no Google os eventos das reunioes ja reservadas no CRM.
 *
 * Roda no relogio de 5 min (nunca no caminho da resposta ao lead), com lote e prazo proprios
 * dentro do orcamento de 60 s do tick. Nunca lança para fora: o resumo vai na resposta do tick.
 *
 * Reivindicacao atomica por linha: o UPDATE do claim exige `attempts` e `status` iguais aos
 * lidos e empurra `next_retry_at` para a frente. Dois ticks concorrentes nunca chamam o Google
 * duas vezes para a mesma reuniao (no Postgres o segundo UPDATE reavalia o WHERE depois do
 * primeiro commitar, e casa zero linhas).
 */
export async function createDueGoogleCalendarEvents(input: {
  admin: AdminClient;
  now?: string;
  batchLimit?: number;
  deadlineMs?: number;
}): Promise<GoogleMeetingSyncSummary> {
  const { admin } = input;
  const now = input.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const batchLimit = input.batchLimit ?? 5;
  const deadlineMs = input.deadlineMs ?? 10_000;
  const startedAt = Date.now();
  const summary: GoogleMeetingSyncSummary = {
    due: 0, created: 0, updated: 0, cancelled: 0, linked: 0,
    skipped: 0, failed: 0, errors: [], truncated: false,
  };

  const dueResult = await admin
    .from(GOOGLE_MEETING_EVENT_TABLE)
    .select(ROW_COLUMNS)
    .in('status', PENDING_GOOGLE_MEETING_STATUSES)
    // `null <= now` nao e verdadeiro em SQL: linha sem trabalho pendente nunca entra no lote.
    .lte('next_retry_at', now)
    .order('next_retry_at', { ascending: true })
    .limit(batchLimit);
  if (dueResult.error) throw new Error(dueResult.error.message);

  const rows = (dueResult.data || []) as unknown as MeetingEventRow[];
  summary.due = rows.length;
  if (rows.length === 0) return summary;

  for (const row of rows) {
    if (Date.now() - startedAt > deadlineMs) {
      summary.truncated = true;
      break;
    }

    // `created` so entra no lote para reler o Meet que ainda nao ficou pronto.
    if (row.status === 'created' && row.meet_link) {
      await admin
        .from(GOOGLE_MEETING_EVENT_TABLE)
        .update({ next_retry_at: null, updated_at: now })
        .eq('activity_id', row.activity_id)
        .eq('organization_id', row.organization_id);
      summary.skipped += 1;
      continue;
    }

    const attempt = row.attempts + 1;
    const claim = await admin
      .from(GOOGLE_MEETING_EVENT_TABLE)
      .update({
        attempts: attempt,
        next_retry_at: new Date(nowMs + googleMeetingRetryDelayMs(attempt)).toISOString(),
        updated_at: now,
      })
      .eq('activity_id', row.activity_id)
      .eq('organization_id', row.organization_id)
      .eq('attempts', row.attempts)
      .eq('status', row.status)
      .select('activity_id');
    if (claim.error) {
      summary.failed += 1;
      summary.errors.push(`${row.activity_id}: ${claim.error.message}`);
      continue;
    }
    if (!claim.data || claim.data.length === 0) {
      summary.skipped += 1;
      continue;
    }

    let accessToken: string | null = null;
    try {
      accessToken = await getGoogleCalendarAccessToken({
        admin,
        organizationId: row.organization_id,
        ownerId: row.owner_id,
      });
      if (!accessToken) {
        // Sem conexao/credencial: nao e erro do Google, so nao ha o que fazer neste ciclo.
        // Mas NAO pode girar para sempre: o claim ja gastou uma tentativa e, sem teto, uma
        // linha `cancel_pending` de uma conexao desfeita voltaria a cada 3 h eternamente e o
        // evento ficaria na agenda sem ninguem saber (achado medio da revisao de correcao).
        if (attempt >= MAX_GOOGLE_MEETING_ATTEMPTS) {
          await recordFailure({
            admin,
            row,
            attempt,
            error: new Error('missing_google_credential'),
            message: 'O Google Agenda não está conectado para o responsável desta reunião.',
            now,
          });
          summary.failed += 1;
          continue;
        }
        summary.skipped += 1;
        continue;
      }

      if (row.status === 'cancel_pending') {
        await cancelEvent({ admin, row, accessToken, now });
        summary.cancelled += 1;
        continue;
      }

      if (row.status === 'created') {
        const linked = await refreshMeetLink({ admin, row, accessToken, attempt, now });
        if (linked) summary.linked += 1;
        continue;
      }

      if (row.status === 'update_pending' && row.google_event_id) {
        await patchEvent({ admin, row, accessToken, now });
        summary.updated += 1;
        continue;
      }

      await insertEvent({ admin, row, accessToken, now });
      summary.created += 1;
    } catch (error) {
      summary.failed += 1;
      const message = redactChannelSecrets(error, [accessToken], 'Falha ao falar com o Google Agenda.');
      summary.errors.push(`${row.activity_id}: ${message}`);
      await recordFailure({ admin, row, attempt, error, message, now });
    }
  }

  return summary;
}

type InviteDecision = {
  /** Endereco do lead que vai no `attendees` desta chamada (nulo = evento so para o responsavel). */
  attendeeEmail: string | null;
  /** Um convite NOVO vai sair para este endereco: consome o teto e gera aviso de auditoria. */
  isNewInvite: boolean;
  /** Barrado pelo teto: o evento sai mesmo assim, sem o convidado do lead. */
  blocked: boolean;
};

/**
 * Decide se o e-mail do lead entra nesta chamada — e vale para o insert E para o patch.
 *
 * O teto contava so no insert (achado BLOQUEANTE da revisao de seguranca): bastava o lead
 * confirmar sem e-mail, informar um endereco qualquer depois e pedir remarcacao para o
 * `events.patch` disparar convite real da conta Google da empresa, sem consumir teto e sem
 * aparecer no sino. Agora quem manda e a comparacao com `invited_email`:
 *
 * - mesmo endereco que ja foi convidado -> nao e convite novo (o Google so avisa a mudanca);
 * - endereco diferente (ou primeiro convite) -> passa pelo teto e vira aviso de auditoria;
 * - teto estourado -> o evento sai sem o convidado do lead, com aviso alto para convidar na mao.
 */
async function resolveInviteDecision(input: {
  admin: AdminClient;
  row: MeetingEventRow;
  now: string;
}): Promise<InviteDecision> {
  const { row } = input;
  const email = row.invitee_email;
  if (!email) {
    // Sem e-mail novo: mantem quem ja tinha sido convidado (remarcacao avisa a mesma pessoa).
    return { attendeeEmail: row.invited_email, isNewInvite: false, blocked: false };
  }

  const alreadyInvited = Boolean(row.invited_email)
    && row.invited_email!.trim().toLowerCase() === email.trim().toLowerCase();
  if (alreadyInvited) return { attendeeEmail: email, isNewInvite: false, blocked: false };

  const recentInvites = await countRecentInvites({
    admin: input.admin, organizationId: row.organization_id, ownerId: row.owner_id, now: input.now,
  });
  if (recentInvites >= GOOGLE_MEETING_DAILY_INVITE_LIMIT) {
    // Estourou o teto: o evento SAI (o responsavel precisa dele na agenda), mas sem o convidado
    // que veio do lead. O humano e avisado para convidar na mao se for caso legitimo.
    return { attendeeEmail: row.invited_email, isNewInvite: false, blocked: true };
  }
  return { attendeeEmail: email, isNewInvite: true, blocked: false };
}

/** Avisos de auditoria do convite (um por endereco, nunca sobrescrito pela remarcacao). */
async function notifyInviteOutcome(input: {
  admin: AdminClient;
  row: MeetingEventRow;
  decision: InviteDecision;
  now: string;
  context: 'created' | 'updated';
}): Promise<void> {
  const { admin, row, decision, now } = input;
  if (decision.isNewInvite && decision.attendeeEmail) {
    await recordInviteSent({ admin, row, email: decision.attendeeEmail, now });
    await notify({
      admin,
      organizationId: row.organization_id,
      threadId: row.thread_id,
      // Endereco no id: convidar um e-mail NOVO na remarcacao vira um aviso novo, nao some
      // por cima do anterior.
      eventKey: `google-invite:${row.activity_id}:${decision.attendeeEmail.toLowerCase()}`,
      title: 'Convite do Google enviado',
      message: input.context === 'created'
        ? `A reunião foi criada na sua agenda e o Google convidou ${decision.attendeeEmail}.`
        : `A reunião foi remarcada e o Google convidou ${decision.attendeeEmail}.`,
      severity: 'low',
      now,
    });
  }

  if (decision.blocked) {
    await notify({
      admin,
      organizationId: row.organization_id,
      threadId: row.thread_id,
      eventKey: `google-invite-limit:${row.activity_id}`,
      title: 'Convite do Google não enviado (limite do dia)',
      message: `A reunião está na sua agenda, mas o convite para ${row.invitee_email} não saiu: `
        + `o limite de ${GOOGLE_MEETING_DAILY_INVITE_LIMIT} convites em 24 h foi atingido. Convide na mão se for legítimo.`,
      severity: 'high',
      now,
    });
  }
}

async function insertEvent(input: {
  admin: AdminClient;
  row: MeetingEventRow;
  accessToken: string;
  now: string;
}): Promise<void> {
  const { admin, row, now } = input;

  const decision = await resolveInviteDecision({ admin, row, now });
  const extraAttendees = await loadExtraAttendees({
    admin, organizationId: row.organization_id, channelConnectionId: row.channel_connection_id,
  });
  const attendees = buildGoogleMeetingAttendees({
    inviteeEmail: decision.attendeeEmail,
    extraAttendees,
  });

  let event: GoogleCalendarEvent;
  try {
    event = await insertGoogleCalendarEvent({
      accessToken: input.accessToken,
      calendarId: row.google_calendar_id,
      event: buildEventInput(row, attendees, 'insert'),
      sendUpdates: attendees.length > 0 ? 'all' : 'none',
    });
  } catch (error) {
    // 409 = o evento com o NOSSO id ja existe: a tentativa anterior chegou no Google e so a
    // resposta se perdeu (timeout de 6 s, 5xx depois do commit, funcao morta no meio). Ler o
    // que ja esta la e seguir — criar de novo mandaria um segundo convite ao lead e deixaria
    // o primeiro evento orfao para sempre.
    if (!(error instanceof GoogleApiError) || error.status !== 409) throw error;
    event = await getGoogleCalendarEvent({
      accessToken: input.accessToken,
      calendarId: row.google_calendar_id,
      eventId: googleMeetingEventIdFor(row.activity_id),
    });
    // O Google guarda o id por um tempo DEPOIS de o evento ser apagado: adotar um evento
    // cancelado gravaria a linha como `created` e ela passaria 5 releituras atras de um link
    // que nunca vem, terminando com um diagnostico errado.
    if (event.status === 'cancelled') {
      throw new GoogleApiError(
        'O evento foi apagado na agenda e o Google ainda reserva o mesmo id.', 409, 'event_cancelled',
      );
    }
  }

  await persistEvent({
    admin,
    row,
    event,
    now,
    invitedAt: decision.isNewInvite ? now : row.invited_at,
    invitedEmail: decision.isNewInvite ? decision.attendeeEmail : row.invited_email,
  });

  await notifyInviteOutcome({ admin, row, decision, now, context: 'created' });
}

async function patchEvent(input: {
  admin: AdminClient;
  row: MeetingEventRow;
  accessToken: string;
  now: string;
}): Promise<void> {
  const { admin, row, now } = input;

  const decision = await resolveInviteDecision({ admin, row, now });
  const extraAttendees = await loadExtraAttendees({
    admin, organizationId: row.organization_id, channelConnectionId: row.channel_connection_id,
  });

  const event = await patchGoogleCalendarEvent({
    accessToken: input.accessToken,
    calendarId: row.google_calendar_id,
    eventId: row.google_event_id!,
    // Remarcacao mantem os convidados (lead + fixos): o Google avisa todo mundo (sendUpdates=all).
    event: buildEventInput(row, buildGoogleMeetingAttendees({
      inviteeEmail: decision.attendeeEmail,
      extraAttendees,
    }), 'patch'),
  });

  await persistEvent({
    admin,
    row,
    event,
    now,
    invitedAt: decision.isNewInvite ? now : row.invited_at,
    invitedEmail: decision.isNewInvite ? decision.attendeeEmail : row.invited_email,
  });

  await notifyInviteOutcome({ admin, row, decision, now, context: 'updated' });
}

async function cancelEvent(input: {
  admin: AdminClient;
  row: MeetingEventRow;
  accessToken: string;
  now: string;
}): Promise<void> {
  const { admin, row, now } = input;
  // Sem id de evento nao ha o que apagar no Google (a linha so fecha aqui).
  if (row.google_event_id) {
    await deleteGoogleCalendarEvent({
      accessToken: input.accessToken,
      calendarId: row.google_calendar_id,
      eventId: row.google_event_id,
    });
  }
  const updated = await admin
    .from(GOOGLE_MEETING_EVENT_TABLE)
    .update({
      status: 'cancelled',
      attempts: 0,
      last_error: null,
      next_retry_at: null,
      // O lembrete daquela reuniao fica suprimido para sempre.
      reminder_sent_at: now,
      reminder_escalated_at: now,
      updated_at: now,
    })
    .eq('activity_id', row.activity_id)
    .eq('organization_id', row.organization_id);
  if (updated.error) throw new Error(updated.error.message);
}

/** Meet ainda `pending` no insert: rele o evento ate o `hangoutLink` aparecer. */
async function refreshMeetLink(input: {
  admin: AdminClient;
  row: MeetingEventRow;
  accessToken: string;
  attempt: number;
  now: string;
}): Promise<boolean> {
  const { admin, row, now } = input;
  if (!row.google_event_id) {
    await admin
      .from(GOOGLE_MEETING_EVENT_TABLE)
      .update({ next_retry_at: null, updated_at: now })
      .eq('activity_id', row.activity_id)
      .eq('organization_id', row.organization_id);
    return false;
  }

  const event = await getGoogleCalendarEvent({
    accessToken: input.accessToken,
    calendarId: row.google_calendar_id,
    eventId: row.google_event_id,
  });

  if (event.hangoutLink) {
    const updated = await admin
      .from(GOOGLE_MEETING_EVENT_TABLE)
      .update({
        meet_link: event.hangoutLink,
        status: 'created',
        attempts: 0,
        last_error: null,
        next_retry_at: null,
        updated_at: now,
      })
      .eq('activity_id', row.activity_id)
      .eq('organization_id', row.organization_id);
    if (updated.error) throw new Error(updated.error.message);
    return true;
  }

  // Esgotou as releituras: para de insistir. A Fatia 4 escala 15 min antes, se for o caso.
  const exhausted = input.attempt >= MAX_GOOGLE_MEETING_ATTEMPTS;
  const updated = await admin
    .from(GOOGLE_MEETING_EVENT_TABLE)
    .update({
      next_retry_at: exhausted ? null : new Date(new Date(now).getTime() + MEET_PENDING_RETRY_MS).toISOString(),
      last_error: exhausted ? 'O Google não gerou o link do Meet para este evento.' : null,
      updated_at: now,
    })
    .eq('activity_id', row.activity_id)
    .eq('organization_id', row.organization_id);
  if (updated.error) throw new Error(updated.error.message);
  return false;
}

async function persistEvent(input: {
  admin: AdminClient;
  row: MeetingEventRow;
  event: GoogleCalendarEvent;
  now: string;
  invitedAt: string | null;
  invitedEmail: string | null;
}): Promise<void> {
  const { admin, row, event, now } = input;
  const hasLink = Boolean(event.hangoutLink);
  const updated = await admin
    .from(GOOGLE_MEETING_EVENT_TABLE)
    .update({
      google_event_id: event.id ?? row.google_event_id,
      meet_link: event.hangoutLink ?? row.meet_link,
      status: 'created',
      attempts: 0,
      last_error: null,
      // Sem link NESTA resposta: rele daqui a pouco. Olhar so `hasLink` e de proposito — usar
      // o link antigo da linha como prova de que esta tudo certo fazia a releitura parar cedo
      // demais e o lembrete mandar um link possivelmente morto (achado da revisao de correcao).
      next_retry_at: hasLink ? null : new Date(new Date(now).getTime() + MEET_PENDING_RETRY_MS).toISOString(),
      invited_at: input.invitedAt,
      invited_email: input.invitedEmail,
      updated_at: now,
    })
    .eq('activity_id', row.activity_id)
    .eq('organization_id', row.organization_id);
  if (updated.error) throw new Error(updated.error.message);
}

async function recordFailure(input: {
  admin: AdminClient;
  row: MeetingEventRow;
  attempt: number;
  error: unknown;
  message: string;
  now: string;
}): Promise<void> {
  const { admin, row, now } = input;
  const isInvalidGrant = input.error instanceof GoogleApiError && input.error.code === 'invalid_grant';
  const exhausted = input.attempt >= MAX_GOOGLE_MEETING_ATTEMPTS;

  console.warn('[GoogleCalendar] Meeting event sync failed', {
    organizationId: row.organization_id,
    activityId: row.activity_id,
    status: row.status,
    attempt: input.attempt,
    invalidGrant: isInvalidGrant,
    error: input.message,
  });

  const updated = await admin
    .from(GOOGLE_MEETING_EVENT_TABLE)
    .update({
      // Token morto ou tentativas esgotadas: para de insistir (a reserva do CRM continua valendo).
      status: exhausted || isInvalidGrant ? 'failed' : row.status,
      last_error: input.message.slice(0, 500),
      next_retry_at: exhausted || isInvalidGrant ? null : undefined,
      updated_at: now,
    })
    .eq('activity_id', row.activity_id)
    .eq('organization_id', row.organization_id);
  if (updated.error) {
    console.warn('[GoogleCalendar] Failed to persist meeting event failure', {
      activityId: row.activity_id,
      error: updated.error.message,
    });
  }

  if (isInvalidGrant) {
    await markGoogleCalendarConnectionIssue({
      admin,
      organizationId: row.organization_id,
      ownerId: row.owner_id,
      status: 'reconnect_required',
      lastError: input.message,
    });
    await notifyReconnectRequired({
      admin, organizationId: row.organization_id, ownerId: row.owner_id, now,
    });
    return;
  }

  if (exhausted) {
    // Cancelar e o caso inverso: o problema nao e a falta do evento, e ele ter SOBRADO.
    const cancelling = row.status === 'cancel_pending';
    await notify({
      admin,
      organizationId: row.organization_id,
      threadId: row.thread_id,
      eventKey: `google-event-failed:${row.activity_id}`,
      title: cancelling ? 'Reunião cancelada, evento ainda no Google' : 'Reunião confirmada sem evento no Google',
      message: cancelling
        ? 'A reunião foi cancelada no CRM, mas o evento não saiu do Google depois de '
          + `${MAX_GOOGLE_MEETING_ATTEMPTS} tentativas. Apague na mão na sua agenda.`
        : 'A reunião está reservada no CRM, mas o evento não entrou no Google depois de '
          + `${MAX_GOOGLE_MEETING_ATTEMPTS} tentativas. Crie na mão e mande o link para o lead.`,
      severity: 'high',
      now,
    });
  }
}

// =============================================================================
// Eventos orfaos: o que ficou vivo no Google depois de a linha do espelho sumir.
//
// Apagar uma CONVERSA pela tela apaga as activities do contato e a thread; as duas FKs do
// espelho sao `on delete cascade`, entao a linha evapora e o evento continuava na agenda do
// responsavel, com o lead convidado, para sempre (achado medio da revisao de seguranca). O
// gatilho `capture_orphan_google_calendar_event` copia o minimo antes de a linha morrer e este
// passo do tick apaga no Google.
// =============================================================================

export const GOOGLE_ORPHAN_EVENT_TABLE = 'google_calendar_orphan_events';

type OrphanRow = {
  id: string;
  organization_id: string;
  owner_id: string;
  google_calendar_id: string;
  google_event_id: string;
  attempts: number;
};

export type GoogleOrphanSyncSummary = {
  due: number;
  deleted: number;
  skipped: number;
  failed: number;
  errors: string[];
  truncated: boolean;
};

export async function deleteOrphanGoogleCalendarEvents(input: {
  admin: AdminClient;
  now?: string;
  batchLimit?: number;
  deadlineMs?: number;
}): Promise<GoogleOrphanSyncSummary> {
  const { admin } = input;
  const now = input.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const batchLimit = input.batchLimit ?? 5;
  const deadlineMs = input.deadlineMs ?? 4_000;
  const startedAt = Date.now();
  const summary: GoogleOrphanSyncSummary = {
    due: 0, deleted: 0, skipped: 0, failed: 0, errors: [], truncated: false,
  };

  const dueResult = await admin
    .from(GOOGLE_ORPHAN_EVENT_TABLE)
    .select('id, organization_id, owner_id, google_calendar_id, google_event_id, attempts')
    .lte('next_retry_at', now)
    .order('next_retry_at', { ascending: true })
    .limit(batchLimit);
  if (dueResult.error) throw new Error(dueResult.error.message);

  const rows = (dueResult.data || []) as unknown as OrphanRow[];
  summary.due = rows.length;
  if (rows.length === 0) return summary;

  for (const row of rows) {
    if (Date.now() - startedAt > deadlineMs) {
      summary.truncated = true;
      break;
    }

    const attempt = row.attempts + 1;
    const claim = await admin
      .from(GOOGLE_ORPHAN_EVENT_TABLE)
      .update({
        attempts: attempt,
        next_retry_at: new Date(nowMs + googleMeetingRetryDelayMs(attempt)).toISOString(),
        updated_at: now,
      })
      .eq('id', row.id)
      .eq('attempts', row.attempts)
      .select('id');
    if (claim.error) {
      summary.failed += 1;
      summary.errors.push(`${row.id}: ${claim.error.message}`);
      continue;
    }
    if (!claim.data || claim.data.length === 0) {
      summary.skipped += 1;
      continue;
    }

    let accessToken: string | null = null;
    try {
      accessToken = await getGoogleCalendarAccessToken({
        admin,
        organizationId: row.organization_id,
        ownerId: row.owner_id,
      });
      if (!accessToken) {
        // Conexao desfeita (ou o proprio responsavel apagado): nao ha como apagar la.
        await stopOrphanRetrying({
          admin, row, attempt, now,
          message: 'Sem conexão do Google para o responsável: apague o evento na mão, se ainda existir.',
        });
        summary.skipped += 1;
        continue;
      }

      await deleteGoogleCalendarEvent({
        accessToken,
        calendarId: row.google_calendar_id,
        eventId: row.google_event_id,
      });

      // 404/410 tambem chegam aqui (o cliente trata como sucesso): o destino ja e o desejado.
      const removed = await admin.from(GOOGLE_ORPHAN_EVENT_TABLE).delete().eq('id', row.id);
      if (removed.error) throw new Error(removed.error.message);
      summary.deleted += 1;
    } catch (error) {
      summary.failed += 1;
      const message = redactChannelSecrets(error, [accessToken], 'Falha ao apagar evento órfão no Google.');
      summary.errors.push(`${row.id}: ${message}`);
      const isInvalidGrant = error instanceof GoogleApiError && error.code === 'invalid_grant';
      if (attempt >= MAX_GOOGLE_MEETING_ATTEMPTS || isInvalidGrant) {
        await stopOrphanRetrying({ admin, row, attempt, now, message });
      } else {
        await admin
          .from(GOOGLE_ORPHAN_EVENT_TABLE)
          .update({ last_error: message.slice(0, 500), updated_at: now })
          .eq('id', row.id);
      }
    }
  }

  return summary;
}

/**
 * Para de insistir e AVISA. A tabela de orfaos nao tem tela nenhuma: sem o aviso no sino, o
 * evento continuaria na agenda do responsavel com o lead convidado e a unica prova seria uma
 * linha que ninguem le (achado medio da revisao dos consertos).
 */
async function stopOrphanRetrying(input: {
  admin: AdminClient;
  row: OrphanRow;
  attempt: number;
  now: string;
  message: string;
}): Promise<void> {
  // `threadId` aqui e so o que compoe o id do aviso; o link leva para a tela de conexoes.
  await notify({
    admin: input.admin,
    organizationId: input.row.organization_id,
    threadId: input.row.owner_id,
    eventKey: `google-orphan:${input.row.google_event_id}`,
    scope: 'connection',
    title: 'Evento continua na agenda do Google',
    message: 'Uma reunião foi apagada no CRM, mas o evento não saiu da agenda do Google: '
      + `${input.message} Apague na mão se ele ainda estiver lá.`,
    severity: 'high',
    now: input.now,
  });

  const updated = await input.admin
    .from(GOOGLE_ORPHAN_EVENT_TABLE)
    .update({
      next_retry_at: null,
      last_error: input.message.slice(0, 500),
      updated_at: input.now,
    })
    .eq('id', input.row.id);
  if (updated.error) {
    console.warn('[GoogleCalendar] Failed to park orphan event row', {
      organizationId: input.row.organization_id,
      orphanId: input.row.id,
      error: updated.error.message,
    });
  }
}

/**
 * Reconexao do Google: devolve para a fila as reunioes FUTURAS que morreram como `failed`
 * enquanto o token estava invalido.
 *
 * Sem isto, `failed` era terminal (achado alto da revisao de correcao): o token morria na
 * segunda, as reunioes confirmadas ate quarta viravam `failed`, o responsavel reconectava na
 * quinta e NENHUMA delas voltava a virar evento — cada uma so daria o aviso "sem link do
 * Google" 15 min antes da hora. Nunca lança: a reconexao acontece de qualquer jeito.
 */
export async function requeueFailedGoogleMeetingEvents(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string;
  now?: string;
}): Promise<number> {
  const now = input.now ?? new Date().toISOString();
  try {
    const updated = await input.admin
      .from(GOOGLE_MEETING_EVENT_TABLE)
      .update({
        // Sem evento no Google ainda e uma reuniao futura: recomeca do insert.
        status: 'pending',
        attempts: 0,
        last_error: null,
        next_retry_at: now,
        updated_at: now,
      })
      .eq('organization_id', input.organizationId)
      .eq('owner_id', input.ownerId)
      .eq('status', 'failed')
      .is('google_event_id', null)
      .gt('scheduled_at', now)
      .select('activity_id');
    if (updated.error) throw new Error(updated.error.message);
    return (updated.data || []).length;
  } catch (error) {
    console.warn('[GoogleCalendar] Failed to requeue failed meeting events', {
      organizationId: input.organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
