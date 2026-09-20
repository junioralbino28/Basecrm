import { getConversationAssigneeDisplayName } from '@/lib/conversations/server';

/**
 * Contexto que entra no prompt da IA de atendimento alem do historico: a data local com dia da
 * semana (para "amanha" e "terca" fazerem sentido no fuso da agenda) e quem conduz as reunioes.
 */
export const DEFAULT_MEETING_HOST_NAME = 'a equipe comercial';

const HOST_NAME_PATTERN = /^[\p{L}\p{N} .'-]{1,80}$/u;

/** "terca-feira, 22/09/2026 10:05 (America/Sao_Paulo)". Fuso invalido cai no ISO UTC. */
export function formatLocalDateTimeForPrompt(isoUtc: string, timezone: string) {
  const date = new Date(isoUtc);
  if (!Number.isFinite(date.getTime())) return isoUtc;
  try {
    const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, weekday: 'long' }).format(date);
    const dateText = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
    const timeText = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    return `${weekday}, ${dateText} ${timeText} (${timezone})`;
  } catch {
    return isoUtc;
  }
}

/** Nome configurado no numero (`config.meetingHostName`), ja validado; vazio quando nao ha. */
export function readConfiguredMeetingHostName(config: Record<string, unknown> | null | undefined) {
  const raw = typeof config?.meetingHostName === 'string' ? config.meetingHostName.trim() : '';
  return HOST_NAME_PATTERN.test(raw) ? raw : '';
}

/**
 * Quem conduz a reuniao, na ordem: nome configurado no numero > nome do responsavel da agenda >
 * padrao neutro. Perfil so com e-mail cai no padrao: o login nao pode aparecer no prompt.
 */
export function pickMeetingHostName(input: {
  connectionConfig: Record<string, unknown> | null | undefined;
  ownerProfile: {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    nickname?: string | null;
  } | null | undefined;
}) {
  const configured = readConfiguredMeetingHostName(input.connectionConfig);
  if (configured) return configured;

  const profile = input.ownerProfile;
  if (!profile) return DEFAULT_MEETING_HOST_NAME;
  const hasName = Boolean(profile.nickname?.trim() || profile.first_name?.trim() || profile.last_name?.trim());
  if (!hasName) return DEFAULT_MEETING_HOST_NAME;
  return getConversationAssigneeDisplayName(profile);
}
