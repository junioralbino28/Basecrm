import 'server-only';

import type { createStaticAdminClient } from '@/lib/supabase/server';
import type { BusyInterval } from '@/lib/conversations/meetingAvailability';
import { buildConversationScopedEventId } from '@/lib/conversations/handoffEventId';
import { redactChannelSecrets } from '@/lib/channels/redactChannelSecrets';
import { getGoogleCalendarConnection, markGoogleCalendarConnectionIssue } from './connectionStore';
import { getGoogleCalendarAccessToken } from './oauth';
import { GoogleApiError, queryGoogleFreeBusy } from './googleApiClient';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

const FREEBUSY_TIMEOUT_MS = 2_500;
const FREEBUSY_CACHE_TTL_MS = 60_000;
// "No maximo 1 por conexao por dia" (SPEC) — a conexao e por (organization_id, owner_id).
const FREEBUSY_WARNING_WINDOW_MS = 24 * 60 * 60_000;

// Tolerancia no fim da janela: a janela pedida anda alguns segundos a cada mensagem (ela nasce
// de `now`), e os horarios sao de 60 em 60 min; o cache cobre a janela pedida se ela terminar
// ate 10 min depois da janela consultada.
const FREEBUSY_CACHE_WINDOW_TOLERANCE_MS = 10 * 60_000;

type CacheEntry = { expiresAt: number; timeMin: number; timeMax: number; intervals: BusyInterval[] };
const freeBusyCache = new Map<string, CacheEntry>();

// Chave so por (organizacao, responsavel): com timeMin/timeMax na chave (milissegundo de `now`)
// o cache nunca acertava e cada mensagem consultava o Google (revisao de 22/09).
function cacheKey(organizationId: string, ownerId: string): string {
  return `${organizationId}:${ownerId}`;
}

function cacheCovers(entry: CacheEntry, timeMin: string, timeMax: string): boolean {
  const min = new Date(timeMin).getTime();
  const max = new Date(timeMax).getTime();
  if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
  return min >= entry.timeMin && max <= entry.timeMax + FREEBUSY_CACHE_WINDOW_TOLERANCE_MS;
}

/** Só para os testes: evita vazamento de estado entre casos. */
export function clearGoogleFreeBusyCache(): void {
  freeBusyCache.clear();
}

async function notifyGoogleFreeBusyFailure(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string;
}): Promise<void> {
  const now = new Date();
  const dayBucket = Math.floor(now.getTime() / FREEBUSY_WARNING_WINDOW_MS);
  const id = buildConversationScopedEventId({
    organizationId: input.organizationId,
    threadId: input.ownerId,
    eventId: `google-freebusy:${dayBucket}`,
  });

  const result = await input.admin.from('system_notifications').upsert({
    id,
    organization_id: input.organizationId,
    type: 'SYSTEM_ALERT',
    title: 'Google Agenda não respondeu',
    message: 'A Aurora está oferecendo horários sem conferir sua agenda do Google. Reconecte se o problema continuar.',
    link: `/platform/tenants/${input.organizationId}/channels`,
    severity: 'medium',
    read_at: null,
    created_at: now.toISOString(),
  }, { onConflict: 'id' });

  if (result.error) {
    console.warn('[GoogleCalendar] Failed to record freeBusy failure notification', {
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      error: result.error.message,
    });
  }
}

/**
 * Le o ocupado do Google para (organizationId, ownerId) na janela [timeMin, timeMax).
 *
 * Sem conexao `connected` para esse responsavel: `[]` sem nenhuma chamada de rede (decisao
 * travada — nada muda pra quem nao conecta). Qualquer falha (timeout, 401, JSON ruim, etc.):
 * `[]` + aviso idempotente no sino (no maximo 1/dia) — a oferta nunca para so por causa do
 * Google. `invalid_grant` tambem marca a conexao como `reconnect_required`. Nunca lança.
 */
export async function loadGoogleBusyIntervals(input: {
  admin: AdminClient;
  organizationId: string;
  ownerId: string | null;
  timeMin: string;
  timeMax: string;
}): Promise<BusyInterval[]> {
  if (!input.ownerId) return [];
  const ownerId = input.ownerId;

  const key = cacheKey(input.organizationId, ownerId);
  const cached = freeBusyCache.get(key);
  if (cached && cached.expiresAt > Date.now() && cacheCovers(cached, input.timeMin, input.timeMax)) {
    return cached.intervals;
  }

  let connection;
  try {
    connection = await getGoogleCalendarConnection({
      admin: input.admin,
      organizationId: input.organizationId,
      ownerId,
    });
  } catch (error) {
    console.warn('[GoogleCalendar] Failed to load connection for freeBusy', {
      organizationId: input.organizationId,
      ownerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  if (!connection || connection.status !== 'connected') return [];

  let accessToken: string | null = null;
  try {
    accessToken = await getGoogleCalendarAccessToken({
      admin: input.admin,
      organizationId: input.organizationId,
      ownerId,
    });
    if (!accessToken) return [];

    const intervals = await queryGoogleFreeBusy({
      accessToken,
      calendarId: connection.googleCalendarId,
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      timeoutMs: FREEBUSY_TIMEOUT_MS,
    });
    freeBusyCache.set(key, {
      expiresAt: Date.now() + FREEBUSY_CACHE_TTL_MS,
      timeMin: new Date(input.timeMin).getTime(),
      timeMax: new Date(input.timeMax).getTime(),
      intervals,
    });
    return intervals;
  } catch (error) {
    const isInvalidGrant = error instanceof GoogleApiError && error.code === 'invalid_grant';
    const message = redactChannelSecrets(error, [accessToken], 'Falha ao consultar o Google Agenda.');
    console.warn('[GoogleCalendar] freeBusy failed', {
      organizationId: input.organizationId,
      ownerId,
      invalidGrant: isInvalidGrant,
      error: message,
    });

    try {
      await markGoogleCalendarConnectionIssue({
        admin: input.admin,
        organizationId: input.organizationId,
        ownerId,
        status: isInvalidGrant ? 'reconnect_required' : undefined,
        lastError: message,
      });
      await notifyGoogleFreeBusyFailure({ admin: input.admin, organizationId: input.organizationId, ownerId });
    } catch (recordError) {
      console.warn('[GoogleCalendar] Failed to record freeBusy failure', {
        organizationId: input.organizationId,
        ownerId,
        error: recordError instanceof Error ? recordError.message : String(recordError),
      });
    }

    return [];
  }
}
