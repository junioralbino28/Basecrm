// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createStaticAdminClient: vi.fn(),
}));

vi.mock('@/lib/automations/internalAuth', () => ({
  authorizeAutomationInternalRequest: mocks.authorize,
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: mocks.createStaticAdminClient,
}));

import { POST } from '@/app/api/internal/automations/tick/route';

function buildRpc() {
  return vi.fn(async (name: string) => {
    if (name === 'process_due_automation_routing') {
      return { data: [{ routing_event_id: 'route-1' }], error: null };
    }
    if (name === 'expire_due_automation_waits') return { data: [{ id: 'wait-1' }], error: null };
    if (name === 'materialize_automation_jobs') {
      return { data: [{ id: 'job-1' }, { id: 'job-2' }], error: null };
    }
    // 2a: o executor adia e reserva jobs; aqui não há nenhum vencido.
    if (name === 'defer_automation_jobs_before_claim') return { data: [], error: null };
    if (name === 'claim_automation_jobs') return { data: [], error: null };
    // 3c: o tick também despacha os marcos de conversão pendentes; aqui não há nenhum.
    if (name === 'claim_conversion_events') return { data: [], error: null };
    return { data: true, error: null };
  });
}

describe('endpoint interno do tick', () => {
  const executorEnvBefore = process.env.AUTOMATION_LIVE_SENDS_ENABLED;

  beforeEach(() => {
    mocks.authorize.mockReset();
    mocks.createStaticAdminClient.mockReset();
    process.env.AUTOMATION_LIVE_SENDS_ENABLED = 'true';
  });

  afterEach(() => {
    if (executorEnvBefore === undefined) delete process.env.AUTOMATION_LIVE_SENDS_ENABLED;
    else process.env.AUTOMATION_LIVE_SENDS_ENABLED = executorEnvBefore;
  });

  it('marca recebimento e conclusão com a quantidade materializada; executa depois de materializar e antes das conversões', async () => {
    const rpc = buildRpc();
    mocks.authorize.mockReturnValue(true);
    mocks.createStaticAdminClient.mockReturnValue({ rpc });
    const attemptToken = '10000000-0000-4000-8000-000000000001';

    const response = await POST(new Request('http://localhost/api/internal/automations/tick', {
      method: 'POST',
      headers: { authorization: 'Bearer local' },
      body: JSON.stringify({ tick_attempt_id: attemptToken }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      routed: 1,
      expired: 1,
      materialized: 2,
      executed: { enabled: true, skippedReason: null, deferred: 0, claimed: 0, sent: 0, errors: [] },
      conversions: { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0 },
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'mark_automation_tick_received',
      'process_due_automation_routing',
      'expire_due_automation_waits',
      'materialize_automation_jobs',
      'defer_automation_jobs_before_claim',
      'claim_automation_jobs',
      'claim_conversion_events',
      'complete_automation_tick',
    ]);
    expect(rpc).toHaveBeenCalledWith('claim_automation_jobs', {
      p_worker_id: `tick:${attemptToken}`,
      p_batch_limit: 10,
      p_lease_seconds: 120,
      p_job_id: null,
    });
    expect(rpc).toHaveBeenLastCalledWith('complete_automation_tick', {
      p_attempt_token: attemptToken,
      p_http_status: 200,
      p_materialized_count: 2,
      p_error: null,
    });
  });

  it('com AUTOMATION_LIVE_SENDS_ENABLED desligada o executor não adia nem reserva nada, e o tick segue', async () => {
    process.env.AUTOMATION_LIVE_SENDS_ENABLED = 'false';
    const rpc = buildRpc();
    mocks.authorize.mockReturnValue(true);
    mocks.createStaticAdminClient.mockReturnValue({ rpc });
    const attemptToken = '10000000-0000-4000-8000-000000000002';

    const response = await POST(new Request('http://localhost/api/internal/automations/tick', {
      method: 'POST',
      headers: { authorization: 'Bearer local' },
      body: JSON.stringify({ tick_attempt_id: attemptToken }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      executed: { enabled: false, skippedReason: 'AUTOMATION_LIVE_SENDS_ENABLED desligado; jobs aguardam', claimed: 0 },
    });
    const nomes = rpc.mock.calls.map(([name]) => name);
    expect(nomes).not.toContain('defer_automation_jobs_before_claim');
    expect(nomes).not.toContain('claim_automation_jobs');
    expect(nomes.at(-1)).toBe('complete_automation_tick');
  });
});
