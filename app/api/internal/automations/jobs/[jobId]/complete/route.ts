import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { authorizeAutomationInternalRequest } from '@/lib/automations/internalAuth';

const CompletionSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  attemptCount: z.number().int().positive(),
  outcome: z.enum(['sent', 'simulated', 'retryable_failure', 'failed', 'unknown']),
  error: z.string().max(2_000).nullable().optional(),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!authorizeAutomationInternalRequest(request, process.env.AUTOMATION_WORKER_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = CompletionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'Payload inválido.', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { jobId } = await context.params;
  if (!z.string().uuid().safeParse(jobId).success) {
    return Response.json({ error: 'Job inválido.' }, { status: 400 });
  }

  const admin = createStaticAdminClient();
  const completed = await admin.rpc('complete_automation_job', {
    p_job_id: jobId,
    p_worker_id: parsed.data.workerId,
    p_attempt_count: parsed.data.attemptCount,
    p_outcome: parsed.data.outcome,
    p_error: parsed.data.error ?? null,
  });
  if (completed.error) {
    const status = completed.error.code === '55000' ? 409 : 500;
    return Response.json({ error: 'Job não pôde ser concluído.' }, { status });
  }

  return Response.json({ job: completed.data });
}
