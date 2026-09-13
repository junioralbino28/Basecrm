/**
 * Executor dos jobs de automação (2a) — o pedaço do motor que FAZ o efeito de cada passo:
 * manda a mensagem real pela Evolution, avança o atraso vencido, abre a espera, cria a
 * tarefa, move o negócio de etapa/funil.
 *
 * Roda dentro do tick (lote pequeno + orçamento de tempo) e pela rota interna
 * `/api/internal/automations/execute`. É o mesmo módulo que vira o worker da VPS do
 * ADR-MOTOR quando ele existir: só muda quem chama.
 *
 * SEGURANÇA
 * - Recebe o cliente service_role de um chamador já autenticado (tick por Bearer, rota interna
 *   por Bearer). Nunca lê organization_id de fora: o tenant vem do job persistido.
 * - Credencial da Evolution é resolvida aqui e não sai daqui (não vai para log nem resposta).
 * - Envio real exige três chaves: a variável de ambiente deste processo, a chave do cliente
 *   (`automation_live_enabled`, guardada pelo gate de saúde do tick) e a versão publicada em
 *   modo "live". As duas últimas são conferidas no banco por `prepare_automation_outbound`.
 * - Nunca retenta um envio: a biblioteca não distingue "não saiu" de "saiu e a resposta se
 *   perdeu". `unknown` pausa a conversa para um humano decidir.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EvolutionDeliveryUnknownError,
  isEvolutionDeliveryUnknown,
  sendEvolutionTextMessage,
  type EvolutionSendMessageResult,
  type EvolutionSendMode,
} from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { dispatchAutomationSimulation } from '@/lib/conversations/dispatchConversationOutbound';
import { toWhatsAppPhone } from '@/lib/phone';

export const AUTOMATION_EXECUTOR_ENV = 'AUTOMATION_LIVE_SENDS_ENABLED';
export const AUTOMATION_SEND_TIMEOUT_MS = 15_000;
export const AUTOMATION_EXECUTOR_DEFAULT_BATCH = 10;
export const AUTOMATION_EXECUTOR_DEFAULT_LEASE_SECONDS = 120;
export const AUTOMATION_EXECUTOR_DEFAULT_DEADLINE_MS = 35_000;

export function isAutomationExecutorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[AUTOMATION_EXECUTOR_ENV] ?? '').trim().toLowerCase() === 'true';
}

export type SendTextFn = (params: {
  apiUrl: string;
  instanceName: string;
  apiKey: string;
  phone: string;
  text: string;
  sendMode?: EvolutionSendMode;
}) => Promise<EvolutionSendMessageResult>;

export type ExecutorOutcome =
  | 'sent'
  | 'simulated'
  | 'delayed'
  | 'waiting'
  | 'tasks'
  | 'moved'
  | 'failed'
  | 'unknown'
  | 'released';

export type ExecutorSummary = {
  enabled: boolean;
  skippedReason: string | null;
  deferred: number;
  claimed: number;
  sent: number;
  simulated: number;
  delayed: number;
  waiting: number;
  tasks: number;
  moved: number;
  failed: number;
  unknown: number;
  released: number;
  errors: Array<{ jobId: string; error: string }>;
  durationMs: number;
};

type ClaimedJob = {
  id: string;
  organization_id: string;
  enrollment_id: string;
  version_id: string;
  step_key: string;
  job_type: string;
  payload: Record<string, unknown> | null;
  lease_owner: string;
  attempt_count: number;
};

type EnrollmentRow = {
  status: string;
  thread_id: string | null;
  channel_connection_id: string | null;
  contact_id: string;
  automation_version_id: string;
};

type ExecutorContext = {
  admin: SupabaseClient;
  workerId: string;
  sendText: SendTextFn;
  sendTimeoutMs: number;
  versionModes: Map<string, string | null>;
};

export type ExecuteDueAutomationJobsParams = {
  admin: SupabaseClient;
  workerId: string;
  batchLimit?: number;
  leaseSeconds?: number;
  deadlineMs?: number;
  /** Padrão: lê AUTOMATION_LIVE_SENDS_ENABLED. Testes passam explicitamente. */
  enabled?: boolean;
  /** Padrão: envio real pela Evolution. Testes podem injetar. */
  sendText?: SendTextFn;
  sendTimeoutMs?: number;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

class RpcError extends Error {
  constructor(readonly rpc: string, readonly code: string | null, message: string) {
    super(`${rpc}: ${message}`);
    this.name = 'RpcError';
  }
}

async function rpc<T = unknown>(
  admin: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await admin.rpc(name, args);
  if (result.error) {
    throw new RpcError(name, errorCode(result.error), errorMessage(result.error));
  }
  return result.data as T;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new EvolutionDeliveryUnknownError(`sem resposta da Evolution em ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function readDeliveryMode(ctx: ExecutorContext, job: ClaimedJob): Promise<string | null> {
  if (ctx.versionModes.has(job.version_id)) return ctx.versionModes.get(job.version_id) ?? null;
  const version = await ctx.admin
    .from('automation_versions')
    .select('definition')
    .eq('id', job.version_id)
    .eq('organization_id', job.organization_id)
    .maybeSingle();
  if (version.error) throw new Error(`versão da automação: ${version.error.message}`);
  const definition = (version.data?.definition ?? null) as { deliveryMode?: unknown } | null;
  const mode = typeof definition?.deliveryMode === 'string' ? definition.deliveryMode : null;
  ctx.versionModes.set(job.version_id, mode);
  return mode;
}

async function failAndPause(
  ctx: ExecutorContext,
  job: ClaimedJob,
  reason: string,
  error: string,
): Promise<ExecutorOutcome> {
  await rpc(ctx.admin, 'fail_automation_job_and_pause', {
    p_job_id: job.id,
    p_lease_owner: job.lease_owner,
    p_attempt_count: job.attempt_count,
    p_reason: reason,
    p_error: error,
  });
  return 'failed';
}

async function completeLive(
  ctx: ExecutorContext,
  job: ClaimedJob,
  messageId: string,
  status: 'sent' | 'failed' | 'unknown',
  details: { providerMessageId?: string | null; attemptLabel?: string | null; error?: string | null },
): Promise<ExecutorOutcome> {
  await rpc(ctx.admin, 'complete_automation_live', {
    p_job_id: job.id,
    p_message_id: messageId,
    p_lease_owner: job.lease_owner,
    p_attempt_count: job.attempt_count,
    p_delivery_status: status,
    p_provider_message_id: details.providerMessageId ?? null,
    p_attempt_label: details.attemptLabel ?? null,
    p_error: details.error ?? null,
  });
  return status;
}

/**
 * Mensagem real: prepara (linha pending na conversa) → resolve canal/credencial/telefone →
 * envia com tempo limite → grava o resultado. Cada saída é terminal para esta tentativa.
 */
async function executeLiveSend(
  ctx: ExecutorContext,
  job: ClaimedJob,
  enrollment: EnrollmentRow,
): Promise<ExecutorOutcome> {
  const prepared = await ctx.admin
    .rpc('prepare_automation_outbound', { p_job_id: job.id })
    .single();
  if (prepared.error) {
    const code = errorCode(prepared.error);
    const message = errorMessage(prepared.error);
    if (code === '42501') {
      // O banco recusou o envio real: live desligado, opt-out ou modo sem executor.
      const reason = /opt|não receber/i.test(message)
        ? 'opt_out'
        : /desligad/i.test(message)
          ? 'live_desligado'
          : 'modo_sem_executor';
      return failAndPause(ctx, job, reason, message);
    }
    throw new RpcError('prepare_automation_outbound', code, message);
  }
  const row = prepared.data as {
    job_id: string;
    message_id: string;
    is_new: boolean;
    delivery_status: string;
    provider_message_id: string | null;
  };

  if (!row.is_new) {
    // Já existia mensagem para este job: uma tentativa anterior não fechou (lease expirou no
    // meio do envio). Não dá para saber se saiu → nunca reenviar.
    if (row.delivery_status === 'pending') {
      return completeLive(ctx, job, row.message_id, 'unknown', {
        error: 'tentativa anterior não concluiu; revisão obrigatória',
      });
    }
    await rpc(ctx.admin, 'complete_automation_job', {
      p_job_id: job.id,
      p_worker_id: job.lease_owner,
      p_attempt_count: job.attempt_count,
      p_outcome: 'unknown',
      p_error: `mensagem do job já estava ${row.delivery_status}`,
    });
    return 'unknown';
  }

  const [connection, thread] = await Promise.all([
    ctx.admin
      .from('channel_connections')
      .select('id, organization_id, config')
      .eq('id', enrollment.channel_connection_id ?? '')
      .eq('organization_id', job.organization_id)
      .maybeSingle(),
    ctx.admin
      .from('conversation_threads')
      .select('contact_phone')
      .eq('id', enrollment.thread_id ?? '')
      .eq('organization_id', job.organization_id)
      .maybeSingle(),
  ]);
  if (connection.error) throw new Error(`canal: ${connection.error.message}`);
  if (thread.error) throw new Error(`conversa: ${thread.error.message}`);

  const config = (connection.data?.config ?? {}) as Record<string, unknown>;
  const instanceName = String(config.instanceName ?? '').trim();
  const credentials = connection.data
    ? await resolveEvolutionCredentials({
        admin: ctx.admin,
        tenantId: job.organization_id,
        connectionConfig: config,
      })
    : null;
  if (!connection.data || !instanceName || !credentials?.apiUrl || !credentials.apiKey) {
    return completeLive(ctx, job, row.message_id, 'failed', {
      error: 'conexão WhatsApp sem instância ou credencial Evolution configurada',
    });
  }
  const phone = toWhatsAppPhone(thread.data?.contact_phone ?? null);
  if (!phone) {
    return completeLive(ctx, job, row.message_id, 'failed', {
      error: 'conversa sem telefone válido para envio',
    });
  }
  const content = String(job.payload?.content ?? '').trim();
  if (!content) {
    return completeLive(ctx, job, row.message_id, 'failed', {
      error: 'mensagem da automação vazia',
    });
  }
  const sendMode = (typeof config.sendMode === 'string' ? config.sendMode : 'auto') as EvolutionSendMode;

  let result: EvolutionSendMessageResult;
  try {
    result = await withTimeout(
      ctx.sendText({
        apiUrl: credentials.apiUrl,
        instanceName,
        apiKey: credentials.apiKey,
        phone,
        text: content,
        sendMode,
      }),
      ctx.sendTimeoutMs,
    );
  } catch (error) {
    const status = isEvolutionDeliveryUnknown(error) ? 'unknown' : 'failed';
    return completeLive(ctx, job, row.message_id, status, {
      error: errorMessage(error).slice(0, 2000),
    });
  }

  return completeLive(ctx, job, row.message_id, 'sent', {
    providerMessageId: result.providerMessageId,
    attemptLabel: result.attemptLabel,
  });
}

async function executeJob(ctx: ExecutorContext, job: ClaimedJob): Promise<ExecutorOutcome> {
  const enrollmentResult = await ctx.admin
    .from('automation_enrollments')
    .select('status, thread_id, channel_connection_id, contact_id, automation_version_id')
    .eq('id', job.enrollment_id)
    .eq('organization_id', job.organization_id)
    .maybeSingle();
  if (enrollmentResult.error) throw new Error(`inscrição: ${enrollmentResult.error.message}`);
  const enrollment = enrollmentResult.data as EnrollmentRow | null;
  if (!enrollment) throw new Error('inscrição do job não encontrada');

  if (enrollment.status !== 'active') {
    // Pausada, concluída ou cancelada depois de o job nascer: o job morre com o motivo e a
    // inscrição fica como está (a pausa já é o pedido de um humano olhar).
    return failAndPause(
      ctx,
      job,
      `inscricao_${enrollment.status}`,
      `inscrição está ${enrollment.status}; job descartado`,
    );
  }

  const lease = {
    p_job_id: job.id,
    p_lease_owner: job.lease_owner,
    p_attempt_count: job.attempt_count,
  };
  const mode = await readDeliveryMode(ctx, job);
  const completeAs = async (outcome: 'sent' | 'simulated') => {
    await rpc(ctx.admin, 'complete_automation_job', {
      p_job_id: job.id,
      p_worker_id: job.lease_owner,
      p_attempt_count: job.attempt_count,
      p_outcome: outcome,
      p_error: null,
    });
  };

  switch (job.job_type) {
    case 'delay':
      // Reservado só depois de `available_at`: o atraso já venceu. Avança.
      await completeAs('sent');
      return 'delayed';
    case 'wait_for_event':
      // A espera é só estado do motor (sem efeito fora), vale em qualquer modo.
      await rpc(ctx.admin, 'open_automation_wait_for_job', lease);
      return 'waiting';
    case 'create_task':
      // Fora do modo live o passo é marcado como simulado e avança: o teste do construtor roda
      // sobre negócio real e não pode criar tarefa nem mover etapa de verdade.
      if (mode !== 'live') {
        await completeAs('simulated');
        return 'simulated';
      }
      await rpc(ctx.admin, 'execute_automation_create_task', lease);
      return 'tasks';
    case 'move_stage':
    case 'move_pipeline':
      if (mode !== 'live') {
        await completeAs('simulated');
        return 'simulated';
      }
      await rpc(ctx.admin, 'execute_automation_move_deal', lease);
      return 'moved';
    case 'send_message': {
      if (mode === 'simulation') {
        await dispatchAutomationSimulation({
          db: ctx.admin,
          jobId: job.id,
          leaseOwner: job.lease_owner,
          attemptCount: job.attempt_count,
        });
        return 'simulated';
      }
      if (mode === 'live') return executeLiveSend(ctx, job, enrollment);
      return failAndPause(ctx, job, 'modo_sem_executor', `modo de entrega sem executor: ${mode ?? 'nulo'}`);
    }
    default:
      return failAndPause(ctx, job, 'passo_sem_executor', `passo sem executor: ${job.job_type}`);
  }
}

/**
 * Erros de RPC com significado conhecido viram desfecho do job; o resto sobe para o resumo
 * (o lease expira e o próximo claim marca a tentativa como falha por `lease_expired`).
 */
async function executeJobSafely(ctx: ExecutorContext, job: ClaimedJob): Promise<ExecutorOutcome> {
  try {
    return await executeJob(ctx, job);
  } catch (error) {
    if (error instanceof RpcError && error.rpc !== 'fail_automation_job_and_pause') {
      if (error.code === '22023') {
        return failAndPause(ctx, job, 'configuracao_invalida', error.message);
      }
      if (error.code === '23505') {
        return failAndPause(ctx, job, 'espera_em_conflito', error.message);
      }
    }
    throw error;
  }
}

export async function executeDueAutomationJobs(
  params: ExecuteDueAutomationJobsParams,
): Promise<ExecutorSummary> {
  const started = Date.now();
  const enabled = params.enabled ?? isAutomationExecutorEnabled();
  const summary: ExecutorSummary = {
    enabled,
    skippedReason: null,
    deferred: 0,
    claimed: 0,
    sent: 0,
    simulated: 0,
    delayed: 0,
    waiting: 0,
    tasks: 0,
    moved: 0,
    failed: 0,
    unknown: 0,
    released: 0,
    errors: [],
    durationMs: 0,
  };
  const finish = () => {
    summary.durationMs = Date.now() - started;
    return summary;
  };

  if (!enabled) {
    summary.skippedReason = `${AUTOMATION_EXECUTOR_ENV} desligado; jobs aguardam`;
    return finish();
  }

  const batchLimit = Math.min(50, Math.max(1, params.batchLimit ?? AUTOMATION_EXECUTOR_DEFAULT_BATCH));
  const leaseSeconds = Math.min(900, Math.max(5, params.leaseSeconds ?? AUTOMATION_EXECUTOR_DEFAULT_LEASE_SECONDS));
  const deadlineMs = Math.max(1_000, params.deadlineMs ?? AUTOMATION_EXECUTOR_DEFAULT_DEADLINE_MS);
  const ctx: ExecutorContext = {
    admin: params.admin,
    workerId: params.workerId,
    sendText: params.sendText ?? sendEvolutionTextMessage,
    sendTimeoutMs: params.sendTimeoutMs ?? AUTOMATION_SEND_TIMEOUT_MS,
    versionModes: new Map(),
  };

  // 2c: silêncio noturno e live desligado adiam o envio ANTES da reserva.
  const deferred = await params.admin.rpc('defer_automation_jobs_before_claim', { p_batch_limit: 200 });
  if (deferred.error) {
    summary.errors.push({ jobId: '-', error: `defer: ${errorMessage(deferred.error)}` });
  } else {
    summary.deferred = Array.isArray(deferred.data) ? deferred.data.length : 0;
  }

  for (let round = 0; round < 20; round += 1) {
    if (Date.now() - started >= deadlineMs) break;
    const claimed = await params.admin.rpc('claim_automation_jobs', {
      p_worker_id: params.workerId,
      p_batch_limit: batchLimit,
      p_lease_seconds: leaseSeconds,
      p_job_id: null,
    });
    if (claimed.error) {
      summary.errors.push({ jobId: '-', error: `claim: ${errorMessage(claimed.error)}` });
      break;
    }
    const jobs = (Array.isArray(claimed.data) ? claimed.data : []) as ClaimedJob[];
    if (jobs.length === 0) break;
    summary.claimed += jobs.length;

    for (const job of jobs) {
      if (Date.now() - started >= deadlineMs) {
        // Sem tempo: o lease expira sozinho e o próximo executor pega o job.
        summary.released += 1;
        continue;
      }
      try {
        const outcome = await executeJobSafely(ctx, job);
        summary[outcome] += 1;
      } catch (error) {
        summary.errors.push({ jobId: job.id, error: errorMessage(error).slice(0, 500) });
      }
    }
    if (jobs.length < batchLimit) break;
  }

  return finish();
}
