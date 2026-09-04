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

// Junho/2026 no fuso de São Paulo (mesmo padrão dos RPCs financeiros).
const P_START = '2026-06-01T00:00:00-03:00';
const P_END = '2026-06-30T23:59:59.999-03:00';

type Comercial = {
  regime: string;
  fechamento: {
    ganhos: { qtd: number; valor: number };
    perdidos: { qtd: number; valor: number; motivos: Array<{ motivo: string; qtd: number }> };
    taxa_fechamento: number;
    ticket_medio: number;
    ciclo_medio_dias: number;
  };
  entrada: { leads: number; negocios: number; valor: number };
  por_origem: Array<{ origem: string; ganhos_qtd: number; ganhos_valor: number; perdidos_qtd: number }>;
  por_campanha: Array<{ campanha: string; ganhos_qtd: number; ganhos_valor: number }>;
};

describeLocal('Comercial por mês de FECHAMENTO — RPC real no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const anon = config ? createE2UserClient(config) : null;
  const runId = randomUUID();
  const password = `Com!${runId}aA1`;
  const authUserIds: string[] = [];
  let organizationA = '';
  let organizationB = '';
  let adminA: UserFixture;
  let staffA: UserFixture;
  let adminB: UserFixture;

  async function createUser(role: Role, organizationId: string): Promise<UserFixture> {
    if (!admin || !config) throw new Error('Supabase local indisponível');
    const email = `comercial.${role}.${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error;
    authUserIds.push(created.data.user.id);
    const profile = await admin.from('profiles').upsert({
      id: created.data.user.id,
      email,
      name: `Comercial ${role}`,
      first_name: 'Comercial',
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

  async function origem(organizationId: string, name: string): Promise<string> {
    const res = await admin!
      .from('lead_sources')
      .insert({
        organization_id: organizationId,
        name: `${name} ${runId}`,
        normalized_name: `${name.toLowerCase()}-${runId}`,
        code: `${name.toLowerCase()}-${runId.slice(0, 8)}`,
      })
      .select('id')
      .single();
    if (res.error || !res.data) throw res.error;
    return res.data.id;
  }

  async function negocio(params: {
    organizationId: string;
    title: string;
    value: number;
    createdAt: string;
    closedAt?: string | null;
    isWon?: boolean;
    isLost?: boolean;
    firstSourceId?: string | null;
    lossReason?: string | null;
  }): Promise<string> {
    const res = await admin!
      .from('deals')
      .insert({
        organization_id: params.organizationId,
        title: `${params.title} ${runId}`,
        tags: [],
        value: params.value,
        created_at: params.createdAt,
        closed_at: params.closedAt ?? null,
        is_won: params.isWon ?? false,
        is_lost: params.isLost ?? false,
        first_lead_source_id: params.firstSourceId ?? null,
        last_lead_source_id: params.firstSourceId ?? null,
        loss_reason: params.lossReason ?? null,
      })
      .select('id')
      .single();
    if (res.error || !res.data) throw res.error;
    return res.data.id;
  }

  async function atribuicao(params: {
    organizationId: string;
    dealId: string;
    sourceId: string;
    observedAt: string;
    channel: string;
    utmCampaign?: string | null;
    campaign?: string | null;
  }) {
    const res = await admin!.from('lead_source_attributions').insert({
      organization_id: params.organizationId,
      deal_id: params.dealId,
      source_id: params.sourceId,
      attribution_state: 'known',
      observed_at: params.observedAt,
      channel: params.channel,
      utm_campaign: params.utmCampaign ?? null,
      campaign: params.campaign ?? null,
      provenance: 'api',
      idempotency_key: randomUUID(),
    });
    if (res.error) throw res.error;
  }

  async function contato(organizationId: string, name: string, createdAt: string) {
    const res = await admin!.from('contacts').insert({
      organization_id: organizationId,
      name: `${name} ${runId}`,
      created_at: createdAt,
    });
    if (res.error) throw res.error;
  }

  beforeAll(async () => {
    if (!admin) return;
    const organizations = await admin
      .from('organizations')
      .insert([{ name: `Comercial A ${runId}` }, { name: `Comercial B ${runId}` }])
      .select('id, name');
    if (organizations.error || organizations.data.length !== 2) throw organizations.error;
    organizationA = organizations.data.find((o) => o.name.startsWith('Comercial A'))!.id;
    organizationB = organizations.data.find((o) => o.name.startsWith('Comercial B'))!.id;

    adminA = await createUser('clinic_admin', organizationA);
    staffA = await createUser('clinic_staff', organizationA);
    adminB = await createUser('clinic_admin', organizationB);

    const instagram = await origem(organizationA, 'Instagram');
    const google = await origem(organizationA, 'Google');

    // D1 — ganho em junho, veio do Instagram (1º toque) e fechou depois de uma
    //      campanha do Google (último toque) → origem Instagram, campanha promo-junho.
    const d1 = await negocio({
      organizationId: organizationA, title: 'D1 ganho', value: 1000,
      createdAt: '2026-05-20T10:00:00-03:00', closedAt: '2026-06-10T10:00:00-03:00',
      isWon: true, firstSourceId: instagram,
    });
    await atribuicao({
      organizationId: organizationA, dealId: d1, sourceId: instagram,
      observedAt: '2026-05-20T10:00:00-03:00', channel: 'instagram', campaign: 'lancamento-maio',
    });
    await atribuicao({
      organizationId: organizationA, dealId: d1, sourceId: google,
      observedAt: '2026-06-08T10:00:00-03:00', channel: 'google', utmCampaign: 'promo-junho',
    });
    // D2 — ganho em junho, Google, sem atribuição com campanha.
    await negocio({
      organizationId: organizationA, title: 'D2 ganho', value: 500,
      createdAt: '2026-06-05T10:00:00-03:00', closedAt: '2026-06-20T10:00:00-03:00',
      isWon: true, firstSourceId: google,
    });
    // D3 — perdido em junho, Instagram, motivo Preço.
    await negocio({
      organizationId: organizationA, title: 'D3 perdido', value: 800,
      createdAt: '2026-06-01T10:00:00-03:00', closedAt: '2026-06-15T10:00:00-03:00',
      isLost: true, firstSourceId: instagram, lossReason: 'Preço',
    });
    // D4 — entrou em junho, mas só fechou em JULHO: conta na entrada, não no fechamento.
    await negocio({
      organizationId: organizationA, title: 'D4 julho', value: 9000,
      createdAt: '2026-06-25T10:00:00-03:00', closedAt: '2026-07-03T10:00:00-03:00',
      isWon: true, firstSourceId: instagram,
    });
    // D5 — entrou em junho e segue aberto: só entrada.
    await negocio({
      organizationId: organizationA, title: 'D5 aberto', value: 300,
      createdAt: '2026-06-12T10:00:00-03:00',
    });
    // D7 — ganho em junho, sem origem registrada, entrou em abril (ciclo longo).
    await negocio({
      organizationId: organizationA, title: 'D7 sem origem', value: 200,
      createdAt: '2026-04-01T10:00:00-03:00', closedAt: '2026-06-28T10:00:00-03:00',
      isWon: true,
    });
    // Org B — ganho em junho, nunca pode aparecer no relatório de A.
    await negocio({
      organizationId: organizationB, title: 'B ganho', value: 7777,
      createdAt: '2026-06-02T10:00:00-03:00', closedAt: '2026-06-09T10:00:00-03:00',
      isWon: true,
    });

    await contato(organizationA, 'Lead junho 1', '2026-06-03T10:00:00-03:00');
    await contato(organizationA, 'Lead junho 2', '2026-06-15T10:00:00-03:00');
    await contato(organizationA, 'Lead maio', '2026-05-01T10:00:00-03:00');
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
    if (organizationA || organizationB) {
      const cleanup = await admin.from('organizations').delete().in('id', [organizationA, organizationB]);
      if (cleanup.error) throw cleanup.error;
    }
  }, 120_000);

  it('conta pelo mês em que FECHOU: ganhos, perdidos, taxa, ticket e ciclo de junho', async () => {
    const res = await adminA.client.rpc('get_commercial_report', { p_start: P_START, p_end: P_END });
    expect(res.error).toBeNull();
    const r = res.data as Comercial;

    expect(r.regime).toBe('fechamento');
    // D1 (1000) + D2 (500) + D7 (200); D4 fechou em julho e a org B não entra.
    expect(Number(r.fechamento.ganhos.qtd)).toBe(3);
    expect(Number(r.fechamento.ganhos.valor)).toBe(1700);
    expect(Number(r.fechamento.perdidos.qtd)).toBe(1);
    expect(Number(r.fechamento.perdidos.valor)).toBe(800);
    expect(r.fechamento.perdidos.motivos).toEqual([{ motivo: 'Preço', qtd: 1 }]);
    // 3 ganhos ÷ 4 decisões.
    expect(Number(r.fechamento.taxa_fechamento)).toBe(75);
    expect(Number(r.fechamento.ticket_medio)).toBeCloseTo(566.67, 2);
    // D1 21 dias, D2 15 dias, D7 88 dias → 41,3.
    expect(Number(r.fechamento.ciclo_medio_dias)).toBeCloseTo(41.3, 1);
  });

  it('a entrada é a coorte do mesmo mês, separada do fechamento', async () => {
    const res = await adminA.client.rpc('get_commercial_report', { p_start: P_START, p_end: P_END });
    expect(res.error).toBeNull();
    const r = res.data as Comercial;

    // Negócios criados em junho: D2, D3, D4, D5 (D1 é de maio, D7 de abril).
    expect(Number(r.entrada.negocios)).toBe(4);
    expect(Number(r.entrada.valor)).toBe(500 + 800 + 9000 + 300);
    expect(Number(r.entrada.leads)).toBe(2);
  });

  it('origem = primeiro toque; campanha = último toque (D1: Instagram × promo-junho)', async () => {
    const res = await adminA.client.rpc('get_commercial_report', { p_start: P_START, p_end: P_END });
    expect(res.error).toBeNull();
    const r = res.data as Comercial;

    const porOrigem = r.por_origem.map((o) => ({
      ...o,
      origem: o.origem.replace(` ${runId}`, ''),
      ganhos_qtd: Number(o.ganhos_qtd),
      ganhos_valor: Number(o.ganhos_valor),
      perdidos_qtd: Number(o.perdidos_qtd),
    }));
    expect(porOrigem).toEqual([
      { origem: 'Instagram', ganhos_qtd: 1, ganhos_valor: 1000, perdidos_qtd: 1 },
      { origem: 'Google', ganhos_qtd: 1, ganhos_valor: 500, perdidos_qtd: 0 },
      { origem: 'Sem origem', ganhos_qtd: 1, ganhos_valor: 200, perdidos_qtd: 0 },
    ]);

    const porCampanha = r.por_campanha.map((c) => ({
      campanha: c.campanha,
      ganhos_qtd: Number(c.ganhos_qtd),
      ganhos_valor: Number(c.ganhos_valor),
    }));
    expect(porCampanha).toEqual([
      { campanha: 'promo-junho', ganhos_qtd: 1, ganhos_valor: 1000 },
      { campanha: 'Sem campanha', ganhos_qtd: 2, ganhos_valor: 700 },
    ]);
  });

  it('gate: anônimo, staff sem reports.view e admin de OUTRA org recebem 42501', async () => {
    const semSessao = await anon!.rpc('get_commercial_report', { p_start: P_START, p_end: P_END });
    expect(semSessao.error?.code).toBe('42501');

    const staff = await staffA.client.rpc('get_commercial_report', { p_start: P_START, p_end: P_END });
    expect(staff.error?.code).toBe('42501');

    const outraOrg = await adminB.client.rpc('get_commercial_report', {
      p_start: P_START, p_end: P_END, p_organization_id: organizationA,
    });
    expect(outraOrg.error?.code).toBe('42501');
  });

  it('a conta canônica interna responde só ao service_role (caminho da planilha pública)', async () => {
    const interno = await admin!.rpc('commercial_report_data', {
      p_organization_id: organizationA, p_start: P_START, p_end: P_END,
    });
    expect(interno.error).toBeNull();
    expect(Number((interno.data as Comercial).fechamento.ganhos.valor)).toBe(1700);

    const semSessao = await anon!.rpc('commercial_report_data', {
      p_organization_id: organizationA, p_start: P_START, p_end: P_END,
    });
    expect(semSessao.error?.code).toBe('42501');

    const autenticado = await adminA.client.rpc('commercial_report_data', {
      p_organization_id: organizationA, p_start: P_START, p_end: P_END,
    });
    expect(autenticado.error?.code).toBe('42501');
  });
});
