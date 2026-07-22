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
const describeLocal = config ? describe : describe.skip;

describeLocal('C2A — ponte legada e dependências v2 no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const runId = randomUUID();
  const password = `C2A!${runId}aA1`;
  const authUserIds: string[] = [];
  const orphanTagIds: string[] = [];
  let organizationId = '';
  let clinicAdmin: SupabaseClient;

  async function createDeal(title: string, tags: string[]) {
    const result = await admin!.from('deals').insert({
      organization_id: organizationId,
      title,
      tags,
    }).select('id').single();
    if (result.error) throw result.error;
    return result.data.id as string;
  }

  beforeAll(async () => {
    if (!admin || !config) return;
    const organization = await admin.from('organizations')
      .insert({ name: `C2A Legado ${runId}` })
      .select('id')
      .single();
    if (organization.error) throw organization.error;
    organizationId = organization.data.id;

    const email = `c2a.legacy.admin.${runId}@example.com`;
    const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (user.error || !user.data.user) throw user.error;
    authUserIds.push(user.data.user.id);
    const profile = await admin.from('profiles').upsert({
      id: user.data.user.id,
      email,
      name: 'C2A Admin legado',
      first_name: 'C2A',
      role: 'clinic_admin',
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    });
    if (profile.error) throw profile.error;
    clinicAdmin = createE2UserClient(config);
    const signed = await clinicAdmin.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    if (organizationId) {
      const cleanup = await admin.from('organizations').delete().eq('id', organizationId);
      if (cleanup.error) throw cleanup.error;
    }
    if (orphanTagIds.length) await admin.from('tags').delete().in('id', orphanTagIds);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  it('migra deals.tags sem inventar data/autor e preserva o texto v2', async () => {
    const legacyValue = `Legado Real ${runId}`;
    const dealId = await createDeal(`Deal legado ${runId}`, [legacyValue]);
    const legacyTag = await admin!.from('tags').insert({
      organization_id: organizationId,
      name: legacyValue,
      color: 'bg-blue-500',
    }).select('id').single();
    expect(legacyTag.error).toBeNull();

    const reconciled = await admin!.rpc('reconcile_legacy_deal_tags', {
      p_organization_id: organizationId,
    });
    expect(reconciled.error).toBeNull();

    const [tag, assignment, deal] = await Promise.all([
      admin!.from('tags')
        .select('id, category_id, legacy_value, normalized_name')
        .eq('id', legacyTag.data!.id)
        .single(),
      admin!.from('deal_tag_assignments')
        .select('provenance, applied_at, applied_by, recorded_at')
        .eq('deal_id', dealId)
        .single(),
      admin!.from('deals').select('tags').eq('id', dealId).single(),
    ]);
    expect(tag.data).toMatchObject({ id: legacyTag.data!.id, legacy_value: legacyValue });
    expect(tag.data?.category_id).toBeTruthy();
    expect(assignment.data).toMatchObject({
      provenance: 'legacy_migration',
      applied_at: null,
      applied_by: null,
    });
    expect(assignment.data?.recorded_at).toBeTruthy();
    expect(deal.data?.tags).toEqual([legacyValue]);
  });

  it('manda colisões e tags órfãs para revisão sem criar atribuição ambígua', async () => {
    const normalizedBase = `Indicação ${runId}`;
    const dealA = await createDeal(`Colisão A ${runId}`, [normalizedBase]);
    const dealB = await createDeal(`Colisão B ${runId}`, [` indicacao ${runId} `]);
    const orphan = await admin!.from('tags').insert({
      organization_id: null,
      name: `Órfã ${runId}`,
    }).select('id').single();
    expect(orphan.error).toBeNull();
    orphanTagIds.push(orphan.data!.id);

    const reconciled = await admin!.rpc('reconcile_legacy_deal_tags', {
      p_organization_id: null,
    });
    expect(reconciled.error).toBeNull();

    const [reviews, assignments] = await Promise.all([
      admin!.from('tag_migration_reviews')
        .select('review_type, legacy_values, tag_ids')
        .or(`organization_id.eq.${organizationId},organization_id.is.null`),
      admin!.from('deal_tag_assignments').select('deal_id').in('deal_id', [dealA, dealB]),
    ]);
    expect(reviews.error).toBeNull();
    expect(reviews.data?.some(({ review_type }) => review_type === 'normalization_collision'))
      .toBe(true);
    expect(reviews.data?.some(({ review_type, tag_ids }) =>
      review_type === 'orphan_tag' && tag_ids.includes(orphan.data!.id)))
      .toBe(true);
    expect(assignments.data).toEqual([]);
  });

  it('materializa trigger e switch v2 e bloqueia arquivamento da etiqueta publicada', async () => {
    const category = await admin!.from('tag_categories').insert({
      organization_id: organizationId,
      label: `Serviços dependência ${runId}`,
      cardinality: 'multiple',
    }).select('id').single();
    const tag = await admin!.from('tags').insert({
      organization_id: organizationId,
      category_id: category.data!.id,
      name: `Facetas dependência ${runId}`,
    }).select('id, name').single();
    expect(category.error).toBeNull();
    expect(tag.error).toBeNull();

    const automation = await admin!.from('automations').insert({
      organization_id: organizationId,
      name: `Automação dependência ${runId}`,
      trigger_type: 'tag_added',
      trigger_config: { tag: tag.data!.name },
      delivery_mode: 'simulation',
    }).select('id, draft_revision').single();
    expect(automation.error).toBeNull();
    const stepKey = randomUUID();
    const caseId = randomUUID();
    const step = await admin!.from('automation_steps').insert({
      organization_id: organizationId,
      automation_id: automation.data!.id,
      step_key: stepKey,
      step_type: 'switch',
      config: {
        field: 'deal.tags',
        cases: [{
          case_id: caseId,
          label: 'Facetas',
          operator: 'contains',
          value: tag.data!.name,
          order: 0,
        }],
        fallback_label: 'Outros',
      },
      sort_key: 0,
    });
    expect(step.error).toBeNull();

    const draftDependencies = await admin!.from('automation_tag_dependencies')
      .select('dependency_type, source_scope, case_id')
      .eq('automation_id', automation.data!.id)
      .eq('source_scope', 'draft');
    expect(draftDependencies.error).toBeNull();
    expect(draftDependencies.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ dependency_type: 'trigger', case_id: null }),
      expect.objectContaining({ dependency_type: 'switch_case', case_id: caseId }),
    ]));

    const definition = {
      schemaVersion: 2,
      trigger: { type: 'tag_added', config: { tag: tag.data!.name } },
      steps: [{
        stepKey,
        type: 'switch',
        config: {
          field: 'deal.tags',
          cases: [{ caseId, value: tag.data!.name, operator: 'contains', order: 0 }],
        },
      }],
    };
    const version = await admin!.from('automation_versions').insert({
      organization_id: organizationId,
      automation_id: automation.data!.id,
      version: 1,
      source_draft_revision: automation.data!.draft_revision,
      definition,
      definition_hash: 'a'.repeat(64),
    }).select('id').single();
    expect(version.error).toBeNull();
    const published = await admin!.from('automations').update({
      lifecycle_status: 'published',
      published_version_id: version.data!.id,
    }).eq('id', automation.data!.id);
    expect(published.error).toBeNull();

    const publishedDependencies = await admin!.from('automation_tag_dependencies')
      .select('dependency_type, source_scope, automation_version_id')
      .eq('automation_version_id', version.data!.id);
    expect(publishedDependencies.error).toBeNull();
    expect(publishedDependencies.data).toHaveLength(2);

    const archived = await clinicAdmin.from('tags')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', tag.data!.id);
    expect(archived.error?.code).toBe('55000');
    expect(archived.error?.message).toMatch(/Pause ou republique.*antes de arquivar/i);

    const removedAutomation = await clinicAdmin.from('automations')
      .delete()
      .eq('id', automation.data!.id);
    expect(removedAutomation.error).toBeNull();
    const removedTag = await clinicAdmin.from('tags').delete().eq('id', tag.data!.id);
    expect(removedTag.error).toBeNull();
  });
});
