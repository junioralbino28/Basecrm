// @vitest-environment node
import { randomUUID } from 'node:crypto';
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

type SwitchCase = {
  caseId: string;
  label: string;
  operator: 'contains';
  value: string;
  order: number;
};

type SwitchFixture = {
  fixture: FunilTestFixture;
  cases: SwitchCase[];
};

describeLocal('C1A — execução N-ária do switch no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const fixtures: FunilTestFixture[] = [];

  async function createSwitchFixture(params: {
    label: string;
    field: 'deal.tags' | 'contact.phone';
    cases: Array<Omit<SwitchCase, 'caseId'>>;
    dealTags?: string[];
  }): Promise<SwitchFixture> {
    if (!admin) throw new Error('admin local ausente');
    const cases = params.cases.map((switchCase) => ({
      ...switchCase,
      caseId: randomUUID(),
    }));
    const fixture = await createFunilTestFixture({
      admin,
      label: params.label,
      dealTags: params.dealTags,
      steps: [
        {
          type: 'switch',
          config: {
            field: params.field,
            cases: cases.map((switchCase) => ({
              case_id: switchCase.caseId,
              label: switchCase.label,
              operator: switchCase.operator,
              value: switchCase.value,
              order: switchCase.order,
            })),
            fallback_label: 'Não identificado',
          },
        },
        { type: 'create_task', config: { title: 'Destino do caso A' } },
        { type: 'create_task', config: { title: 'Destino do caso B' } },
        { type: 'create_task', config: { title: 'Destino fallback' } },
      ],
      edges: [
        {
          from: 0,
          to: 1,
          outcome: `case:${cases[0].caseId}`,
          order: cases[0].order,
        },
        {
          from: 0,
          to: 2,
          outcome: `case:${cases[1].caseId}`,
          order: cases[1].order,
        },
        { from: 0, to: 3, outcome: 'otherwise', order: 2 },
      ],
    });
    fixtures.push(fixture);
    return { fixture, cases };
  }

  async function materializeAndRead(fixture: FunilTestFixture) {
    if (!admin) throw new Error('admin local ausente');
    const materialized = await admin.rpc('materialize_automation_jobs', {
      p_batch_limit: 50,
    });
    expect(materialized.error).toBeNull();

    const [job, enrollment] = await Promise.all([
      admin
        .from('automation_jobs')
        .select('id, status, payload')
        .eq('enrollment_id', fixture.enrollmentId)
        .eq('step_key', fixture.stepKeys[0])
        .single(),
      admin
        .from('automation_enrollments')
        .select('current_step_key')
        .eq('id', fixture.enrollmentId)
        .single(),
    ]);
    expect(job.error).toBeNull();
    expect(enrollment.error).toBeNull();
    return { job: job.data, enrollment: enrollment.data };
  }

  afterAll(async () => {
    for (const fixture of fixtures.reverse()) await fixture.cleanup();
  }, 120_000);

  it('faz o primeiro caso compatível vencer pela ordem', async () => {
    const { fixture, cases } = await createSwitchFixture({
      label: 'switch precedência',
      field: 'contact.phone',
      cases: [
        { label: 'Brasil', operator: 'contains', value: '55', order: 0 },
        { label: 'São Paulo', operator: 'contains', value: '11', order: 1 },
      ],
    });

    const result = await materializeAndRead(fixture);
    expect(result.job).toMatchObject({
      status: 'simulated',
      payload: {
        metadata: {
          switchOutcome: `case:${cases[0].caseId}`,
        },
      },
    });
    expect(result.enrollment?.current_step_key).toBe(fixture.stepKeys[1]);
  });

  it('segue otherwise quando nenhum caso casa', async () => {
    const { fixture } = await createSwitchFixture({
      label: 'switch fallback',
      field: 'deal.tags',
      dealTags: ['sem-correspondência'],
      cases: [
        { label: 'Lentes', operator: 'contains', value: 'lentes', order: 0 },
        { label: 'Ortodontia', operator: 'contains', value: 'ortodontia', order: 1 },
      ],
    });

    const result = await materializeAndRead(fixture);
    expect(result.job).toMatchObject({
      status: 'simulated',
      payload: { metadata: { switchOutcome: 'otherwise' } },
    });
    expect(result.enrollment?.current_step_key).toBe(fixture.stepKeys[3]);
  });

  it('com múltiplas etiquetas, usa a menor order e não a ordem do array', async () => {
    const { fixture, cases } = await createSwitchFixture({
      label: 'switch múltiplas tags',
      field: 'deal.tags',
      dealTags: ['lentes', 'ortodontia'],
      cases: [
        { label: 'Lentes', operator: 'contains', value: 'lentes', order: 1 },
        { label: 'Ortodontia', operator: 'contains', value: 'ortodontia', order: 0 },
      ],
    });

    const result = await materializeAndRead(fixture);
    expect(result.job).toMatchObject({
      status: 'simulated',
      payload: {
        metadata: {
          switchOutcome: `case:${cases[1].caseId}`,
        },
      },
    });
    expect(result.enrollment?.current_step_key).toBe(fixture.stepKeys[2]);
  });

  it('reprocessa o mesmo passo sem duplicar job, attempt ou transição', async () => {
    if (!admin) throw new Error('admin local ausente');
    const { fixture } = await createSwitchFixture({
      label: 'switch idempotente',
      field: 'deal.tags',
      dealTags: ['lentes'],
      cases: [
        { label: 'Lentes', operator: 'contains', value: 'lentes', order: 0 },
        { label: 'Ortodontia', operator: 'contains', value: 'ortodontia', order: 1 },
      ],
    });

    await Promise.all([
      admin.rpc('materialize_automation_jobs', { p_batch_limit: 50 }),
      admin.rpc('materialize_automation_jobs', { p_batch_limit: 50 }),
    ]);
    const repeated = await admin
      .rpc('execute_automation_switch', {
        p_enrollment_id: fixture.enrollmentId,
        p_step_key: fixture.stepKeys[0],
      })
      .single();
    expect(repeated.error).toBeNull();
    expect(repeated.data?.is_new).toBe(false);

    const jobs = await admin
      .from('automation_jobs')
      .select('id', { count: 'exact' })
      .eq('enrollment_id', fixture.enrollmentId)
      .eq('step_key', fixture.stepKeys[0]);
    expect(jobs.error).toBeNull();
    expect(jobs.count).toBe(1);

    const attempts = await admin
      .from('automation_step_attempts')
      .select('id', { count: 'exact' })
      .eq('job_id', jobs.data?.[0].id);
    expect(attempts.error).toBeNull();
    expect(attempts.count).toBe(1);
  });
});
