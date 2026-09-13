// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createE2AdminClient,
  createE2UserClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';
import { dispatchPendingConversionEvents } from '../lib/meta/conversionDispatch';

const config = loadE2SupabaseConfig();
const describeLocal = config ? describe : describe.skip;

type UserFixture = { id: string; client: SupabaseClient };
type Marco = { id: string; event_type: string; meta_status: string; meta_attempts: number; meta_skip_reason: string | null; meta_last_error: string | null; meta_sent_at: string | null; meta_lease_until: string | null; meta_event_id: string };

const CTWA = 'AfgqwIqB3-mpRoYkyPzyPoKC8f1vNZJjqFwQlDzmispEejiL5lMxOjC6uKbelx5BQGw5R';

function respostaMeta(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describeLocal('3c — despacho dos marcos à Meta (funções reais + rede simulada)', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const runId = randomUUID();
  const password = `Meta!${runId}aA1`;
  const authUserIds: string[] = [];
  let organizationA = '';
  let organizationDesligada = '';
  let adminA: UserFixture;
  let contatoComClique = '';
  let contatoSemClique = '';
  let negocioComClique = '';
  let negocioSemClique = '';
  let negocioAntigo = '';
  let negocioDesligado = '';

  async function createUser(organizationId: string): Promise<UserFixture> {
    if (!admin || !config) throw new Error('Supabase local indisponível');
    const email = `meta.${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error;
    authUserIds.push(created.data.user.id);
    const profile = await admin.from('profiles').upsert({
      id: created.data.user.id, email, name: 'Meta admin', first_name: 'Meta', role: 'clinic_admin',
      organization_id: organizationId, updated_at: new Date().toISOString(),
    });
    if (profile.error) throw profile.error;
    const client = createE2UserClient(config);
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return { id: created.data.user.id, client };
  }

  async function contato(organizationId: string, name: string) {
    const res = await admin!.from('contacts').insert({ organization_id: organizationId, name: `${name} ${runId}` }).select('id').single();
    if (res.error || !res.data) throw res.error;
    return res.data.id as string;
  }

  async function negocio(organizationId: string, contactId: string | null, title: string, value = 0) {
    const res = await admin!
      .from('deals')
      .insert({ organization_id: organizationId, contact_id: contactId, title: `${title} ${runId}`, tags: [], value })
      .select('id')
      .single();
    if (res.error || !res.data) throw res.error;
    return res.data.id as string;
  }

  async function cliqueNoNegocio(organizationId: string, dealId: string, contactId: string, observedAt: string) {
    const res = await admin!.rpc('record_whatsapp_ad_attribution', {
      p_organization_id: organizationId,
      p_channel_connection_id: randomUUID(),
      p_provider_message_id: `msg-${randomUUID()}`,
      p_observed_at: observedAt,
      p_deal_id: dealId,
      p_contact_id: contactId,
      p_ctwa_clid: CTWA,
      p_ad_title: 'Anúncio de teste',
      p_ad_source_id: '120250248464550131',
    });
    if (res.error) throw res.error;
  }

  async function ganhar(dealId: string, closedAt: string) {
    const res = await admin!.from('deals').update({ is_won: true, closed_at: closedAt }).eq('id', dealId);
    if (res.error) throw res.error;
  }

  async function marcos(dealId: string): Promise<Marco[]> {
    const res = await admin!
      .from('deal_conversion_events')
      .select('id, event_type, meta_status, meta_attempts, meta_skip_reason, meta_last_error, meta_sent_at, meta_lease_until, meta_event_id')
      .eq('deal_id', dealId)
      .order('created_at');
    if (res.error) throw res.error;
    return res.data as Marco[];
  }

  beforeAll(async () => {
    if (!admin) return;
    const organizations = await admin
      .from('organizations')
      .insert([{ name: `Meta A ${runId}` }, { name: `Meta desligada ${runId}` }])
      .select('id, name');
    if (organizations.error || organizations.data.length !== 2) throw organizations.error;
    organizationA = organizations.data.find((o) => o.name.startsWith('Meta A'))!.id;
    organizationDesligada = organizations.data.find((o) => o.name.startsWith('Meta desligada'))!.id;
    adminA = await createUser(organizationA);

    const cfg = await admin.from('organization_settings').upsert([
      {
        organization_id: organizationA,
        meta_capi_enabled: true,
        meta_capi_dataset_id: '9999888877776666',
        meta_capi_access_token: `EAAB-token-${runId}`,
        meta_capi_test_event_code: 'TEST42',
        meta_capi_send_value: true,
        meta_capi_event_map: { replied: 'LeadSubmitted', scheduled: 'QualifiedLead', attended: null, won: 'Purchase' },
      },
      // Num upsert de várias linhas o PostgREST manda todas as colunas: as ausentes viram null.
      {
        organization_id: organizationDesligada,
        meta_capi_enabled: false,
        meta_capi_dataset_id: '1',
        meta_capi_access_token: 't',
        meta_capi_test_event_code: null,
        meta_capi_send_value: false,
        meta_capi_event_map: { replied: 'LeadSubmitted', scheduled: 'QualifiedLead', attended: null, won: 'Purchase' },
      },
    ], { onConflict: 'organization_id' });
    if (cfg.error) throw cfg.error;

    contatoComClique = await contato(organizationA, 'Com clique');
    contatoSemClique = await contato(organizationA, 'Sem clique');
    negocioComClique = await negocio(organizationA, contatoComClique, 'Com clique', 1500);
    negocioSemClique = await negocio(organizationA, contatoSemClique, 'Sem clique', 300);
    negocioAntigo = await negocio(organizationA, contatoComClique, 'Antigo', 900);
    negocioDesligado = await negocio(organizationDesligada, null, 'Desligado', 100);

    await cliqueNoNegocio(organizationA, negocioComClique, contatoComClique, new Date(Date.now() - 2 * 86400_000).toISOString());
    await cliqueNoNegocio(organizationA, negocioAntigo, contatoComClique, new Date(Date.now() - 30 * 86400_000).toISOString());
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
    if (organizationA || organizationDesligada) {
      const cleanup = await admin.from('organizations').delete().in('id', [organizationA, organizationDesligada]);
      if (cleanup.error) throw cleanup.error;
    }
  }, 120_000);

  it('ganho com etiqueta dentro da janela vai à Meta como Purchase com valor, e fica "sent" com o id único', async () => {
    await ganhar(negocioComClique, new Date(Date.now() - 3600_000).toISOString());
    // A rede simulada entra SÓ por fetchImpl: o supabase-js usa o fetch global, e um stub
    // global responderia às chamadas do banco com JSON da Meta (foi o que quebrou a 1ª rodada).
    const fetchMock = vi.fn(async () => respostaMeta(200, { events_received: 1, fbtrace_id: 'fb1' }));

    const resumo = await dispatchPendingConversionEvents({ admin: admin!, fetchImpl: fetchMock as unknown as typeof fetch });
    expect(resumo.sent).toBeGreaterThanOrEqual(1);

    const [won] = (await marcos(negocioComClique)).filter((m) => m.event_type === 'won');
    expect(won.meta_status).toBe('sent');
    expect(won.meta_sent_at).not.toBeNull();
    expect(won.meta_lease_until).toBeNull();
    expect(won.meta_attempts).toBe(1);

    const chamada = fetchMock.mock.calls.find((c) => String(JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).data[0].event_id) === won.meta_event_id);
    expect(chamada).toBeTruthy();
    const [url, init] = chamada as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/9999888877776666/events');
    const body = JSON.parse(String(init.body));
    expect(body.access_token).toBe(`EAAB-token-${runId}`);
    expect(body.test_event_code).toBe('TEST42');
    expect(body.data[0]).toMatchObject({
      event_name: 'Purchase',
      event_id: won.meta_event_id,
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: { ctwa_clid: CTWA },
      custom_data: { currency: 'BRL', value: 1500 },
    });
    // Nada além disso sai: sem telefone, nome ou título do anúncio.
    expect(Object.keys(body.data[0].user_data)).toEqual(['ctwa_clid']);
  });

  it('já enviado não vai de novo: segundo despacho não chama a rede para o mesmo marco', async () => {
    const fetchMock = vi.fn(async () => respostaMeta(200, { events_received: 1 }));
    const resumo = await dispatchPendingConversionEvents({ admin: admin!, fetchImpl: fetchMock as unknown as typeof fetch });
    const [won] = (await marcos(negocioComClique)).filter((m) => m.event_type === 'won');
    expect(won.meta_status).toBe('sent');
    expect(won.meta_attempts).toBe(1);
    const ids = fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).data[0].event_id);
    expect(ids).not.toContain(won.meta_event_id);
    expect(resumo.claimed).toBe(resumo.sent + resumo.skipped + resumo.retried + resumo.failed);
  });

  it('sem etiqueta do clique → skipped "sem_etiqueta"; clique de 30 dias → "clique_fora_da_janela"; nada vai à rede', async () => {
    await ganhar(negocioSemClique, new Date().toISOString());
    await ganhar(negocioAntigo, new Date().toISOString());
    const fetchMock = vi.fn(async () => respostaMeta(200, { events_received: 1 }));

    await dispatchPendingConversionEvents({ admin: admin!, fetchImpl: fetchMock as unknown as typeof fetch });

    const [semEtiqueta] = (await marcos(negocioSemClique)).filter((m) => m.event_type === 'won');
    expect(semEtiqueta).toMatchObject({ meta_status: 'skipped', meta_skip_reason: 'sem_etiqueta' });
    const [antigo] = (await marcos(negocioAntigo)).filter((m) => m.event_type === 'won');
    expect(antigo).toMatchObject({ meta_status: 'skipped', meta_skip_reason: 'clique_fora_da_janela' });
    const ids = fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).data[0].event_id);
    expect(ids).not.toContain(semEtiqueta.meta_event_id);
    expect(ids).not.toContain(antigo.meta_event_id);
  });

  it('marco mais velho que 7 dias → "fora_da_janela"; cliente com envio desligado nem é reservado', async () => {
    await ganhar(negocioDesligado, new Date().toISOString());
    const velho = await negocio(organizationA, contatoComClique, 'Velho', 50);
    await ganhar(velho, new Date(Date.now() - 10 * 86400_000).toISOString());
    const fetchMock = vi.fn(async () => respostaMeta(200, { events_received: 1 }));

    await dispatchPendingConversionEvents({ admin: admin!, fetchImpl: fetchMock as unknown as typeof fetch });

    const [foraDaJanela] = (await marcos(velho)).filter((m) => m.event_type === 'won');
    expect(foraDaJanela).toMatchObject({ meta_status: 'skipped', meta_skip_reason: 'fora_da_janela' });
    const [desligado] = (await marcos(negocioDesligado)).filter((m) => m.event_type === 'won');
    expect(desligado).toMatchObject({ meta_status: 'pending', meta_attempts: 0 });
  });

  it('erro transitório (503) volta para pending com espera e conta a tentativa; token inválido (190) vira error', async () => {
    const transitorio = await negocio(organizationA, contatoComClique, 'Transitório', 10);
    await ganhar(transitorio, new Date().toISOString());
    const fetch503 = vi.fn(async () => respostaMeta(503, { error: { message: 'Service temporarily unavailable', code: 2 } }));
    await dispatchPendingConversionEvents({ admin: admin!, fetchImpl: fetch503 as unknown as typeof fetch });
    const [pend] = (await marcos(transitorio)).filter((m) => m.event_type === 'won');
    expect(pend).toMatchObject({ meta_status: 'pending', meta_attempts: 1 });
    expect(pend.meta_last_error).toContain('503');
    expect(pend.meta_lease_until).not.toBeNull();
    expect(new Date(pend.meta_lease_until!).getTime()).toBeGreaterThan(Date.now() + 200_000);

    // Enquanto a espera vale, outro despacho não pega o marco.
    const fetchNunca = vi.fn(async () => respostaMeta(200, { events_received: 1 }));
    await dispatchPendingConversionEvents({ admin: admin!, fetchImpl: fetchNunca as unknown as typeof fetch });
    const ids = fetchNunca.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).data[0].event_id);
    expect(ids).not.toContain(pend.meta_event_id);

    // Token inválido: permanente.
    const permanente = await negocio(organizationA, contatoComClique, 'Permanente', 10);
    await ganhar(permanente, new Date().toISOString());
    const fetch190 = vi.fn(async () => respostaMeta(400, { error: { message: 'Invalid OAuth access token', code: 190 } }));
    await dispatchPendingConversionEvents({ admin: admin!, fetchImpl: fetch190 as unknown as typeof fetch });
    const [err] = (await marcos(permanente)).filter((m) => m.event_type === 'won');
    expect(err).toMatchObject({ meta_status: 'error', meta_attempts: 1 });
    expect(err.meta_last_error).toContain('190');
  });

  it('o navegador do admin não lê o token da Meta, mas lê o resto da configuração; anônimo não reserva nada', async () => {
    const semToken = await adminA.client
      .from('organization_settings')
      .select('meta_capi_enabled, meta_capi_dataset_id, meta_capi_event_map')
      .eq('organization_id', organizationA)
      .single();
    expect(semToken.error).toBeNull();
    expect(semToken.data).toMatchObject({ meta_capi_enabled: true, meta_capi_dataset_id: '9999888877776666' });

    const comToken = await adminA.client
      .from('organization_settings')
      .select('meta_capi_access_token')
      .eq('organization_id', organizationA)
      .single();
    expect(comToken.error?.code).toBe('42501');

    const anon = createE2UserClient(config!);
    const reserva = await anon.rpc('claim_conversion_events', { p_batch_limit: 10 });
    expect(reserva.error?.code).toBe('42501');
    const conclui = await adminA.client.rpc('complete_conversion_event', {
      p_organization_id: organizationA, p_event_id: randomUUID(), p_status: 'sent',
    });
    expect(conclui.error?.code).toBe('42501');
  });
});
