// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import {
  createE2AdminClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';
import {
  createFunilTestFixture,
  type FunilTestFixture,
} from './helpers/funilTestFixture';

const config = loadE2SupabaseConfig();
const describeLocal = config ? describe : describe.skip;

describeLocal('C1A — saúde real do tick no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  let queueFixture: FunilTestFixture | null = null;

  afterAll(async () => {
    await queueFixture?.cleanup();
  }, 120_000);

  it('segredo ausente registra falha e contador', async () => {
    if (!admin) throw new Error('admin local ausente');
    const previousHealth = await admin.rpc('automation_scheduler_health').single();
    expect(previousHealth.error).toBeNull();
    const previousFailures = previousHealth.data?.consecutive_failures ?? 0;

    const requested = await admin.rpc('request_automation_tick');
    expect(requested.error).toBeNull();
    expect(requested.data).toBeNull();

    const health = await admin.rpc('automation_scheduler_health').single();
    expect(health.error).toBeNull();
    expect(health.data).toMatchObject({
      stage: 'request_failed',
      degraded: true,
    });
    expect(health.data?.consecutive_failures).toBe(previousFailures + 1);
    expect(health.data?.last_error).toMatch(/segredo ou URL/i);
  });

  it('distingue requisição emitida ainda não recebida', async () => {
    if (!admin) throw new Error('admin local ausente');
    const started = await admin.rpc('begin_automation_tick_request');
    expect(started.error).toBeNull();
    const enqueued = await admin.rpc('mark_automation_tick_enqueued', {
      p_attempt_token: started.data,
      p_request_id: 42,
    });
    expect(enqueued.error).toBeNull();
    expect(enqueued.data).toBe(true);

    const health = await admin.rpc('automation_scheduler_health').single();
    expect(health.data).toMatchObject({
      stage: 'request_emitted',
      last_request_id: 42,
    });
  });

  it('recebimento e sucesso recuperam a saúde e zeram o contador', async () => {
    if (!admin) throw new Error('admin local ausente');
    const started = await admin.rpc('begin_automation_tick_request');
    const received = await admin.rpc('mark_automation_tick_received', {
      p_attempt_token: started.data,
    });
    expect(received.data).toBe(true);

    const completed = await admin.rpc('complete_automation_tick', {
      p_attempt_token: started.data,
      p_http_status: 200,
      p_materialized_count: 3,
      p_error: null,
    });
    expect(completed.error).toBeNull();
    expect(completed.data).toBe(true);

    const health = await admin.rpc('automation_scheduler_health').single();
    expect(health.data).toMatchObject({
      stage: 'tick_succeeded',
      degraded: false,
      healthy: true,
      last_http_status: 200,
      consecutive_failures: 0,
      last_materialized_count: 3,
      last_error: null,
    });
  });

  it('deriva degradação quando passam dois intervalos sem conclusão', async () => {
    if (!admin) throw new Error('admin local ausente');
    const future = new Date(Date.now() + 11 * 60_000).toISOString();
    const health = await admin
      .rpc('automation_scheduler_health_at', { p_now: future })
      .single();

    expect(health.error).toBeNull();
    expect(health.data).toMatchObject({
      stage: 'tick_succeeded',
      degraded: true,
      healthy: false,
    });
    expect(health.data?.reason).toMatch(/dois intervalos/i);
  });

  it('recusa live degradado e ainda permite consumir job já materializado', async () => {
    if (!admin) throw new Error('admin local ausente');
    const started = await admin.rpc('begin_automation_tick_request');
    const failed = await admin.rpc('fail_automation_tick_request', {
      p_attempt_token: started.data,
      p_error: 'tick derrubado pelo teste',
    });
    expect(failed.data).toBe(true);

    queueFixture = await createFunilTestFixture({
      admin,
      label: 'tick degraded queue',
      steps: [{
        type: 'send_message',
        config: {
          link_mode: 'copied',
          body_local: 'Fila preservada',
          message_kind: 'text',
        },
      }],
    });
    const materialized = await admin.rpc('materialize_automation_jobs', {
      p_batch_limit: 50,
    });
    expect(materialized.error).toBeNull();
    const job = await admin
      .from('automation_jobs')
      .select('id')
      .eq('enrollment_id', queueFixture.enrollmentId)
      .single();
    expect(job.error).toBeNull();

    const enable = await admin.rpc('set_automation_live_enabled', {
      p_organization_id: queueFixture.organizationId,
      p_enabled: true,
    });
    expect(enable.error?.code).toBe('55000');
    expect(enable.error?.message).toMatch(/envio real bloqueado.*tick derrubado/i);

    const claimed = await admin.rpc('claim_automation_jobs', {
      p_worker_id: 'worker-health-test',
      p_batch_limit: 1,
      p_lease_seconds: 60,
      p_job_id: job.data?.id,
    });
    expect(claimed.error).toBeNull();
    expect(claimed.data).toHaveLength(1);

    const settings = await admin
      .from('organization_settings')
      .select('automation_live_enabled')
      .eq('organization_id', queueFixture.organizationId)
      .single();
    expect(settings.data?.automation_live_enabled).toBe(false);
  });
});
