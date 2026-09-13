/**
 * POST /api/internal/automations/execute — roda o executor de jobs sob demanda (2a).
 *
 * É a porta para um cron externo ou para o worker da VPS (ADR-MOTOR) puxar os jobs com mais
 * frequência do que o tick de 5 min, sem receber service_role: o servidor executa tudo.
 *
 * SEGURANÇA: só com o Bearer do worker (AUTOMATION_WORKER_SECRET), mesma chave das rotas
 * `jobs/claim` e `jobs/:id/complete`. Nada de tenant no corpo: o tenant vem de cada job.
 * A chave de ambiente AUTOMATION_LIVE_SENDS_ENABLED continua mandando: desligada, a rota
 * responde com o motivo e não reserva nada.
 */
import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { authorizeAutomationInternalRequest } from '@/lib/automations/internalAuth';
import { executeDueAutomationJobs } from '@/lib/automations/executor';

export const maxDuration = 60;

const ExecuteSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  batchLimit: z.number().int().min(1).max(50).optional(),
  leaseSeconds: z.number().int().min(5).max(900).optional(),
  deadlineMs: z.number().int().min(1_000).max(50_000).optional(),
}).strict();

export async function POST(request: Request) {
  if (!authorizeAutomationInternalRequest(request, process.env.AUTOMATION_WORKER_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = ExecuteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'Payload inválido.', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createStaticAdminClient();
  try {
    const summary = await executeDueAutomationJobs({
      admin,
      workerId: parsed.data.workerId,
      batchLimit: parsed.data.batchLimit,
      leaseSeconds: parsed.data.leaseSeconds,
      deadlineMs: parsed.data.deadlineMs,
    });
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[automations/execute] Executor falhou', { workerId: parsed.data.workerId, error: message });
    return Response.json({ error: 'Falha ao executar jobs.' }, { status: 500 });
  }
}
