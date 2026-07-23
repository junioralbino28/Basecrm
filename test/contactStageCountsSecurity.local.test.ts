// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createE2AdminClient,
  createE2UserClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';

const config = loadE2SupabaseConfig();
if (config && !config.isLocal) {
  throw new Error('RECUSADO: este hotfix de segurança só pode ser provado no Supabase local');
}
const describeLocal = config ? describe : describe.skip;

type UserFixture = {
  id: string;
  client: SupabaseClient;
};

type RpcError = {
  code?: string;
  message?: string;
} | null;

function expectLegacyFunctionsMissing(
  results: Array<{ call: string; error: RpcError; data: unknown }>,
): void {
  const exposed = results
    .filter(({ error }) => error === null)
    .map(({ call, data }) => ({ call, dadosArtificiaisRetornados: data }));

  expect(
    exposed,
    `RPCs legadas ainda expuseram métricas globais no RED pré-fix: ${JSON.stringify(exposed)}`,
  ).toEqual([]);

  for (const { error } of results) {
    expect(['PGRST202', '42883']).toContain(error?.code);
  }
}

function countsByStage(data: unknown): Record<string, number> {
  return Object.fromEntries(
    ((data ?? []) as Array<{ stage: string; count: number }>).map((row) => [
      row.stage,
      Number(row.count),
    ]),
  );
}

describeLocal('hotfix — contagem de contatos isolada via PostgREST local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const runId = randomUUID();
  const password = `Stage!${runId}aA1`;
  const authUserIds: string[] = [];
  let organizationA = '';
  let organizationB = '';
  let userA: UserFixture;
  let userB: UserFixture;

  async function createClinicAdmin(
    organizationId: string,
    suffix: string,
  ): Promise<UserFixture> {
    if (!admin || !config) throw new Error('Supabase local indisponível');
    const email = `stage-count.${suffix}.${runId}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`createUser ${suffix}: ${created.error?.message}`);
    }
    authUserIds.push(created.data.user.id);

    const profile = await admin.from('profiles').upsert({
      id: created.data.user.id,
      email,
      name: `Stage count ${suffix}`,
      first_name: 'Stage',
      role: 'clinic_admin',
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    });
    if (profile.error) throw new Error(`profile ${suffix}: ${profile.error.message}`);

    const client = createE2UserClient(config);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`signIn ${suffix}: ${signedIn.error.message}`);
    return { id: created.data.user.id, client };
  }

  beforeAll(async () => {
    if (!admin) return;
    const organizations = await admin
      .from('organizations')
      .insert([
        { name: `Stage Count A ${runId}` },
        { name: `Stage Count B ${runId}` },
      ])
      .select('id');
    if (organizations.error || organizations.data.length !== 2) {
      throw new Error(`organizations: ${organizations.error?.message ?? 'retorno incompleto'}`);
    }
    [organizationA, organizationB] = organizations.data.map(({ id }) => id);

    userA = await createClinicAdmin(organizationA, 'a');
    userB = await createClinicAdmin(organizationB, 'b');

    const contacts = await admin.from('contacts').insert([
      { organization_id: organizationA, name: `A Lead 1 ${runId}`, stage: 'LEAD' },
      { organization_id: organizationA, name: `A Lead 2 ${runId}`, stage: 'LEAD' },
      { organization_id: organizationA, name: `A nulo ${runId}`, stage: null },
      {
        organization_id: organizationA,
        name: `A excluído ${runId}`,
        stage: 'DELETED',
        deleted_at: new Date().toISOString(),
      },
      { organization_id: organizationB, name: `B Cliente ${runId}`, stage: 'CUSTOMER' },
      { organization_id: organizationB, name: `B Lead ${runId}`, stage: 'LEAD' },
    ]);
    if (contacts.error) throw new Error(`contacts: ${contacts.error.message}`);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of authUserIds) {
      const deleted = await admin.auth.admin.deleteUser(id);
      if (deleted.error) throw new Error(`cleanup auth user: ${deleted.error.message}`);
    }
    const organizationIds = [organizationA, organizationB].filter(Boolean);
    if (organizationIds.length > 0) {
      const deleted = await admin.from('organizations').delete().in('id', organizationIds);
      if (deleted.error) throw new Error(`cleanup organizations: ${deleted.error.message}`);
    }
  }, 120_000);

  it('recusa qualquer alvo que não seja o Supabase local', () => {
    expect(config?.isLocal).toBe(true);
  });

  it('remove as duas RPCs zero-arg do schema exposto', async () => {
    const [
      stageCountsA,
      dashboardStatsA,
      stageCountsB,
      dashboardStatsB,
    ] = await Promise.all([
      userA.client.rpc('get_contact_stage_counts'),
      userA.client.rpc('get_dashboard_stats'),
      userB.client.rpc('get_contact_stage_counts'),
      userB.client.rpc('get_dashboard_stats'),
    ]);

    expectLegacyFunctionsMissing([
      {
        call: 'tenant A / get_contact_stage_counts()',
        error: stageCountsA.error,
        data: stageCountsA.data,
      },
      {
        call: 'tenant A / get_dashboard_stats()',
        error: dashboardStatsA.error,
        data: dashboardStatsA.data,
      },
      {
        call: 'tenant B / get_contact_stage_counts()',
        error: stageCountsB.error,
        data: stageCountsB.data,
      },
      {
        call: 'tenant B / get_dashboard_stats()',
        error: dashboardStatsB.error,
        data: dashboardStatsB.data,
      },
    ]);
  });

  it('cada tenant recebe somente suas próprias contagens', async () => {
    const [resultA, resultB] = await Promise.all([
      userA.client.rpc('get_contact_stage_counts', {
        p_organization_id: organizationA,
      }),
      userB.client.rpc('get_contact_stage_counts', {
        p_organization_id: organizationB,
      }),
    ]);

    expect(resultA.error).toBeNull();
    expect(resultB.error).toBeNull();
    expect(countsByStage(resultA.data)).toEqual({ LEAD: 2, UNKNOWN: 1 });
    expect(countsByStage(resultB.data)).toEqual({ CUSTOMER: 1, LEAD: 1 });
  });

  it('recusa tentativa autenticada de consultar outro tenant', async () => {
    const result = await userA.client.rpc('get_contact_stage_counts', {
      p_organization_id: organizationB,
    });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('42501');
    expect(result.error?.message).toMatch(/sem acesso à organização/i);
  });

  it('recusa organização nula mesmo para usuário autenticado', async () => {
    const result = await userA.client.rpc('get_contact_stage_counts', {
      p_organization_id: null,
    });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('42501');
    expect(result.error?.message).toMatch(/sem acesso à organização/i);
  });

  it('não concede execução da RPC tenantizada ao papel anon', async () => {
    if (!config) throw new Error('Supabase local indisponível');
    const anonymous = createE2UserClient(config);

    const result = await anonymous.rpc('get_contact_stage_counts', {
      p_organization_id: organizationA,
    });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('42501');
    expect(result.error?.message).toMatch(/permission denied/i);
  });
});
