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

type Marco = { id: string; event_type: string; meta_status: string; meta_skip_reason: string | null; idempotency_key: string; contact_id: string | null };

describeLocal('3d — record_lead_replied_event (função real): região por DDD', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const runId = randomUUID();
  const password = `Regiao!${runId}aA1`;
  const authUserIds: string[] = [];
  let organizationComDdd = '';
  let organizationSemDdd = '';
  let adminA: { id: string; client: SupabaseClient };
  let contatoA = '';
  let negocioRegiao = '';
  let negocioForaRegiao = '';
  let negocioEstrangeiro = '';
  let negocioSemDdd = '';

  async function negocio(organizationId: string, contactId: string | null, title: string) {
    const res = await admin!
      .from('deals')
      .insert({ organization_id: organizationId, contact_id: contactId, title: `${title} ${runId}`, tags: [], value: 0 })
      .select('id')
      .single();
    if (res.error || !res.data) throw res.error;
    return res.data.id as string;
  }

  function chamar(client: SupabaseClient, organizationId: string, dealId: string, phone: string, contactId: string | null = null) {
    return client.rpc('record_lead_replied_event', {
      p_organization_id: organizationId,
      p_deal_id: dealId,
      p_contact_id: contactId,
      p_occurred_at: new Date().toISOString(),
      p_phone: phone,
    });
  }

  async function marcos(dealId: string): Promise<Marco[]> {
    const res = await admin!
      .from('deal_conversion_events')
      .select('id, event_type, meta_status, meta_skip_reason, idempotency_key, contact_id')
      .eq('deal_id', dealId);
    if (res.error) throw res.error;
    return res.data as Marco[];
  }

  beforeAll(async () => {
    if (!admin || !config) return;
    const organizations = await admin
      .from('organizations')
      .insert([{ name: `Regiao DDD ${runId}` }, { name: `Regiao livre ${runId}` }])
      .select('id, name');
    if (organizations.error || organizations.data.length !== 2) throw organizations.error;
    organizationComDdd = organizations.data.find((o) => o.name.startsWith('Regiao DDD'))!.id;
    organizationSemDdd = organizations.data.find((o) => o.name.startsWith('Regiao livre'))!.id;

    const cfg = await admin.from('organization_settings').upsert(
      { organization_id: organizationComDdd, conversion_region_ddds: ['22', '21'] },
      { onConflict: 'organization_id' }
    );
    if (cfg.error) throw cfg.error;

    const email = `regiao.${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error;
    authUserIds.push(created.data.user.id);
    await admin.from('profiles').upsert({
      id: created.data.user.id, email, name: 'Regiao admin', first_name: 'Regiao', role: 'clinic_admin',
      organization_id: organizationComDdd, updated_at: new Date().toISOString(),
    });
    const client = createE2UserClient(config);
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    adminA = { id: created.data.user.id, client };

    const contato = await admin.from('contacts').insert({ organization_id: organizationComDdd, name: `Lead ${runId}` }).select('id').single();
    contatoA = contato.data!.id;
    negocioRegiao = await negocio(organizationComDdd, contatoA, 'Da região');
    negocioForaRegiao = await negocio(organizationComDdd, null, 'Fora da região');
    negocioEstrangeiro = await negocio(organizationComDdd, null, 'Estrangeiro');
    negocioSemDdd = await negocio(organizationSemDdd, null, 'Cliente sem lista');
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
    if (organizationComDdd || organizationSemDdd) {
      const cleanup = await admin.from('organizations').delete().in('id', [organizationComDdd, organizationSemDdd]);
      if (cleanup.error) throw cleanup.error;
    }
  }, 120_000);

  it('DDD da lista → marco "replied" pendente para a Meta; repetir não duplica', async () => {
    const res = await chamar(admin!, organizationComDdd, negocioRegiao, '+55 (22) 99999-0000', contatoA);
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ event_type: 'replied', meta_status: 'pending', meta_skip_reason: null, contact_id: contatoA });

    const repetido = await chamar(admin!, organizationComDdd, negocioRegiao, '5522999990000', contatoA);
    expect(repetido.error).toBeNull();
    expect((repetido.data as Marco).id).toBe((res.data as Marco).id);
    expect(await marcos(negocioRegiao)).toHaveLength(1);
  });

  it('DDD fora da lista → marco nasce, mas já descartado para a Meta (conta no funil)', async () => {
    const res = await chamar(admin!, organizationComDdd, negocioForaRegiao, '5511988887777');
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ meta_status: 'skipped', meta_skip_reason: 'fora_da_regiao' });
  });

  it('número sem 55 na frente não é do Brasil: fora da região quando há lista', async () => {
    const res = await chamar(admin!, organizationComDdd, negocioEstrangeiro, '+1 305 555 0100');
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ meta_status: 'skipped', meta_skip_reason: 'fora_da_regiao' });
  });

  it('cliente sem lista de DDD: qualquer região conta', async () => {
    const res = await chamar(admin!, organizationSemDdd, negocioSemDdd, '5547911112222');
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ meta_status: 'pending', meta_skip_reason: null });
  });

  it('negócio de outra organização é recusado; anônimo e admin autenticado recebem 42501', async () => {
    const outraOrg = await chamar(admin!, organizationSemDdd, negocioRegiao, '5522999990000');
    expect(outraOrg.error?.code).toBe('23503');

    const anon = createE2UserClient(config!);
    expect((await chamar(anon, organizationComDdd, negocioRegiao, '5522999990000')).error?.code).toBe('42501');
    expect((await chamar(adminA.client, organizationComDdd, negocioRegiao, '5522999990000')).error?.code).toBe('42501');
  });
});
