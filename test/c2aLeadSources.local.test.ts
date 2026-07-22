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

describeLocal('C2A — origens auditáveis no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const runId = randomUUID();
  const password = `C2A!${runId}aA1`;
  const authUserIds: string[] = [];
  let organizationA = '';
  let organizationB = '';
  let dealA = '';
  let dealB = '';
  let contactA = '';
  let clinicAdmin: UserFixture;
  let clinicStaff: UserFixture;

  async function createUser(role: 'clinic_admin' | 'clinic_staff'): Promise<UserFixture> {
    if (!admin || !config) throw new Error('Supabase local indisponível');
    const email = `c2a.source.${role}.${runId}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error;
    authUserIds.push(created.data.user.id);
    const profile = await admin.from('profiles').upsert({
      id: created.data.user.id,
      email,
      name: `C2A source ${role}`,
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
    const organizations = await admin.from('organizations').insert([
      { name: `C2A Origem A ${runId}` },
      { name: `C2A Origem B ${runId}` },
    ]).select('id');
    if (organizations.error || organizations.data.length !== 2) throw organizations.error;
    [organizationA, organizationB] = organizations.data.map(({ id }) => id);
    clinicAdmin = await createUser('clinic_admin');
    clinicStaff = await createUser('clinic_staff');

    const contact = await admin.from('contacts').insert({
      organization_id: organizationA,
      name: `Contato origem ${runId}`,
      source: `Texto legado ${runId}`,
    }).select('id').single();
    if (contact.error) throw contact.error;
    contactA = contact.data.id;

    const deals = await admin.from('deals').insert([
      { organization_id: organizationA, title: `Deal origem A ${runId}`, contact_id: contactA },
      { organization_id: organizationB, title: `Deal origem B ${runId}` },
    ]).select('id, organization_id');
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

  it('deduplica catálogo por nome normalizado e preserva contacts.source sem backfill', async () => {
    const [first, second] = await Promise.all([
      clinicAdmin.client.rpc('get_or_create_lead_source', {
        p_organization_id: organizationA,
        p_name: ' Indicação ',
      }),
      clinicAdmin.client.rpc('get_or_create_lead_source', {
        p_organization_id: organizationA,
        p_name: 'indicacao',
      }),
    ]);
    expect([first.error, second.error]).toEqual([null, null]);
    expect(first.data.id).toBe(second.data.id);
    expect(first.data.normalized_name).toBe('indicacao');

    const [contact, history] = await Promise.all([
      admin!.from('contacts').select('source').eq('id', contactA).single(),
      admin!.from('lead_source_attributions').select('id').eq('contact_id', contactA),
    ]);
    expect(contact.data?.source).toBe(`Texto legado ${runId}`);
    expect(history.data).toEqual([]);
  });

  it('clinic_staff atribui origem idempotente, mas não edita nem exclui catálogo', async () => {
    const source = await clinicAdmin.client.rpc('get_or_create_lead_source', {
      p_organization_id: organizationA,
      p_name: `Meta Ads ${runId}`,
    });
    expect(source.error).toBeNull();

    const deniedUpdate = await clinicStaff.client.from('lead_sources')
      .update({ name: `Alterada ${runId}` })
      .eq('id', source.data.id)
      .select('id');
    expect(deniedUpdate.error).toBeNull();
    expect(deniedUpdate.data).toEqual([]);
    const deniedDelete = await clinicStaff.client.from('lead_sources')
      .delete()
      .eq('id', source.data.id)
      .select('id');
    expect(deniedDelete.error).toBeNull();
    expect(deniedDelete.data).toEqual([]);

    const idempotencyKey = `human:${runId}`;
    const payload = {
      p_organization_id: organizationA,
      p_idempotency_key: idempotencyKey,
      p_deal_id: dealA,
      p_contact_id: contactA,
      p_source_id: source.data.id,
      p_channel: 'whatsapp',
      p_utm_source: 'meta',
      p_utm_medium: 'cpc',
      p_utm_campaign: `campanha-${runId}`,
    };
    const [first, retry] = await Promise.all([
      clinicStaff.client.rpc('record_lead_source_attribution', payload),
      clinicStaff.client.rpc('record_lead_source_attribution', payload),
    ]);
    expect([first.error, retry.error]).toEqual([null, null]);
    expect(first.data.id).toBe(retry.data.id);
    expect(first.data).toMatchObject({
      source_id: source.data.id,
      attribution_state: 'known',
      provenance: 'human',
      attributed_by: clinicStaff.id,
      channel: 'whatsapp',
      utm_source: 'meta',
    });

    const deal = await admin!.from('deals')
      .select('first_lead_source_id, last_lead_source_id')
      .eq('id', dealA)
      .single();
    expect(deal.data).toMatchObject({
      first_lead_source_id: source.data.id,
      last_lead_source_id: source.data.id,
    });
  });

  it('registra desconhecida explicitamente e a FK recusa origem cross-tenant', async () => {
    const unknown = await clinicStaff.client.rpc('record_lead_source_attribution', {
      p_organization_id: organizationA,
      p_idempotency_key: `unknown:${runId}`,
      p_deal_id: dealA,
      p_contact_id: null,
      p_source_id: null,
      p_channel: 'whatsapp',
    });
    expect(unknown.error).toBeNull();
    expect(unknown.data).toMatchObject({
      source_id: null,
      attribution_state: 'unknown',
      provenance: 'human',
    });

    const source = await clinicAdmin.client.rpc('get_or_create_lead_source', {
      p_organization_id: organizationA,
      p_name: `Cross origem ${runId}`,
    });
    const crossTenant = await admin!.from('lead_source_attributions').insert({
      organization_id: organizationB,
      deal_id: dealB,
      contact_id: null,
      source_id: source.data.id,
      attribution_state: 'known',
      observed_at: new Date().toISOString(),
      channel: 'api',
      provenance: 'api',
      idempotency_key: `cross:${runId}`,
    });
    expect(crossTenant.error?.code).toBe('23503');
  });
});
