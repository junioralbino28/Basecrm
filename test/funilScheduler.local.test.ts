// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createE2AdminClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';
import {
  createFunilTestFixture,
  type FunilTestFixture,
} from './helpers/funilTestFixture';
import { dispatchAutomationSimulation } from '@/lib/conversations/dispatchConversationOutbound';

const config = loadE2SupabaseConfig();
const describeLocal = config ? describe : describe.skip;

type ClaimedJob = {
  id: string;
  attempt_count: number;
  lease_owner: string;
  status: string;
};

describeLocal('F4 — scheduler durável no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  let fixture: FunilTestFixture | null = null;

  beforeAll(async () => {
    if (!admin) return;
    fixture = await createFunilTestFixture({
      admin,
      label: 'F4 scheduler',
      steps: [{
        type: 'send_message',
        config: {
          link_mode: 'copied',
          body_local: 'Olá {{ contato.primeiro_nome | default: "tudo bem" }}',
          message_kind: 'text',
        },
      }],
    });
  }, 120_000);

  afterAll(async () => {
    await fixture?.cleanup();
  }, 120_000);

  it('habilita pg_cron e agenda um tick a cada cinco minutos', async () => {
    if (!admin) throw new Error('admin local ausente');
    const health = await admin.rpc('automation_scheduler_health').single();
    expect(health.error).toBeNull();
    expect(health.data).toMatchObject({
      cron_installed: true,
      pg_net_installed: true,
      schedule: '*/5 * * * *',
      active: true,
    });
  });

  it('dois ticks concorrentes materializam um único job e renderizam antes do outbox', async () => {
    if (!admin || !fixture) throw new Error('fixture F4 ausente');

    const ticks = await Promise.all([
      admin.rpc('materialize_automation_jobs', { p_batch_limit: 20 }),
      admin.rpc('materialize_automation_jobs', { p_batch_limit: 20 }),
    ]);
    expect(ticks.every((tick) => tick.error === null)).toBe(true);

    const jobs = await admin
      .from('automation_jobs')
      .select('id, payload, status', { count: 'exact' })
      .eq('enrollment_id', fixture.enrollmentId)
      .eq('step_key', fixture.stepKeys[0]);
    expect(jobs.error).toBeNull();
    expect(jobs.count).toBe(1);
    expect(jobs.data?.[0]).toMatchObject({
      status: 'pending',
      payload: {
        content: 'Olá Maria',
        messageType: 'text',
      },
    });
  });

  it('FOR UPDATE SKIP LOCKED entrega o job a somente um worker', async () => {
    if (!admin || !fixture) throw new Error('fixture F4 ausente');

    const targetJob = await admin
      .from('automation_jobs')
      .select('id')
      .eq('enrollment_id', fixture.enrollmentId)
      .eq('step_key', fixture.stepKeys[0])
      .single();
    expect(targetJob.error).toBeNull();

    const claims = await Promise.all([
      admin.rpc('claim_automation_jobs', {
        p_worker_id: 'worker-a',
        p_batch_limit: 10,
        p_lease_seconds: 60,
      }),
      admin.rpc('claim_automation_jobs', {
        p_worker_id: 'worker-b',
        p_batch_limit: 10,
        p_lease_seconds: 60,
      }),
    ]);
    expect(claims.every((claim) => claim.error === null)).toBe(true);

    const claimed = claims.flatMap((claim) => (claim.data ?? []) as ClaimedJob[]);
    const targetClaims = claimed.filter((job) => job.id === targetJob.data?.id);
    expect(targetClaims).toHaveLength(1);
    expect(targetClaims[0]).toMatchObject({
      status: 'leased',
      attempt_count: 1,
    });

    const dispatched = await dispatchAutomationSimulation({
      db: admin,
      jobId: targetClaims[0].id,
      leaseOwner: targetClaims[0].lease_owner,
      attemptCount: targetClaims[0].attempt_count,
    });
    expect(dispatched.status).toBe('simulated');

    const repeated = await dispatchAutomationSimulation({
      db: admin,
      jobId: targetClaims[0].id,
      leaseOwner: targetClaims[0].lease_owner,
      attemptCount: targetClaims[0].attempt_count,
    });
    expect(repeated.duplicate).toBe(true);

    const messages = await admin
      .from('conversation_messages')
      .select('id', { count: 'exact', head: true })
      .eq('automation_job_id', targetClaims[0].id);
    expect(messages.count).toBe(1);
  });

  it('lease expirado volta à fila e retry usa compare-and-set com backoff', async () => {
    if (!admin || !fixture) throw new Error('fixture F4 ausente');

    const job = await admin
      .from('automation_jobs')
      .insert({
        organization_id: fixture.organizationId,
        enrollment_id: fixture.enrollmentId,
        version_id: fixture.versionId,
        step_key: fixture.stepKeys[0],
        job_type: 'send_message',
        idempotency_key: `f4-retry:${fixture.enrollmentId}`,
        payload: { content: 'Retry controlado', messageType: 'text' },
      })
      .select('id')
      .single();
    expect(job.error).toBeNull();

    const firstClaim = await admin.rpc('claim_automation_jobs', {
      p_worker_id: 'worker-retry-a',
      p_batch_limit: 1,
      p_lease_seconds: 60,
      p_job_id: job.data?.id,
    });
    expect(firstClaim.error).toBeNull();
    const first = (firstClaim.data as ClaimedJob[])[0];

    const staleCompletion = await admin.rpc('complete_automation_job', {
      p_job_id: job.data?.id,
      p_worker_id: 'worker-errado',
      p_attempt_count: first.attempt_count,
      p_outcome: 'retryable_failure',
      p_error: 'timeout',
    });
    expect(staleCompletion.error?.code).toBe('55000');

    const retry = await admin.rpc('complete_automation_job', {
      p_job_id: job.data?.id,
      p_worker_id: first.lease_owner,
      p_attempt_count: first.attempt_count,
      p_outcome: 'retryable_failure',
      p_error: 'HTTP 503',
    });
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({
      status: 'pending',
      attempt_count: 1,
    });
    expect(new Date(retry.data.available_at).getTime()).toBeGreaterThan(Date.now());

    await admin
      .from('automation_jobs')
      .update({ available_at: new Date(Date.now() - 1_000).toISOString() })
      .eq('id', job.data?.id);

    const secondClaim = await admin.rpc('claim_automation_jobs', {
      p_worker_id: 'worker-retry-b',
      p_batch_limit: 1,
      p_lease_seconds: 60,
      p_job_id: job.data?.id,
    });
    expect(secondClaim.error).toBeNull();
    expect((secondClaim.data as ClaimedJob[])[0]).toMatchObject({
      lease_owner: 'worker-retry-b',
      attempt_count: 2,
    });
  });
});
