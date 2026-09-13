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

const NOME_ORIGEM = 'Anúncio Meta (WhatsApp)';
const CODIGO_ORIGEM = 'meta_whatsapp_ad';

// Bloco real de um clique (dataset da Jéssica, 08/09/2026), só os campos que guardamos.
const clique = {
  ctwaClid: 'AfgqwIqB3-mpRoYkyPzyPoKC8f1vNZJjqFwQlDzmispEejiL5lMxOjC6uKbelx5BQGw5R',
  title: 'Seu sorriso ainda te incomoda? A ortodontia pode ajudar',
  sourceId: '120250248464550131',
  sourceUrl: 'https://www.instagram.com/p/DZ3U3KwAssH/',
  sourceApp: 'Instagram',
  mediaUrl: 'https://www.facebook.com/reel/1006666038440643/',
};

describeLocal('3a — record_whatsapp_ad_attribution (RPC real no Supabase local)', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const anon = config ? createE2UserClient(config) : null;
  const runId = randomUUID();
  const password = `Ctwa!${runId}aA1`;
  const authUserIds: string[] = [];
  const conexao = randomUUID();
  let organizationA = '';
  let organizationB = '';
  let adminA: UserFixture;
  let contatoSemOrigem = '';
  let contatoComOrigem = '';
  let negocioA1 = '';
  let negocioA2 = '';
  let negocioB = '';

  async function createUser(role: 'clinic_admin', organizationId: string): Promise<UserFixture> {
    if (!admin || !config) throw new Error('Supabase local indisponível');
    const email = `ctwa.${role}.${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error;
    authUserIds.push(created.data.user.id);
    const profile = await admin.from('profiles').upsert({
      id: created.data.user.id,
      email,
      name: `Ctwa ${role}`,
      first_name: 'Ctwa',
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

  async function contato(organizationId: string, name: string, source: string | null) {
    const res = await admin!
      .from('contacts')
      .insert({ organization_id: organizationId, name: `${name} ${runId}`, source })
      .select('id')
      .single();
    if (res.error || !res.data) throw res.error;
    return res.data.id as string;
  }

  async function negocio(organizationId: string, contactId: string | null, title: string) {
    const res = await admin!
      .from('deals')
      .insert({ organization_id: organizationId, contact_id: contactId, title: `${title} ${runId}`, tags: [], value: 0 })
      .select('id')
      .single();
    if (res.error || !res.data) throw res.error;
    return res.data.id as string;
  }

  function chamar(client: SupabaseClient, params: Record<string, unknown>) {
    return client.rpc('record_whatsapp_ad_attribution', {
      p_organization_id: organizationA,
      p_channel_connection_id: conexao,
      p_observed_at: '2026-09-13T10:00:00-03:00',
      p_ctwa_clid: clique.ctwaClid,
      p_ad_title: clique.title,
      p_ad_source_id: clique.sourceId,
      p_ad_source_url: clique.sourceUrl,
      p_ad_source_app: clique.sourceApp,
      p_ad_media_url: clique.mediaUrl,
      ...params,
    });
  }

  beforeAll(async () => {
    if (!admin) return;
    const organizations = await admin
      .from('organizations')
      .insert([{ name: `Ctwa A ${runId}` }, { name: `Ctwa B ${runId}` }])
      .select('id, name');
    if (organizations.error || organizations.data.length !== 2) throw organizations.error;
    organizationA = organizations.data.find((o) => o.name.startsWith('Ctwa A'))!.id;
    organizationB = organizations.data.find((o) => o.name.startsWith('Ctwa B'))!.id;

    adminA = await createUser('clinic_admin', organizationA);

    contatoSemOrigem = await contato(organizationA, 'Lead do anúncio', null);
    contatoComOrigem = await contato(organizationA, 'Lead indicado', 'Indicação');
    negocioA1 = await negocio(organizationA, contatoSemOrigem, 'Negócio anúncio');
    negocioA2 = await negocio(organizationA, contatoComOrigem, 'Negócio indicado');
    negocioB = await negocio(organizationB, null, 'Negócio da org B');
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
    if (organizationA || organizationB) {
      const cleanup = await admin.from('organizations').delete().in('id', [organizationA, organizationB]);
      if (cleanup.error) throw cleanup.error;
    }
  }, 120_000);

  it('grava a etiqueta e o anúncio, cria a origem canônica e aponta primeiro/último toque', async () => {
    const res = await chamar(admin!, {
      p_provider_message_id: 'msg-ad-1',
      p_deal_id: negocioA1,
      p_contact_id: contatoSemOrigem,
    });
    expect(res.error).toBeNull();
    const row = res.data as Record<string, unknown>;

    expect(row.provenance).toBe('automatic');
    expect(row.channel).toBe('whatsapp');
    expect(row.attribution_state).toBe('known');
    expect(row.ctwa_clid).toBe(clique.ctwaClid);
    expect(row.ad_source_id).toBe(clique.sourceId);
    expect(row.ad_source_app).toBe('instagram');
    expect(row.ad_title).toBe(clique.title);
    // O título do anúncio vira "campanha": é o que o relatório comercial já agrupa.
    expect(row.campaign).toBe(clique.title);
    expect(row.idempotency_key).toBe(`ctwa:${conexao}:msg-ad-1`);
    expect(row.attributed_by).toBeNull();

    const origem = await admin!
      .from('lead_sources')
      .select('id, name, code, active, archived_at')
      .eq('organization_id', organizationA)
      .eq('code', CODIGO_ORIGEM);
    expect(origem.error).toBeNull();
    expect(origem.data).toHaveLength(1);
    expect(origem.data![0]).toMatchObject({ name: NOME_ORIGEM, active: true, archived_at: null });
    expect(row.source_id).toBe(origem.data![0].id);

    const deal = await admin!
      .from('deals')
      .select('first_lead_source_id, last_lead_source_id')
      .eq('id', negocioA1)
      .single();
    expect(deal.data).toEqual({
      first_lead_source_id: origem.data![0].id,
      last_lead_source_id: origem.data![0].id,
    });

    // Ponte 7c: o contato sem origem ganha o nome da origem.
    const contact = await admin!.from('contacts').select('source').eq('id', contatoSemOrigem).single();
    expect(contact.data?.source).toBe(NOME_ORIGEM);
  });

  it('reenvio da mesma mensagem é idempotente: mesma linha, nada duplicado', async () => {
    const primeira = await chamar(admin!, {
      p_provider_message_id: 'msg-ad-1',
      p_deal_id: negocioA1,
      p_contact_id: contatoSemOrigem,
    });
    expect(primeira.error).toBeNull();

    const linhas = await admin!
      .from('lead_source_attributions')
      .select('id')
      .eq('organization_id', organizationA)
      .eq('deal_id', negocioA1);
    expect(linhas.data).toHaveLength(1);
    expect((primeira.data as { id: string }).id).toBe(linhas.data![0].id);
  });

  it('segundo clique por outro anúncio vira novo toque: primeiro toque fica, campanha muda', async () => {
    const res = await chamar(admin!, {
      p_provider_message_id: 'msg-ad-2',
      p_deal_id: negocioA1,
      p_contact_id: contatoSemOrigem,
      p_ctwa_clid: 'AfgOutroClique',
      p_ad_title: 'Vagas limitadas para casos de facetas em resina',
      p_ad_source_id: '120241355317310131',
    });
    expect(res.error).toBeNull();
    expect((res.data as { campaign: string }).campaign).toBe('Vagas limitadas para casos de facetas em resina');

    const linhas = await admin!
      .from('lead_source_attributions')
      .select('id, ctwa_clid')
      .eq('organization_id', organizationA)
      .eq('deal_id', negocioA1)
      .order('observed_at');
    expect(linhas.data).toHaveLength(2);

    const origens = await admin!
      .from('lead_sources')
      .select('id')
      .eq('organization_id', organizationA)
      .eq('code', CODIGO_ORIGEM);
    // Continua UMA origem canônica por organização.
    expect(origens.data).toHaveLength(1);
  });

  it('não sobrescreve a origem que um humano já escolheu no contato', async () => {
    const res = await chamar(admin!, {
      p_provider_message_id: 'msg-ad-3',
      p_deal_id: negocioA2,
      p_contact_id: contatoComOrigem,
    });
    expect(res.error).toBeNull();

    const contact = await admin!.from('contacts').select('source').eq('id', contatoComOrigem).single();
    expect(contact.data?.source).toBe('Indicação');
  });

  it('origem arquivada por alguém é reativada em vez de engolir o clique', async () => {
    const arquivar = await admin!
      .from('lead_sources')
      .update({ active: false })
      .eq('organization_id', organizationA)
      .eq('code', CODIGO_ORIGEM);
    expect(arquivar.error).toBeNull();

    const res = await chamar(admin!, {
      p_provider_message_id: 'msg-ad-4',
      p_deal_id: negocioA1,
      p_contact_id: contatoSemOrigem,
    });
    expect(res.error).toBeNull();

    const origem = await admin!
      .from('lead_sources')
      .select('active, archived_at')
      .eq('organization_id', organizationA)
      .eq('code', CODIGO_ORIGEM)
      .single();
    expect(origem.data).toEqual({ active: true, archived_at: null });
  });

  it('só o servidor chama: anônimo e administrador autenticado recebem 42501', async () => {
    const semLogin = await chamar(anon!, {
      p_provider_message_id: 'msg-anon',
      p_deal_id: negocioA1,
      p_contact_id: contatoSemOrigem,
    });
    expect(semLogin.error?.code).toBe('42501');

    const comLogin = await chamar(adminA.client, {
      p_provider_message_id: 'msg-auth',
      p_deal_id: negocioA1,
      p_contact_id: contatoSemOrigem,
    });
    expect(comLogin.error?.code).toBe('42501');

    const linhas = await admin!
      .from('lead_source_attributions')
      .select('id')
      .eq('organization_id', organizationA)
      .in('idempotency_key', [`ctwa:${conexao}:msg-anon`, `ctwa:${conexao}:msg-auth`]);
    expect(linhas.data).toHaveLength(0);
  });

  it('sem etiqueta e sem id do anúncio não há o que atribuir (22023); negócio de outra org é recusado (23503)', async () => {
    const vazio = await chamar(admin!, {
      p_provider_message_id: 'msg-vazio',
      p_deal_id: negocioA1,
      p_contact_id: contatoSemOrigem,
      p_ctwa_clid: '   ',
      p_ad_source_id: null,
    });
    expect(vazio.error?.code).toBe('22023');

    const outraOrg = await chamar(admin!, {
      p_provider_message_id: 'msg-org-b',
      p_deal_id: negocioB,
      p_contact_id: null,
    });
    expect(outraOrg.error?.code).toBe('23503');
  });
});
