// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createStaticAdminClient: vi.fn(),
  sendNudges: vi.fn(),
}));

vi.mock('@/lib/automations/internalAuth', () => ({
  authorizeAutomationInternalRequest: mocks.authorize,
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: mocks.createStaticAdminClient,
}));
// A cutucada de inatividade da IA roda no relogio do tick; aqui so importa a ordem e a blindagem.
vi.mock('@/lib/conversations/idleNudgeRunner', () => ({
  sendDueConversationNudges: mocks.sendNudges,
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
    mocks.sendNudges.mockReset();
    mocks.sendNudges.mockResolvedValue({
      due: 0, sent: 0, skipped: { disabled: 0, replied: 0, state: 0, claimed: 0, ignored: 0 }, failed: 0, errors: [], truncated: false,
    });
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
      idleNudges: { due: 0, sent: 0, failed: 0 },
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
    // a cutucada roda depois das conversoes e antes de fechar o tick
    expect(mocks.sendNudges).toHaveBeenCalledWith({ admin: expect.anything(), batchLimit: 10, deadlineMs: 8_000 });
    const nudgeOrder = mocks.sendNudges.mock.invocationCallOrder[0];
    const rpcNames = rpc.mock.calls.map(([name]) => name);
    expect(nudgeOrder).toBeGreaterThan(rpc.mock.invocationCallOrder[rpcNames.indexOf('claim_conversion_events')]);
    expect(nudgeOrder).toBeLessThan(rpc.mock.invocationCallOrder[rpcNames.indexOf('complete_automation_tick')]);
  });

  it('cutucada que estoura nao derruba o tick: o erro vai na resposta e o tick fecha', async () => {
    mocks.sendNudges.mockRejectedValue(new Error('cutucada quebrou'));
    const rpc = buildRpc();
    mocks.authorize.mockReturnValue(true);
    mocks.createStaticAdminClient.mockReturnValue({ rpc });
    const attemptToken = '10000000-0000-4000-8000-000000000003';

    const response = await POST(new Request('http://localhost/api/internal/automations/tick', {
      method: 'POST',
      headers: { authorization: 'Bearer local' },
      body: JSON.stringify({ tick_attempt_id: attemptToken }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, idleNudges: { error: 'cutucada quebrou' } });
    expect(rpc.mock.calls.map(([name]) => name).at(-1)).toBe('complete_automation_tick');
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
