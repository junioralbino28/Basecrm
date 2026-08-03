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

/**
 * Catálogos de cargo e especialidade (`job_roles`, `specialties`).
 *
 * Existe por causa de um bug real (2026-07-24): a migration criou as tabelas com
 * RLS mas SEM `GRANT`. RLS só RESTRINGE — não concede. O Postgres devolvia
 * "permission denied for table job_roles" antes de olhar a policy, e a tela
 * quebrava. Nenhum teste de unidade pegaria isso: só uma chamada REAL de usuário
 * autenticado pega.
 */
describeLocal('Catálogos da equipe — cargo e especialidade no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const runId = randomUUID();
  const password = `Cat!${runId}aA1`;
  const authUserIds: string[] = [];
  let organizationA = '';
  let organizationB = '';
  let clinicAdmin: UserFixture;

  async function createAdminUser(orgId: string): Promise<UserFixture> {
    if (!admin || !config) throw new Error('Supabase local indisponível');
    const email = `catalogo.admin.${runId}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error;
    authUserIds.push(created.data.user.id);
    const profile = await admin.from('profiles').upsert({
      id: created.data.user.id,
      email,
      name: 'Catálogo admin',
      first_name: 'Catalogo',
      role: 'clinic_admin',
      organization_id: orgId,
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
    const orgs = await admin.from('organizations').insert([
      { name: `Catálogo A ${runId}` },
      { name: `Catálogo B ${runId}` },
    ]).select('id, name');
    if (orgs.error) throw orgs.error;
    organizationA = orgs.data.find((o) => o.name.includes('A'))!.id;
    organizationB = orgs.data.find((o) => o.name.includes('B'))!.id;
    clinicAdmin = await createAdminUser(organizationA);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('job_roles').delete().in('organization_id', [organizationA, organizationB]);
    await admin.from('specialties').delete().in('organization_id', [organizationA, organizationB]);
    await admin.from('profiles').delete().in('id', authUserIds);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
    await admin.from('organizations').delete().in('id', [organizationA, organizationB]);
  });

  it('admin cria e lê cargo (o GRANT existe — regressão do "permission denied")', async (ctx) => {
    if (!admin) return ctx.skip();
    const inserido = await clinicAdmin.client
      .from('job_roles')
      .insert({ organization_id: organizationA, name: `Secretária ${runId}` })
      .select('id, name')
      .single();
    expect(inserido.error).toBeNull();
    expect(inserido.data?.name).toContain('Secretária');

    const lidos = await clinicAdmin.client.from('job_roles').select('id, name');
    expect(lidos.error).toBeNull();
    expect((lidos.data || []).length).toBeGreaterThan(0);
  });

  it('admin cria e lê especialidade', async (ctx) => {
    if (!admin) return ctx.skip();
    const inserido = await clinicAdmin.client
      .from('specialties')
      .insert({ organization_id: organizationA, name: `Ortodontia ${runId}` })
      .select('id, name')
      .single();
    expect(inserido.error).toBeNull();

    const lidos = await clinicAdmin.client.from('specialties').select('id, name');
    expect(lidos.error).toBeNull();
    expect((lidos.data || []).length).toBeGreaterThan(0);
  });

  it('recusa nome repetido só por diferença de caixa/espaço', async (ctx) => {
    if (!admin) return ctx.skip();
    const nome = `Comercial ${runId}`;
    const primeiro = await clinicAdmin.client
      .from('job_roles')
      .insert({ organization_id: organizationA, name: nome });
    expect(primeiro.error).toBeNull();

    // É o ponto do catálogo: "Comercial" e " comercial " não podem coexistir,
    // senão o agrupamento por cargo racha em dois.
    const repetido = await clinicAdmin.client
      .from('job_roles')
      .insert({ organization_id: organizationA, name: `  ${nome.toLowerCase()}  ` });
    expect(repetido.error).not.toBeNull();
  });

  it('não enxerga nem escreve catálogo de outra clínica', async (ctx) => {
    if (!admin) return ctx.skip();
    await admin.from('specialties').insert({
      organization_id: organizationB,
      name: `Segredo B ${runId}`,
    });

    const lidos = await clinicAdmin.client.from('specialties').select('id, organization_id');
    expect(lidos.error).toBeNull();
    expect((lidos.data || []).every((r) => r.organization_id === organizationA)).toBe(true);

    const invasao = await clinicAdmin.client
      .from('job_roles')
      .insert({ organization_id: organizationB, name: `Invasor ${runId}` });
    expect(invasao.error).not.toBeNull();
  });

  it('arquiva especialidade e bloqueia DELETE direto sem perder vínculos', async (ctx) => {
    if (!admin) return ctx.skip();

    const especialidade = await admin
      .from('specialties')
      .insert({ organization_id: organizationA, name: `Arquivo ${runId}` })
      .select('id')
      .single();
    if (especialidade.error) throw especialidade.error;

    const profissional = await admin
      .from('professionals')
      .insert({ organization_id: organizationA, name: `Arquivo ${runId}`, active: true })
      .select('id')
      .single();
    if (profissional.error) throw profissional.error;

    const produto = await admin
      .from('products')
      .insert({ organization_id: organizationA, name: `Arquivo ${runId}`, price: 100 })
      .select('id')
      .single();
    if (produto.error) throw produto.error;

    const specialtyId = especialidade.data.id;
    const professionalId = profissional.data.id;
    const productId = produto.data.id;
    const links = await admin.from('professional_specialties').insert({
      organization_id: organizationA,
      professional_id: professionalId,
      specialty_id: specialtyId,
    });
    if (links.error) throw links.error;
    const products = await admin.from('specialty_products').insert({
      organization_id: organizationA,
      specialty_id: specialtyId,
      product_id: productId,
    });
    if (products.error) throw products.error;

    const hardDelete = await clinicAdmin.client
      .from('specialties')
      .delete()
      .eq('id', specialtyId);
    expect(hardDelete.error?.code).toBe('42501');

    const archive = await clinicAdmin.client
      .from('specialties')
      .update({ active: false })
      .eq('id', specialtyId)
      .select('id, active')
      .single();
    expect(archive.error).toBeNull();
    expect(archive.data?.active).toBe(false);

    const professionalLinks = await admin
      .from('professional_specialties')
      .select('id', { count: 'exact', head: true })
      .eq('professional_id', professionalId)
      .eq('specialty_id', specialtyId);
    const productLinks = await admin
      .from('specialty_products')
      .select('id', { count: 'exact', head: true })
      .eq('specialty_id', specialtyId)
      .eq('product_id', productId);
    expect(professionalLinks.count).toBe(1);
    expect(productLinks.count).toBe(1);
  });
});
