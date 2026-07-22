// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('endpoint interno do tick', () => {
  beforeEach(() => {
    mocks.authorize.mockReset();
    mocks.createStaticAdminClient.mockReset();
  });

  it('marca recebimento e conclusão com a quantidade materializada', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'process_due_automation_routing') {
        return { data: [{ routing_event_id: 'route-1' }], error: null };
      }
      if (name === 'expire_due_automation_waits') return { data: [{ id: 'wait-1' }], error: null };
      if (name === 'materialize_automation_jobs') {
        return { data: [{ id: 'job-1' }, { id: 'job-2' }], error: null };
      }
      return { data: true, error: null };
    });
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
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'mark_automation_tick_received',
      'process_due_automation_routing',
      'expire_due_automation_waits',
      'materialize_automation_jobs',
      'complete_automation_tick',
    ]);
    expect(rpc).toHaveBeenLastCalledWith('complete_automation_tick', {
      p_attempt_token: attemptToken,
      p_http_status: 200,
      p_materialized_count: 2,
      p_error: null,
    });
  });
});
