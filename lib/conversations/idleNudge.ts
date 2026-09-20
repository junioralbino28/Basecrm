import { z } from 'zod';

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

const MAX_IDLE_NUDGE_DELAY_MINUTES = 24 * 60;
const MAX_IDLE_NUDGE_TEXT_LENGTH = 600;

export const IdleNudgeConfigSchema = z.object({
  enabled: z.boolean(),
  delayMinutes: z.number().int().min(1).max(MAX_IDLE_NUDGE_DELAY_MINUTES),
  text: z.string().trim().min(1).max(MAX_IDLE_NUDGE_TEXT_LENGTH),
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

  return {
    enabled: source.enabled !== false,
    delayMinutes: delay,
    text,
  };
}

/** Marca na metadata da conversa quando a cutucada vence. O tick le esses campos. */
export function buildIdleNudgeScheduleMetadata(input: {
  metadata: Record<string, unknown>;
  token: string;
  scheduledAt: string;
  delayMinutes: number;
}) {
  const dueAt = new Date(new Date(input.scheduledAt).getTime() + input.delayMinutes * 60_000).toISOString();
  return {
    ...input.metadata,
    aiInactivityNudgeToken: input.token,
    aiInactivityNudgeScheduledAt: input.scheduledAt,
    aiInactivityNudgeDueAt: dueAt,
    aiInactivityNudgeDelayMinutes: input.delayMinutes,
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
