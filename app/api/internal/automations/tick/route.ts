import { createStaticAdminClient } from '@/lib/supabase/server';
import { authorizeAutomationInternalRequest } from '@/lib/automations/internalAuth';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request: Request) {
  if (!authorizeAutomationInternalRequest(request, process.env.AUTOMATION_TICK_SECRET)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const admin = createStaticAdminClient();
  const expired = await admin.rpc('expire_due_automation_waits', {
    p_batch_limit: 50,
  });
  if (expired.error) {
    return json({ error: 'Falha ao reconciliar esperas.' }, 500);
  }
  const materialized = await admin.rpc('materialize_automation_jobs', {
    p_batch_limit: 50,
  });
  if (materialized.error) {
    return json({ error: 'Falha ao reconciliar automações.' }, 500);
  }

  return json({
    ok: true,
    expired: expired.data?.length ?? 0,
    materialized: materialized.data?.length ?? 0,
  });
}
