// @vitest-environment node
//
// Prova mutável da F1. O helper recusa produção e, com REQUIRE_E2_MIGRATION=1,
// transforma credenciais/migration ausentes em falha em vez de skip.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createE2AdminClient,
  createE2UserClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';

const config = loadE2SupabaseConfig();
const describeE2 = config ? describe : describe.skip;

type UserFixture = {
  id: string;
  client: SupabaseClient;
};

describeE2('F1 — isolamento real do authoring no Supabase local', () => {
  const runId = randomUUID();
  const password = `F1!${randomUUID()}aA1`;
  const admin = config ? createE2AdminClient(config) : null;
  const authUserIds: string[] = [];

  let organizationA = '';
  let organizationB = '';
  let automationA = '';
  let automationB = '';
  let stepA = '';
  let stepB = '';
  let editor: UserFixture;
  let operator: UserFixture;

  async function createUser(
    role: 'clinic_admin' | 'clinic_staff',
    organizationId: string,
  ): Promise<UserFixture> {
    if (!admin || !config) throw new Error('config E2 ausente');
    const email = `funil.f1.${role}.${runId}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role, organization_id: organizationId },
    });
    if (created.error || !created.data.user?.id) {
      throw new Error(`createUser ${role}: ${created.error?.message}`);
    }

    const id = created.data.user.id;
    authUserIds.push(id);
    const profile = await admin.from('profiles').upsert({
      id,
      email,
      name: `F1 ${role}`,
      first_name: 'F1',
      role,
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (profile.error) throw new Error(`profile ${role}: ${profile.error.message}`);

    const client = createE2UserClient(config);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`signIn ${role}: ${signedIn.error.message}`);
    return { id, client };
  }

  beforeAll(async () => {
    if (!admin) return;

    const organizations = await admin
      .from('organizations')
      .insert([
        { name: `Funil F1 A ${runId}` },
        { name: `Funil F1 B ${runId}` },
      ])
      .select('id');
    if (organizations.error || organizations.data?.length !== 2) {
      throw new Error(`organizations F1: ${organizations.error?.message ?? 'retorno incompleto'}`);
    }
    organizationA = organizations.data[0].id;
    organizationB = organizations.data[1].id;

    editor = await createUser('clinic_admin', organizationA);
    operator = await createUser('clinic_staff', organizationA);

    const automations = await admin
      .from('automations')
      .insert([
        { organization_id: organizationA, name: `Automação A ${runId}` },
        { organization_id: organizationB, name: `Automação B ${runId}` },
      ])
      .select('id, organization_id');
    if (automations.error || automations.data?.length !== 2) {
      throw new Error(`automations F1: ${automations.error?.message ?? 'retorno incompleto'}`);
    }
    automationA = automations.data.find((row) => row.organization_id === organizationA)?.id ?? '';
    automationB = automations.data.find((row) => row.organization_id === organizationB)?.id ?? '';

    const steps = await admin
      .from('automation_steps')
      .insert([
        {
          organization_id: organizationA,
          automation_id: automationA,
          step_type: 'send_message',
        },
        {
          organization_id: organizationB,
          automation_id: automationB,
          step_type: 'create_task',
        },
      ])
      .select('id, organization_id');
    if (steps.error || steps.data?.length !== 2) {
      throw new Error(`steps F1: ${steps.error?.message ?? 'retorno incompleto'}`);
    }
    stepA = steps.data.find((row) => row.organization_id === organizationA)?.id ?? '';
    stepB = steps.data.find((row) => row.organization_id === organizationB)?.id ?? '';
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
    if (organizationA || organizationB) {
      await admin
        .from('organizations')
        .delete()
        .in('id', [organizationA, organizationB].filter(Boolean));
    }
  }, 120_000);

  it('roda somente contra o Supabase local', () => {
    expect(config?.isLocal).toBe(true);
  });

  it('editor enxerga e altera apenas o próprio tenant', async () => {
    const selected = await editor.client.from('automations').select('id, organization_id');
    expect(selected.error).toBeNull();
    expect(selected.data).toEqual([
      expect.objectContaining({ id: automationA, organization_id: organizationA }),
    ]);

    const ownInsert = await editor.client.from('automations').insert({
      organization_id: organizationA,
      name: `Draft editor ${runId}`,
    });
    expect(ownInsert.error).toBeNull();

    const crossInsert = await editor.client.from('automations').insert({
      organization_id: organizationB,
      name: `Draft cross ${runId}`,
    });
    expect(crossInsert.error?.code).toBe('42501');
  });

  it('operador lê automações do tenant, mas não altera draft, grafo ou templates', async () => {
    const selected = await operator.client.from('automations').select('id, organization_id');
    expect(selected.error).toBeNull();
    expect(selected.data?.map((row) => row.id)).toContain(automationA);
    expect(selected.data?.map((row) => row.id)).not.toContain(automationB);

    const update = await operator.client
      .from('automations')
      .update({ name: `Operador não edita ${runId}` })
      .eq('id', automationA)
      .select('id');
    expect(update.error).toBeNull();
    expect(update.data).toEqual([]);

    const stepInsert = await operator.client.from('automation_steps').insert({
      organization_id: organizationA,
      automation_id: automationA,
      step_type: 'delay',
    });
    expect(stepInsert.error?.code).toBe('42501');

    const templateInsert = await operator.client.from('message_templates').insert({
      organization_id: organizationA,
      name: `Template operador ${runId}`,
      body: 'Não deve persistir',
    });
    expect(templateInsert.error?.code).toBe('42501');
  });

  it('FKs compostas recusam automação e aresta que cruzam tenants', async () => {
    if (!admin) throw new Error('admin E2 ausente');
    const mismatchedStep = await admin.from('automation_steps').insert({
      organization_id: organizationA,
      automation_id: automationB,
      step_type: 'delay',
    });
    expect(mismatchedStep.error?.code).toBe('23503');

    const mismatchedEdge = await admin.from('automation_step_edges').insert({
      organization_id: organizationA,
      automation_id: automationA,
      from_step_id: stepA,
      to_step_id: stepB,
      outcome: 'success',
    });
    expect(mismatchedEdge.error?.code).toBe('23503');
  });

  it('organization_id permanece imutável mesmo para service_role', async () => {
    if (!admin) throw new Error('admin E2 ausente');
    const moved = await admin
      .from('automations')
      .update({ organization_id: organizationB })
      .eq('id', automationA);
    expect(moved.error?.code).toBe('23514');
  });
});
