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

type UserFixture = { id: string; client: SupabaseClient };

describeLocal('C2A — taxonomia de etiquetas no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const runId = randomUUID();
  const password = `C2A!${runId}aA1`;
  const authUserIds: string[] = [];
  let organizationA = '';
  let organizationB = '';
  let dealA = '';
  let dealB = '';
  let clinicAdmin: UserFixture;
  let clinicStaff: UserFixture;

  async function createUser(role: 'clinic_admin' | 'clinic_staff'): Promise<UserFixture> {
    if (!admin || !config) throw new Error('Supabase local indisponível');
    const email = `c2a.${role}.${runId}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw created.error;
    authUserIds.push(created.data.user.id);
    const profile = await admin.from('profiles').upsert({
      id: created.data.user.id,
      email,
      name: `C2A ${role}`,
      first_name: 'C2A',
      role,
      organization_id: organizationA,
      updated_at: new Date().toISOString(),
    });
    if (profile.error) throw profile.error;
    const client = createE2UserClient(config);
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return { id: created.data.user.id, client };
  }

  beforeAll(async () => {
    if (!admin) return;
    const organizations = await admin
      .from('organizations')
      .insert([{ name: `C2A Tags A ${runId}` }, { name: `C2A Tags B ${runId}` }])
      .select('id');
    if (organizations.error || organizations.data.length !== 2) throw organizations.error;
    [organizationA, organizationB] = organizations.data.map(({ id }) => id);

    clinicAdmin = await createUser('clinic_admin');
    clinicStaff = await createUser('clinic_staff');

    const deals = await admin
      .from('deals')
      .insert([
        { organization_id: organizationA, title: `C2A deal A ${runId}`, tags: [] },
        { organization_id: organizationB, title: `C2A deal B ${runId}`, tags: [] },
      ])
      .select('id, organization_id');
    if (deals.error || deals.data.length !== 2) throw deals.error;
    dealA = deals.data.find(({ organization_id }) => organization_id === organizationA)!.id;
    dealB = deals.data.find(({ organization_id }) => organization_id === organizationB)!.id;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
    if (organizationA || organizationB) {
      const cleanup = await admin.from('organizations')
        .delete()
        .in('id', [organizationA, organizationB]);
      if (cleanup.error) throw cleanup.error;
    }
  }, 120_000);

  it('normaliza acentos, caixa e espaços e devolve a mesma entidade sob corrida', async () => {
    const category = await clinicAdmin.client.rpc('get_or_create_tag_category', {
      p_organization_id: organizationA,
      p_label: ' Procedimentos  Estéticos ',
      p_cardinality: 'multiple',
    });
    expect(category.error).toBeNull();
    expect(category.data.created_by).toBe(clinicAdmin.id);

    const categoryId = category.data.id as string;
    const [first, second, third] = await Promise.all([
      clinicAdmin.client.rpc('get_or_create_tag', {
        p_organization_id: organizationA,
        p_category_id: categoryId,
        p_name: 'Indicação',
      }),
      clinicAdmin.client.rpc('get_or_create_tag', {
        p_organization_id: organizationA,
        p_category_id: categoryId,
        p_name: 'indicacao',
      }),
      clinicAdmin.client.rpc('get_or_create_tag', {
        p_organization_id: organizationA,
        p_category_id: categoryId,
        p_name: ' indicação ',
      }),
    ]);

    expect([first.error, second.error, third.error]).toEqual([null, null, null]);
    expect(new Set([first.data.id, second.data.id, third.data.id]).size).toBe(1);
    expect(first.data.normalized_name).toBe('indicacao');
    expect(['Indicação', 'indicacao']).toContain(first.data.name);
    expect(first.data.created_by).toBe(clinicAdmin.id);
  });

  it('clinic_staff aplica e remove etiqueta, mas não gerencia catálogo nem auditoria', async () => {
    const category = await clinicAdmin.client.rpc('get_or_create_tag_category', {
      p_organization_id: organizationA,
      p_label: `Serviço ${runId}`,
      p_cardinality: 'multiple',
    });
    const tag = await clinicAdmin.client.rpc('get_or_create_tag', {
      p_organization_id: organizationA,
      p_category_id: category.data.id,
      p_name: `Facetas ${runId}`,
    });
    expect(category.error).toBeNull();
    expect(tag.error).toBeNull();

    const deniedCategory = await clinicStaff.client.from('tag_categories').insert({
      organization_id: organizationA,
      label: `Proibida ${runId}`,
      normalized_name: `forjada-${runId}`,
      created_by: clinicAdmin.id,
    });
    expect(deniedCategory.error?.code).toBe('42501');

    const deniedTag = await clinicStaff.client.from('tags').insert({
      organization_id: organizationA,
      category_id: category.data.id,
      name: `Etiqueta proibida ${runId}`,
    });
    expect(deniedTag.error?.code).toBe('42501');

    const deniedRename = await clinicStaff.client
      .from('tags')
      .update({ name: `Renomeada ${runId}`, archived_at: new Date().toISOString() })
      .eq('id', tag.data.id)
      .select('id');
    expect(deniedRename.error).toBeNull();
    expect(deniedRename.data).toEqual([]);

    const catalogStillIntact = await admin!
      .from('tags')
      .select('name, archived_at')
      .eq('id', tag.data.id)
      .single();
    expect(catalogStillIntact.data).toMatchObject({
      name: `Facetas ${runId}`,
      archived_at: null,
    });

    const assigned = await clinicStaff.client.rpc('assign_deal_tag', {
      p_organization_id: organizationA,
      p_deal_id: dealA,
      p_tag_id: tag.data.id,
      p_is_primary: false,
    });
    expect(assigned.error).toBeNull();
    expect(assigned.data).toMatchObject({
      provenance: 'human',
      applied_by: clinicStaff.id,
      removed_at: null,
    });

    const bridged = await admin!.from('deals').select('tags').eq('id', dealA).single();
    expect(bridged.data?.tags).toContain(`Facetas ${runId}`);

    const removed = await clinicStaff.client.rpc('remove_deal_tag', {
      p_organization_id: organizationA,
      p_deal_id: dealA,
      p_tag_id: tag.data.id,
    });
    expect(removed.error).toBeNull();
    expect(removed.data.removed_by).toBe(clinicStaff.id);

    const reapplied = await clinicStaff.client.rpc('assign_deal_tag', {
      p_organization_id: organizationA,
      p_deal_id: dealA,
      p_tag_id: tag.data.id,
      p_is_primary: false,
    });
    expect(reapplied.error).toBeNull();
    expect(reapplied.data.id).not.toBe(assigned.data.id);
  });

  it('a FK composta recusa atribuição cross-tenant mesmo com service role', async () => {
    const category = await admin!.from('tag_categories').insert({
      organization_id: organizationA,
      label: `Cross ${runId}`,
    }).select('id').single();
    const tag = await admin!.from('tags').insert({
      organization_id: organizationA,
      category_id: category.data!.id,
      name: `Cross ${runId}`,
    }).select('id').single();
    expect(category.error).toBeNull();
    expect(tag.error).toBeNull();

    const crossTenant = await admin!.from('deal_tag_assignments').insert({
      organization_id: organizationB,
      deal_id: dealB,
      category_id: category.data!.id,
      tag_id: tag.data!.id,
      provenance: 'api',
      applied_at: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
    });
    expect(crossTenant.error?.code).toBe('23503');
  });
});
