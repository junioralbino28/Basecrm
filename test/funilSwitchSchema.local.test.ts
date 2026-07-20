// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createE2AdminClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';

const config = loadE2SupabaseConfig();
const describeLocal = config ? describe : describe.skip;

describeLocal('C1A — contrato SQL do passo switch no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  let organizationId = '';
  let automationId = '';
  let switchStepId = '';
  const targetStepIds: string[] = [];

  beforeAll(async () => {
    if (!admin) throw new Error('admin local ausente');

    const organization = await admin
      .from('organizations')
      .insert({ name: `Switch schema ${randomUUID()}` })
      .select('id')
      .single();
    if (organization.error || !organization.data) {
      throw new Error(`fixture organization: ${organization.error?.message}`);
    }
    organizationId = organization.data.id;

    const automation = await admin
      .from('automations')
      .insert({
        organization_id: organizationId,
        name: 'Contrato switch',
        trigger_config: { tag: `switch-${randomUUID()}` },
      })
      .select('id')
      .single();
    if (automation.error || !automation.data) {
      throw new Error(`fixture automation: ${automation.error?.message}`);
    }
    automationId = automation.data.id;

    const switchStep = await admin
      .from('automation_steps')
      .insert({
        organization_id: organizationId,
        automation_id: automationId,
        step_type: 'switch',
        config: { field: 'contact.tags', cases: [], fallback_label: 'Outros' },
        sort_key: 0,
      })
      .select('id')
      .single();
    if (switchStep.error || !switchStep.data) {
      throw new Error(`fixture switch: ${switchStep.error?.message}`);
    }
    switchStepId = switchStep.data.id;

    const targets = await admin
      .from('automation_steps')
      .insert(
        Array.from({ length: 5 }, (_, index) => ({
          organization_id: organizationId,
          automation_id: automationId,
          step_type: 'create_task',
          config: { title: `Destino ${index}` },
          sort_key: index + 1,
        })),
      )
      .select('id');
    if (targets.error || !targets.data || targets.data.length !== 5) {
      throw new Error(`fixture targets: ${targets.error?.message}`);
    }
    targetStepIds.push(...targets.data.map(({ id }) => id));
  });

  afterAll(async () => {
    if (!admin || !organizationId) return;
    const deleted = await admin.from('organizations').delete().eq('id', organizationId);
    if (deleted.error) throw new Error(`cleanup organization: ${deleted.error.message}`);
  });

  it('aceita outcome case:<uuid>', async () => {
    if (!admin) throw new Error('admin local ausente');
    const inserted = await admin.from('automation_step_edges').insert({
      organization_id: organizationId,
      automation_id: automationId,
      from_step_id: switchStepId,
      outcome: `case:${randomUUID()}`,
      to_step_id: targetStepIds[0],
      order: 0,
    });

    expect(inserted.error).toBeNull();
  });

  it('recusa outcome case:abc', async () => {
    if (!admin) throw new Error('admin local ausente');
    const inserted = await admin.from('automation_step_edges').insert({
      organization_id: organizationId,
      automation_id: automationId,
      from_step_id: switchStepId,
      outcome: 'case:abc',
      to_step_id: targetStepIds[1],
      order: 1,
    });

    expect(inserted.error?.code).toBe('23514');
    expect(inserted.error?.message).toMatch(/automation_step_edges_outcome_known/);
  });

  it('recusa duas arestas com o mesmo caso', async () => {
    if (!admin) throw new Error('admin local ausente');
    const caseOutcome = `case:${randomUUID()}`;
    const first = await admin.from('automation_step_edges').insert({
      organization_id: organizationId,
      automation_id: automationId,
      from_step_id: switchStepId,
      outcome: caseOutcome,
      to_step_id: targetStepIds[1],
      order: 2,
    });
    const duplicate = await admin.from('automation_step_edges').insert({
      organization_id: organizationId,
      automation_id: automationId,
      from_step_id: switchStepId,
      outcome: caseOutcome,
      to_step_id: targetStepIds[2],
      order: 3,
    });

    expect(first.error).toBeNull();
    expect(duplicate.error?.code).toBe('23505');
    expect(duplicate.error?.message).toMatch(/automation_step_edges_outcome_unique/);
  });

  it('recusa duas arestas com a mesma ordem no mesmo pai', async () => {
    if (!admin) throw new Error('admin local ausente');
    const first = await admin.from('automation_step_edges').insert({
      organization_id: organizationId,
      automation_id: automationId,
      from_step_id: switchStepId,
      outcome: `case:${randomUUID()}`,
      to_step_id: targetStepIds[3],
      order: 4,
    });
    const duplicate = await admin.from('automation_step_edges').insert({
      organization_id: organizationId,
      automation_id: automationId,
      from_step_id: switchStepId,
      outcome: `case:${randomUUID()}`,
      to_step_id: targetStepIds[4],
      order: 4,
    });

    expect(first.error).toBeNull();
    expect(duplicate.error?.code).toBe('23505');
    expect(duplicate.error?.message).toMatch(/automation_step_edges_order_unique/);
  });
});
