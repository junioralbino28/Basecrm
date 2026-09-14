import { createStaticAdminClient } from '@/lib/supabase/server';
import { authorizeAutomationInternalRequest } from '@/lib/automations/internalAuth';
import { executeDueAutomationJobs, type ExecutorSummary } from '@/lib/automations/executor';
import { dispatchPendingConversionEvents, type DispatchSummary } from '@/lib/meta/conversionDispatch';
import { z } from 'zod';

// 2a: o tick passou a executar jobs (envio real com tempo limite por mensagem). O executor
// tem orçamento próprio de 35 s; o resto cabe na margem.
export const maxDuration = 60;

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request: Request) {
  if (!authorizeAutomationInternalRequest(request, process.env.AUTOMATION_TICK_SECRET)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const payload = z.object({
    tick_attempt_id: z.string().uuid(),
  }).safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return json({ error: 'Identidade do tick inválida.' }, 400);
  }
  const tickAttemptId = payload.data.tick_attempt_id;

  const admin = createStaticAdminClient();
  const received = await admin.rpc('mark_automation_tick_received', {
    p_attempt_token: tickAttemptId,
  });
  if (received.error || received.data !== true) {
    return json({ error: 'Tick obsoleto ou não reconhecido.' }, 409);
  }

  async function markFailure(error: string) {
    await admin.rpc('complete_automation_tick', {
      p_attempt_token: tickAttemptId,
      p_http_status: 500,
      p_materialized_count: 0,
      p_error: error,
    });
  }

  const routed = await admin.rpc('process_due_automation_routing', {
    p_batch_limit: 50,
  });
  if (routed.error) {
    await markFailure('Falha ao rotear conversas esfriadas.');
    return json({ error: 'Falha ao rotear conversas esfriadas.' }, 500);
  }
  const expired = await admin.rpc('expire_due_automation_waits', {
    p_batch_limit: 50,
  });
  if (expired.error) {
    await markFailure('Falha ao reconciliar esperas.');
    return json({ error: 'Falha ao reconciliar esperas.' }, 500);
  }
  const materialized = await admin.rpc('materialize_automation_jobs', {
    p_batch_limit: 50,
  });
  if (materialized.error) {
    await markFailure('Falha ao reconciliar automações.');
    return json({ error: 'Falha ao reconciliar automações.' }, 500);
  }
  const materializedCount = materialized.data?.length ?? 0;

  // 2a: executa os jobs vencidos (mensagem real, atraso, espera, tarefa, movimentação) em lote
  // pequeno com orçamento de tempo. Nunca derruba o tick: o resumo vai na resposta e o que não
  // coube fica para o próximo. Desligado por ambiente (AUTOMATION_LIVE_SENDS_ENABLED), só
  // registra o motivo.
  let executed: ExecutorSummary | { error: string } | null = null;
  try {
    // 30 s para o executor + envio com margem; sobra para a Meta e o fechamento da saúde.
    executed = await executeDueAutomationJobs({ admin, workerId: `tick:${tickAttemptId}`, deadlineMs: 30_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[tick] Executor de automações falhou', { tickAttemptId, error: message });
    executed = { error: message };
  }

  // 3c: os marcos de conversão pendentes vão para a Meta no mesmo relógio do tick
  // (a cada 5 min). Nunca derruba o tick: o despachante grava o resultado em cada
  // marco e o resumo vai na resposta.
  let conversions: DispatchSummary | { error: string } | null = null;
  try {
    conversions = await dispatchPendingConversionEvents({ admin, batchLimit: 20 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[tick] Despacho de conversões falhou', { tickAttemptId, error: message });
    conversions = { error: message };
  }

  const completed = await admin.rpc('complete_automation_tick', {
    p_attempt_token: tickAttemptId,
    p_http_status: 200,
    p_materialized_count: materializedCount,
    p_error: null,
  });
  if (completed.error || completed.data !== true) {
    return json({ error: 'Falha ao registrar conclusão do tick.' }, 500);
  }

  return json({
    ok: true,
    routed: routed.data?.length ?? 0,
    expired: expired.data?.length ?? 0,
    materialized: materializedCount,
    executed,
    conversions,
  });
}
