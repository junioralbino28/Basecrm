import { z } from 'zod';

import { zonedParts, zonedWallTimeToUtc } from './meetingAvailability';

/**
 * Cutucada de inatividade da IA de atendimento.
 *
 * Decisao do Junior (20/09/2026): a cutucada vale muito a pena, mas depois de ~15 minutos sem
 * resposta do lead, nao 90 segundos, e fora do modulo de follow-up. Como 15 minutos nao cabem numa
 * espera dentro do pedido do webhook (a funcao serverless morre antes), o webhook so AGENDA
 * (`aiInactivityNudgeDueAt` na metadata da conversa) e quem envia e o relogio do tick (a cada
 * 5 min), pelo `sendDueConversationNudges` em `idleNudgeRunner.ts`. O tick e so o relogio: a
 * cutucada continua sendo da conversa e do numero, nao do funil.
 *
 * A configuracao mora em `channel_connections.config.aiIdleNudge` e e por numero: cada agente
 * pode ter prazo e texto proprios, ou desligar.
 */
export const DEFAULT_IDLE_NUDGE_DELAY_MINUTES = 15;
export const DEFAULT_IDLE_NUDGE_TEXT = 'Ainda estou por aqui. Quando quiser, seguimos de onde paramos.';
export const IDLE_NUDGE_AUTOMATION_SOURCE = 'native_crm_idle_nudge';

/**
 * Quando o lead ADIA ("amanha eu te chamo", "mais tarde eu vejo"), a cutucada de 15 minutos
 * atropela o que ele acabou de combinar. Caso real (Pulpitos Genesis, 23/09/2026): as 22h08 o
 * lead adiou e as 22h25 a cutucada saiu com o texto padrao. Nesse caso o vencimento vai para a
 * hora de retomada do dia seguinte, no fuso do numero, e o texto e outro.
 *
 * Isso fecha com a regra de atendimento 24/7 que o Junior travou em 23/09: a Aurora nao aceita o
 * adiamento de primeira (ela tenta seguir agora). Se o lead nao responde a essa tentativa, o
 * silencio E a confirmacao do adiamento — e a retomada e de manha, nao 15 minutos depois.
 */
export const DEFAULT_IDLE_NUDGE_DEFERRED_HOUR = 9;
export const DEFAULT_IDLE_NUDGE_DEFERRED_TEXT = 'Bom dia! Voltando como combinamos. Quando puder, seguimos de onde paramos.';
export const DEFAULT_IDLE_NUDGE_TIMEZONE = 'America/Sao_Paulo';

const MAX_IDLE_NUDGE_DELAY_MINUTES = 24 * 60;
const MAX_IDLE_NUDGE_TEXT_LENGTH = 600;

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export const IdleNudgeConfigSchema = z.object({
  enabled: z.boolean(),
  delayMinutes: z.number().int().min(1).max(MAX_IDLE_NUDGE_DELAY_MINUTES),
  text: z.string().trim().min(1).max(MAX_IDLE_NUDGE_TEXT_LENGTH),
  /**
   * Campos do adiamento. Entram com `.default()` de proposito: conexao ja gravada tem so os tres
   * primeiros campos e continua valida — sem isso, todo numero ja configurado cairia no caminho
   * tolerante do `resolveIdleNudgeConfig` e a tela de edicao passaria a recusar o que ela mesma
   * gravou.
   */
  deferredResumeHour: z.number().int().min(0).max(23).default(DEFAULT_IDLE_NUDGE_DEFERRED_HOUR),
  deferredText: z.string().trim().min(1).max(MAX_IDLE_NUDGE_TEXT_LENGTH).default(DEFAULT_IDLE_NUDGE_DEFERRED_TEXT),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimezone, 'Fuso horario invalido.').default(DEFAULT_IDLE_NUDGE_TIMEZONE),
}).strict();

export type IdleNudgeConfig = z.infer<typeof IdleNudgeConfigSchema>;

/**
 * Le `config.aiIdleNudge` de forma tolerante: ausente ou invalido cai no padrao (ligada, 15 min,
 * texto neutro), campo a campo. `enabled: false` sempre e respeitado, mesmo com o resto invalido.
 */
export function resolveIdleNudgeConfig(config: Record<string, unknown> | null | undefined): IdleNudgeConfig {
  const raw = config?.aiIdleNudge;
  const parsed = IdleNudgeConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const delay = typeof source.delayMinutes === 'number'
    && Number.isInteger(source.delayMinutes)
    && source.delayMinutes >= 1
    && source.delayMinutes <= MAX_IDLE_NUDGE_DELAY_MINUTES
    ? source.delayMinutes
    : DEFAULT_IDLE_NUDGE_DELAY_MINUTES;
  const text = typeof source.text === 'string' && source.text.trim()
    ? source.text.trim().slice(0, MAX_IDLE_NUDGE_TEXT_LENGTH)
    : DEFAULT_IDLE_NUDGE_TEXT;
  const deferredResumeHour = typeof source.deferredResumeHour === 'number'
    && Number.isInteger(source.deferredResumeHour)
    && source.deferredResumeHour >= 0
    && source.deferredResumeHour <= 23
    ? source.deferredResumeHour
    : DEFAULT_IDLE_NUDGE_DEFERRED_HOUR;
  const deferredText = typeof source.deferredText === 'string' && source.deferredText.trim()
    ? source.deferredText.trim().slice(0, MAX_IDLE_NUDGE_TEXT_LENGTH)
    : DEFAULT_IDLE_NUDGE_DEFERRED_TEXT;
  const timezone = typeof source.timezone === 'string' && source.timezone.trim() && isValidTimezone(source.timezone.trim())
    ? source.timezone.trim()
    : DEFAULT_IDLE_NUDGE_TIMEZONE;

  return {
    enabled: source.enabled !== false,
    delayMinutes: delay,
    text,
    deferredResumeHour,
    deferredText,
    timezone,
  };
}

/**
 * O lead ADIOU a conversa para outro momento?
 *
 * Leitura por texto de proposito, e nao por uma chamada a mais ao modelo: o adiamento e a fala
 * mais previsivel da conversa ("amanha eu te chamo", "mais tarde eu vejo", "semana que vem"), a
 * decisao aqui so escolhe ENTRE DOIS PRAZOS de cutucada, e errar para o lado de nao detectar
 * apenas mantem o comportamento de hoje.
 *
 * Exige um verbo de adiamento junto do tempo. So a palavra do tempo nao basta: "amanha eu tenho
 * uma reuniao, hoje pode ser" NAO e adiamento, e "pode ser amanha de manha" e o lead marcando,
 * nao fugindo.
 */
export function detectLeadDeferral(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false;
  const normalized = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;

  // "pode ser amanha", "melhor amanha", "amanha as 10" — o lead esta MARCANDO, nao adiando.
  const MARCANDO = /(pode ser|melhor|prefiro|fica melhor|vamos|bora|marca|agenda|combinado para|as \d)/;
  const TEMPO = /(amanha|mais tarde|depois|outra hora|a noite|de manha|segunda|terca|quarta|quinta|sexta|sabado|domingo|semana que vem|proxima semana|outro dia|dia seguinte)/;
  const ADIANDO = /(te chamo|eu chamo|te falo|eu falo|te retorno|eu retorno|te aviso|eu aviso|te procuro|volto a falar|a gente se fala|conversamos|vemos isso|eu vejo|vou ver|deixa (?:para|pra)|fica (?:para|pra)|adiar|nao (?:da|posso|consigo) agora|agora nao (?:da|posso|consigo)|estou ocupad|to ocupad|estou trabalhando|to trabalhando|ja e tarde|esta tarde|ta tarde)/;

  if (!TEMPO.test(normalized)) {
    // "agora não dá", "estou ocupado" sem dizer quando: também é adiamento.
    return /(nao (?:da|posso|consigo) agora|agora nao (?:da|posso|consigo)|estou ocupad|to ocupad|ja e tarde|esta tarde|ta tarde)/.test(normalized);
  }
  if (MARCANDO.test(normalized) && !ADIANDO.test(normalized)) return false;
  return ADIANDO.test(normalized);
}

/**
 * Proxima ocorrencia da hora de retomada no fuso do numero, sempre DEPOIS de `fromIso`.
 * Usa o mesmo conversor de fuso da agenda da Aurora, que ja trata virada de dia e horario de
 * verao — 22h08 de terca com retomada as 9h vira 9h de quarta, nao 9h da mesma terca.
 */
export function nextResumeAt(fromIso: string, hour: number, timezone: string): string {
  const from = new Date(fromIso);

  try {
    const local = zonedParts(from, timezone);

    for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
      const day = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
      const candidate = zonedWallTimeToUtc({
        year: day.getUTCFullYear(),
        month: day.getUTCMonth() + 1,
        day: day.getUTCDate(),
        hour,
        minute: 0,
        timezone,
      });
      if (candidate !== null && candidate.getTime() > from.getTime()) return candidate.toISOString();
    }
  } catch {
    // `Intl` LANCA com fuso invalido, nao devolve nulo — sem este catch, um fuso errado gravado
    // na conexao derrubaria o webhook inteiro no meio do agendamento.
  }

  // Fuso invalido ou hora que nao existe no dia (virada de horario de verao): cai no dia seguinte
  // pelo relogio, em vez de deixar a conversa sem cutucada nenhuma.
  return new Date(from.getTime() + 24 * 60 * 60_000).toISOString();
}

/**
 * Marca na metadata da conversa quando a cutucada vence. O tick le esses campos.
 *
 * Com `deferred`, o vencimento deixa de ser "daqui a N minutos" e passa a ser a hora de retomada
 * do proximo dia no fuso do numero. `aiInactivityNudgeDeferred` fica gravado para o tick saber
 * qual texto mandar — o de retomada, nao o de silencio.
 */
export function buildIdleNudgeScheduleMetadata(input: {
  metadata: Record<string, unknown>;
  token: string;
  scheduledAt: string;
  delayMinutes: number;
  deferred?: boolean;
  deferredResumeHour?: number;
  timezone?: string;
}) {
  const deferred = input.deferred === true;
  const dueAt = deferred
    ? nextResumeAt(
        input.scheduledAt,
        input.deferredResumeHour ?? DEFAULT_IDLE_NUDGE_DEFERRED_HOUR,
        input.timezone ?? DEFAULT_IDLE_NUDGE_TIMEZONE,
      )
    : new Date(new Date(input.scheduledAt).getTime() + input.delayMinutes * 60_000).toISOString();
  return {
    ...input.metadata,
    aiInactivityNudgeToken: input.token,
    aiInactivityNudgeScheduledAt: input.scheduledAt,
    aiInactivityNudgeDueAt: dueAt,
    aiInactivityNudgeDelayMinutes: input.delayMinutes,
    aiInactivityNudgeDeferred: deferred,
  };
}

/** Limpa o agendamento; `sentAt` fica registrado quando a cutucada saiu de verdade. */
export function buildIdleNudgeClearedMetadata(input: {
  metadata: Record<string, unknown>;
  sentAt?: string | null;
}) {
  return {
    ...input.metadata,
    aiInactivityNudgeToken: null,
    aiInactivityNudgeDueAt: null,
    aiInactivityNudgeScheduledAt: null,
    aiInactivityNudgeDeferred: null,
    aiInactivityNudgeSentAt: input.sentAt ?? input.metadata.aiInactivityNudgeSentAt ?? null,
  };
}

/**
 * So agenda quando o lead ainda nao recebeu cutucada depois da ultima mensagem dele
 * (uma cutucada por silencio, nunca em cascata).
 */
export function shouldScheduleIdleNudge(metadata: Record<string, unknown>) {
  const lastInboundAt = typeof metadata.lastInboundAt === 'string' ? metadata.lastInboundAt : null;
  const lastNudgeSentAt = typeof metadata.aiInactivityNudgeSentAt === 'string' ? metadata.aiInactivityNudgeSentAt : null;
  if (!lastInboundAt) return false;
  if (!lastNudgeSentAt) return true;
  return new Date(lastInboundAt).getTime() > new Date(lastNudgeSentAt).getTime();
}
