import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { authorizeAutomationInternalRequest } from '@/lib/automations/internalAuth';

const ClaimSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  batchLimit: z.number().int().min(1).max(50).default(10),
  leaseSeconds: z.number().int().min(5).max(900).default(60),
}).strict();

export async function POST(request: Request) {
  if (!authorizeAutomationInternalRequest(request, process.env.AUTOMATION_WORKER_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = ClaimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'Payload inválido.', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createStaticAdminClient();
  const claimed = await admin.rpc('claim_automation_jobs', {
    p_worker_id: parsed.data.workerId,
    p_batch_limit: parsed.data.batchLimit,
    p_lease_seconds: parsed.data.leaseSeconds,
    p_job_id: null,
  });
  if (claimed.error) {
    return Response.json({ error: 'Falha ao reclamar jobs.' }, { status: 500 });
  }

  return Response.json({ jobs: claimed.data ?? [] });
}
