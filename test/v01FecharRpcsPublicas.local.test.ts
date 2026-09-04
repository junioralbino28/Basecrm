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
type Role = 'clinic_admin' | 'clinic_staff';

describeLocal('V-01 — RPCs de negócio e de rate limit no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  // Cliente com a chave pública e SEM sessão: é exatamente o role `anon`
  // que o front-end expõe a qualquer visitante.
  const anon = config ? createE2UserClient(config) : null;
  const runId = randomUUID();
  const password = `V01!${runId}aA1`;
  const authUserIds: string[] = [];
  let organizationA = '';
  let organizationB = '';
  let dealA = '';
  let adminA: UserFixture;
  let staffA: UserFixture;
  let adminB: UserFixture;

  async function createUser(role: Role, organizationId: string): Promise<UserFixture> {
    if (!admin || !config) throw new Error('Supabase local indisponível');
    const email = `v01.${role}.${randomUUID()}@example.com`;
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
      name: `V01 ${role}`,
      first_name: 'V01',
      role,
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    });
    if (profile.error) throw profile.error;
    const client = createE2UserClient(config);
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return { id: created.data.user.id, client };
  }

  async function estadoDoNegocio() {
    const res = await admin!
      .from('deals')
      .select('is_won, is_lost, closed_at, loss_reason')
      .eq('id', dealA)
      .single();
    if (res.error) throw res.error;
    return res.data;
  }

  beforeAll(async () => {
    if (!admin) return;
    const organizations = await admin
      .from('organizations')
      .insert([{ name: `V01 Org A ${runId}` }, { name: `V01 Org B ${runId}` }])
      .select('id, name');
    if (organizations.error || organizations.data.length !== 2) throw organizations.error;
    organizationA = organizations.data.find((o) => o.name.startsWith('V01 Org A'))!.id;
    organizationB = organizations.data.find((o) => o.name.startsWith('V01 Org B'))!.id;

    adminA = await createUser('clinic_admin', organizationA);
    staffA = await createUser('clinic_staff', organizationA);
    adminB = await createUser('clinic_admin', organizationB);

    const deal = await admin
      .from('deals')
      .insert({ organization_id: organizationA, title: `V01 negócio ${runId}`, tags: [] })
      .select('id')
      .single();
    if (deal.error || !deal.data) throw deal.error;
    dealA = deal.data.id;
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

  it('sem sessão, o role público recebe 42501 e o negócio não muda', async () => {
    const chamadas: Array<[string, Record<string, unknown>]> = [
      ['mark_deal_won', { deal_id: dealA }],
      ['mark_deal_lost', { deal_id: dealA, reason: 'tentativa anônima' }],
      ['reopen_deal', { deal_id: dealA }],
    ];
    for (const [fn, args] of chamadas) {
      const res = await anon!.rpc(fn, args);
      expect(res.error?.code, fn).toBe('42501');
    }
    expect(await estadoDoNegocio()).toMatchObject({
      is_won: false,
      is_lost: false,
      closed_at: null,
      loss_reason: null,
    });
  });

  it('usuário autenticado de OUTRA organização recebe 42501 e o negócio não muda', async () => {
    const won = await adminB.client.rpc('mark_deal_won', { deal_id: dealA });
    expect(won.error?.code).toBe('42501');
    const lost = await adminB.client.rpc('mark_deal_lost', { deal_id: dealA, reason: 'invasão' });
    expect(lost.error?.code).toBe('42501');
    expect(await estadoDoNegocio()).toMatchObject({ is_won: false, is_lost: false, closed_at: null });
  });

  it('negócio inexistente recebe o mesmo 42501, sem sondagem de existência', async () => {
    const res = await adminA.client.rpc('mark_deal_won', { deal_id: randomUUID() });
    expect(res.error?.code).toBe('42501');
  });

  it('quem opera a organização marca ganho, perdido e reabre — como a policy de deals já permitia', async () => {
    const won = await adminA.client.rpc('mark_deal_won', { deal_id: dealA });
    expect(won.error).toBeNull();
    let estado = await estadoDoNegocio();
    expect(estado.is_won).toBe(true);
    expect(estado.is_lost).toBe(false);
    expect(estado.closed_at).not.toBeNull();

    // clinic_staff também opera a organização (mesmo conjunto de can_operate_organization).
    const lost = await staffA.client.rpc('mark_deal_lost', { deal_id: dealA, reason: 'Preço' });
    expect(lost.error).toBeNull();
    estado = await estadoDoNegocio();
    expect(estado).toMatchObject({ is_won: false, is_lost: true, loss_reason: 'Preço' });

    const reopened = await adminA.client.rpc('reopen_deal', { deal_id: dealA });
    expect(reopened.error).toBeNull();
    estado = await estadoDoNegocio();
    expect(estado).toMatchObject({ is_won: false, is_lost: false, closed_at: null });
  });

  it('cleanup_rate_limits só responde ao service_role', async () => {
    const semSessao = await anon!.rpc('cleanup_rate_limits', { older_than_minutes: 0 });
    expect(semSessao.error?.code).toBe('42501');

    const autenticado = await adminA.client.rpc('cleanup_rate_limits', { older_than_minutes: 0 });
    expect(autenticado.error?.code).toBe('42501');

    const interno = await admin!.rpc('cleanup_rate_limits', { older_than_minutes: 60 * 24 * 365 });
    expect(interno.error).toBeNull();
    expect(typeof interno.data).toBe('number');
  });
});
