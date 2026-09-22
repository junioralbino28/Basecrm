import 'server-only';

import type { createStaticAdminClient } from '@/lib/supabase/server';
import { normalizeLeadEmail } from '@/lib/conversations/leadProfile';
import { getGoogleCalendarConnection } from './connectionStore';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

export const GOOGLE_MEETING_EVENT_TABLE = 'conversation_meeting_google_events';

export type GoogleMeetingEventStatus =
  | 'pending'
  | 'created'
  | 'update_pending'
  | 'cancel_pending'
  | 'cancelled'
  | 'failed'
  /**
   * Recusada pelo anti-abuso (1 evento futuro por contato). E um estado SEPARADO de `failed`
   * de proposito: `failed` significa "o Google falhou" e volta para a fila quando o responsavel
   * reconecta. Se as duas coisas dividissem o mesmo estado, reconectar o Google ressuscitaria a
   * recusa de politica e o limite deixaria de valer (achado alto da revisao dos consertos).
   */
  | 'blocked';

/** Tabela de auditoria dos convites de fato enviados — e o que o teto de 24 h conta. */
export const GOOGLE_INVITE_LOG_TABLE = 'google_calendar_invite_log';

/** Estados em que a reuniao ainda "vale" (conta para o limite de 1 evento ativo por contato). */
export const ACTIVE_GOOGLE_MEETING_STATUSES: GoogleMeetingEventStatus[] = [
  'pending',
  'created',
  'update_pending',
];

/** Estados que o passo do tick processa (os outros estao parados de proposito). */
export const PENDING_GOOGLE_MEETING_STATUSES: GoogleMeetingEventStatus[] = [
  'pending',
  'created',
  'update_pending',
  'cancel_pending',
];

/** Teto de tentativas antes de desistir (status `failed` + aviso no sino). */
export const MAX_GOOGLE_MEETING_ATTEMPTS = 5;

/** Espera crescente entre tentativas, em minutos, pela tentativa que acabou de ser gasta. */
const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 180];

export function googleMeetingRetryDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RETRY_BACKOFF_MINUTES.length) - 1;
  return RETRY_BACKOFF_MINUTES[index] * 60_000;
}

/**
 * Texto do evento: FIXO, nunca gerado pelo LLM (G16 e achado bloqueante da critica de
 * seguranca). O convite sai por e-mail em nome da conta Google do responsavel, entao nada
 * que o lead escreveu pode chegar ao corpo dele — so o primeiro nome, ja higienizado.
 */
/** Usado quando a conexao nao configurou marca e a organizacao nao tem nome legivel. */
export const GOOGLE_MEETING_DEFAULT_BRAND = 'Diagnóstico';

export function buildGoogleMeetingEventDescription(brandName: string): string {
  return `Diagnóstico agendado por ${brandName}. O link do Google Meet está neste convite. `
    + 'Se precisar remarcar, responda no WhatsApp.';
}

/** Nome do contato sem quebra de linha, sem excesso e sem nada alem do primeiro nome. */
export function sanitizeGoogleMeetingContactName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, 120);
}

/**
 * So LETRA (com acento), hifen e apostrofo entram no titulo do evento.
 *
 * O nome vem do `pushName` do WhatsApp, escolhido pelo proprio lead: sem esta peneira
 * um "nome" como `bit.ly/promo-xyz` virava o ASSUNTO de um convite legitimo saindo da
 * conta Google da empresa (achado alto da revisao de seguranca de 22/09). Colapsar
 * espaco e cortar em 40 caracteres nao resolvia — nenhum desses caracteres tem espaco.
 */
export function firstNameForGoogleMeetingEvent(value: string | null | undefined): string {
  const normalized = sanitizeGoogleMeetingContactName(value);
  if (!normalized) return 'Lead';
  const first = normalized.split(' ')[0] ?? '';
  const safe = first.replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 40);
  // Sobrou so pontuacao (nome todo feito de simbolo/URL/emoji): cai no rotulo neutro.
  return /\p{L}/u.test(safe) ? safe : 'Lead';
}

/**
 * Id do evento no Google derivado da activity — e o que torna o `events.insert`
 * IDEMPOTENTE (achado bloqueante da revisao de correcao).
 *
 * Sem ele, um timeout DEPOIS de o Google ter criado o evento fazia a retentativa criar
 * um SEGUNDO evento e mandar um SEGUNDO convite, deixando o primeiro orfao para sempre.
 * Com id fixo, a retentativa recebe 409 e o codigo le o evento que ja existe.
 *
 * Formato exigido pelo Google: base32hex (`0-9a-v`), 5 a 1024 caracteres. O hexadecimal
 * do uuid (`0-9a-f`) e subconjunto disso, e as letras do prefixo tambem.
 */
export function googleMeetingEventIdFor(activityId: string): string {
  return `cenno${activityId.replace(/-/g, '').toLowerCase()}`;
}

export function buildGoogleMeetingEventTitle(
  contactName: string | null | undefined,
  brandName: string,
): string {
  return `Diagnóstico ${brandName} — ${firstNameForGoogleMeetingEvent(contactName)}`.slice(0, 200);
}

export type EnqueueGoogleMeetingEventResult =
  | { enqueued: true; status: 'pending' | 'update_pending' }
  | { enqueued: false; reason: 'no_owner' | 'not_connected' | 'contact_limit' | 'error' };

/**
 * Grava (ou reaproveita) a linha do espelho do Google depois de a reserva do CRM dar certo.
 *
 * ZERO rede aqui: so decide se ha conexao `connected` para o responsavel e escreve a linha.
 * Toda chamada ao Google acontece no tick. Nunca lança: uma falha aqui vira aviso no log e a
 * reserva do CRM (que ja aconteceu) segue valendo.
 *
 * Remarcacao usa a MESMA activity (achado bloqueante da critica de operacao): a linha existente
 * vira `update_pending` e o evento do Google e atualizado, nunca duplicado nem deixado orfao.
 */
export async function enqueueGoogleCalendarMeetingEvent(input: {
  admin: AdminClient;
  organizationId: string;
  threadId: string;
  activityId: string;
  channelConnectionId: string | null;
  ownerId: string | null;
  contactId: string | null;
  contactName: string | null;
  scheduledAt: string;
  timezone: string;
  now?: string;
}): Promise<EnqueueGoogleMeetingEventResult> {
  const now = input.now ?? new Date().toISOString();

  try {
    if (!input.ownerId) return { enqueued: false, reason: 'no_owner' };
    const ownerId = input.ownerId;

    const connection = await getGoogleCalendarConnection({
      admin: input.admin,
      organizationId: input.organizationId,
      ownerId,
    });
    // Sem Google conectado nada e gravado — a tabela nasce e fica vazia (teste de regressao).
    if (!connection || connection.status !== 'connected') {
      return { enqueued: false, reason: 'not_connected' };
    }

    const existing = await input.admin
      .from(GOOGLE_MEETING_EVENT_TABLE)
      .select('activity_id, status, google_event_id')
      .eq('activity_id', input.activityId)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    const inviteeEmail = await readContactInviteeEmail({
      admin: input.admin,
      organizationId: input.organizationId,
      contactId: input.contactId,
    });
    const contactName = sanitizeGoogleMeetingContactName(input.contactName);

    if (existing.data) {
      const current = existing.data as { status: GoogleMeetingEventStatus; google_event_id: string | null };
      // Ja existe evento no Google: remarcar e `events.patch` na MESMA linha.
      const nextStatus: GoogleMeetingEventStatus = current.google_event_id ? 'update_pending' : 'pending';
      const updated = await input.admin
        .from(GOOGLE_MEETING_EVENT_TABLE)
        .update({
          thread_id: input.threadId,
          channel_connection_id: input.channelConnectionId,
          owner_id: ownerId,
          contact_id: input.contactId,
          contact_name: contactName,
          invitee_email: inviteeEmail,
          scheduled_at: input.scheduledAt,
          timezone: input.timezone,
          google_calendar_id: connection.googleCalendarId,
          status: nextStatus,
          attempts: 0,
          last_error: null,
          next_retry_at: now,
          // Horario novo: o lembrete daquela reuniao volta a valer.
          reminder_sent_at: null,
          reminder_escalated_at: null,
          updated_at: now,
        })
        .eq('activity_id', input.activityId)
        .eq('organization_id', input.organizationId);
      if (updated.error) throw new Error(updated.error.message);
      return { enqueued: true, status: nextStatus };
    }

    // Anti-abuso: no maximo 1 evento FUTURO ativo por contato (o e-mail vem do lead, sem
    // prova de posse). O recorte por `scheduled_at > now` e obrigatorio: `created` nunca vira
    // outro estado depois que a reuniao acontece, entao contar reuniao PASSADA travaria para
    // sempre o lead que volta meses depois — ele receberia "reuniao marcada" no WhatsApp e
    // nenhum evento/link jamais sairia.
    if (input.contactId) {
      const active = await input.admin
        .from(GOOGLE_MEETING_EVENT_TABLE)
        .select('activity_id')
        .eq('organization_id', input.organizationId)
        .eq('contact_id', input.contactId)
        .in('status', ACTIVE_GOOGLE_MEETING_STATUSES)
        .gt('scheduled_at', now)
        .limit(1);
      if (active.error) throw new Error(active.error.message);
      if ((active.data || []).length > 0) {
        // Grava a linha travada em vez de sumir com ela: assim o passo do lembrete escala
        // "sem link do Google, mande na mao" 15 min antes, e o humano fica sabendo.
        await insertMeetingEventRow({
          admin: input.admin,
          input,
          ownerId,
          now,
          contactName,
          inviteeEmail,
          calendarId: connection.googleCalendarId,
          status: 'blocked',
          lastError: 'Limite anti-abuso: ja existe um evento ativo no Google para este contato.',
          nextRetryAt: null,
        });
        return { enqueued: false, reason: 'contact_limit' };
      }
    }

    await insertMeetingEventRow({
      admin: input.admin,
      input,
      ownerId,
      now,
      contactName,
      inviteeEmail,
      calendarId: connection.googleCalendarId,
      status: 'pending',
      lastError: null,
      nextRetryAt: now,
    });
    return { enqueued: true, status: 'pending' };
  } catch (error) {
    console.warn('[GoogleCalendar] Failed to enqueue meeting event', {
      organizationId: input.organizationId,
      activityId: input.activityId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { enqueued: false, reason: 'error' };
  }
}

async function readContactInviteeEmail(input: {
  admin: AdminClient;
  organizationId: string;
  contactId: string | null;
}): Promise<string | null> {
  if (!input.contactId) return null;
  const contact = await input.admin
    .from('contacts')
    .select('email')
    .eq('id', input.contactId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (contact.error) return null;
  // Mesma normalizacao que a Aurora ja aplica ao e-mail do lead (sintaxe, minusculas, tamanho).
  return normalizeLeadEmail((contact.data as { email?: unknown } | null)?.email);
}

async function insertMeetingEventRow(input: {
  admin: AdminClient;
  input: {
    organizationId: string;
    threadId: string;
    activityId: string;
    channelConnectionId: string | null;
    contactId: string | null;
    scheduledAt: string;
    timezone: string;
  };
  ownerId: string;
  now: string;
  contactName: string | null;
  inviteeEmail: string | null;
  calendarId: string;
  status: GoogleMeetingEventStatus;
  lastError: string | null;
  nextRetryAt: string | null;
}): Promise<void> {
  const inserted = await input.admin
    .from(GOOGLE_MEETING_EVENT_TABLE)
    .insert({
      activity_id: input.input.activityId,
      organization_id: input.input.organizationId,
      thread_id: input.input.threadId,
      channel_connection_id: input.input.channelConnectionId,
      owner_id: input.ownerId,
      contact_id: input.input.contactId,
      contact_name: input.contactName,
      invitee_email: input.inviteeEmail,
      scheduled_at: input.input.scheduledAt,
      timezone: input.input.timezone,
      google_calendar_id: input.calendarId,
      status: input.status,
      attempts: 0,
      last_error: input.lastError,
      next_retry_at: input.nextRetryAt,
      created_at: input.now,
      updated_at: input.now,
    });
  if (inserted.error) throw new Error(inserted.error.message);
}

/**
 * Cancelamento no CRM (acao `cancel_meeting`): o evento vai para `cancel_pending` e o tick faz
 * `events.delete`. O lembrete pendente e suprimido na hora, para nao sair link de reuniao que
 * nao existe mais enquanto o tick nao roda. Nunca lança.
 */
export async function markGoogleCalendarMeetingCancelPending(input: {
  admin: AdminClient;
  organizationId: string;
  activityId: string;
  now?: string;
}): Promise<boolean> {
  const now = input.now ?? new Date().toISOString();
  try {
    const existing = await input.admin
      .from(GOOGLE_MEETING_EVENT_TABLE)
      .select('activity_id, status, google_event_id')
      .eq('activity_id', input.activityId)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) return false;

    const current = existing.data as { status: GoogleMeetingEventStatus; google_event_id: string | null };
    if (current.status === 'cancelled') return false;

    // Sem evento no Google ainda (pending que nunca saiu): nao ha o que apagar la, so fecha aqui.
    const nextStatus: GoogleMeetingEventStatus = current.google_event_id ? 'cancel_pending' : 'cancelled';
    const updated = await input.admin
      .from(GOOGLE_MEETING_EVENT_TABLE)
      .update({
        status: nextStatus,
        attempts: 0,
        last_error: null,
        next_retry_at: nextStatus === 'cancel_pending' ? now : null,
        // Suprime o lembrete desta reuniao (os dois carimbos fecham a janela da Fatia 4).
        reminder_sent_at: now,
        reminder_escalated_at: now,
        updated_at: now,
      })
      .eq('activity_id', input.activityId)
      .eq('organization_id', input.organizationId);
    if (updated.error) throw new Error(updated.error.message);
    return true;
  } catch (error) {
    console.warn('[GoogleCalendar] Failed to mark meeting event as cancelled', {
      organizationId: input.organizationId,
      activityId: input.activityId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
