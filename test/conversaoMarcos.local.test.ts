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
type Evento = {
  id: string;
  deal_id: string;
  contact_id: string | null;
  appointment_id: string | null;
  event_type: string;
  occurred_at: string;
  source: string;
  value: number | null;
  meta_status: string;
  meta_event_id: string;
  idempotency_key: string;
};

describeLocal('3b — marcos de conversão nascem sozinhos da agenda e do ganho (gatilhos reais)', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const runId = randomUUID();
  const password = `Marco!${runId}aA1`;
  const authUserIds: string[] = [];
  let organizationA = '';
  let organizationB = '';
  let adminA: UserFixture;
  let contatoA = '';
  let negocioAberto = '';
  let negocioAntigo = '';
  let negocioB = '';

  async function createUser(organizationId: string): Promise<UserFixture> {
    if (!admin || !config) throw new Error('Supabase local indisponível');
    const email = `marcos.${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error;
    authUserIds.push(created.data.user.id);
    const profile = await admin.from('profiles').upsert({
      id: created.data.user.id,
      email,
      name: 'Marcos admin',
      first_name: 'Marcos',
      role: 'clinic_admin',
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    });
    if (profile.error) throw profile.error;
    const client = createE2UserClient(config);
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return { id: created.data.user.id, client };
  }

  async function negocio(organizationId: string, contactId: string | null, title: string, extra: Record<string, unknown> = {}) {
    const res = await admin!
      .from('deals')
      .insert({ organization_id: organizationId, contact_id: contactId, title: `${title} ${runId}`, tags: [], value: 0, ...extra })
      .select('id')
      .single();
    if (res.error || !res.data) throw res.error;
    return res.data.id as string;
  }

  async function consulta(organizationId: string, contactId: string | null, startsAt: string, extra: Record<string, unknown> = {}) {
    const res = await admin!
      .from('appointments')
      .insert({ organization_id: organizationId, contact_id: contactId, starts_at: startsAt, status: 'agendado', source: 'manual', ...extra })
      .select('id, deal_id')
      .single();
    if (res.error || !res.data) throw res.error;
    return res.data as { id: string; deal_id: string | null };
  }

  async function eventos(dealId: string): Promise<Evento[]> {
    const res = await admin!
      .from('deal_conversion_events')
      .select('id, deal_id, contact_id, appointment_id, event_type, occurred_at, source, value, meta_status, meta_event_id, idempotency_key')
      .eq('deal_id', dealId)
      .order('created_at');
    if (res.error) throw res.error;
    return res.data as Evento[];
  }

  beforeAll(async () => {
    if (!admin) return;
    const organizations = await admin
      .from('organizations')
      .insert([{ name: `Marcos A ${runId}` }, { name: `Marcos B ${runId}` }])
      .select('id, name');
    if (organizations.error || organizations.data.length !== 2) throw organizations.error;
    organizationA = organizations.data.find((o) => o.name.startsWith('Marcos A'))!.id;
    organizationB = organizations.data.find((o) => o.name.startsWith('Marcos B'))!.id;
    adminA = await createUser(organizationA);

    const contato = await admin.from('contacts').insert({ organization_id: organizationA, name: `Paciente ${runId}` }).select('id').single();
    if (contato.error || !contato.data) throw contato.error;
    contatoA = contato.data.id;

    // Dois negócios abertos do mesmo contato: o mais recente (updated_at) é o que a agenda deve apontar.
    negocioAntigo = await negocio(organizationA, contatoA, 'Antigo', { updated_at: '2026-08-01T10:00:00-03:00' });
    negocioAberto = await negocio(organizationA, contatoA, 'Aberto', { updated_at: '2026-09-10T10:00:00-03:00', value: 1500 });
    negocioB = await negocio(organizationB, null, 'Org B');
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
    if (organizationA || organizationB) {
      const cleanup = await admin.from('organizations').delete().in('id', [organizationA, organizationB]);
      if (cleanup.error) throw cleanup.error;
    }
  }, 120_000);

  it('consulta criada para o contato aponta o negócio aberto mais recente e gera "agendou"', async () => {
    const c = await consulta(organizationA, contatoA, '2026-09-20T14:00:00-03:00');
    expect(c.deal_id).toBe(negocioAberto);

    const evs = await eventos(negocioAberto);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      event_type: 'scheduled',
      appointment_id: c.id,
      contact_id: contatoA,
      source: 'agenda',
      meta_status: 'pending',
      idempotency_key: `scheduled:${c.id}`,
    });
    expect(evs[0].meta_event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await eventos(negocioAntigo)).toHaveLength(0);
  });

  it('"compareceu" gera o marco na hora da consulta; voltar atrás antes do envio o descarta', async () => {
    const c = await consulta(organizationA, contatoA, '2026-09-21T09:30:00-03:00');
    const compareceu = await admin!.from('appointments').update({ status: 'compareceu' }).eq('id', c.id);
    expect(compareceu.error).toBeNull();

    let evs = (await eventos(negocioAberto)).filter((e) => e.appointment_id === c.id);
    expect(evs.map((e) => e.event_type)).toEqual(['scheduled', 'attended']);
    const attended = evs.find((e) => e.event_type === 'attended')!;
    expect(new Date(attended.occurred_at).toISOString()).toBe('2026-09-21T12:30:00.000Z');
    expect(attended.meta_status).toBe('pending');

    // Marcar de novo o mesmo status não duplica; um update sem mudança de status também não.
    await admin!.from('appointments').update({ status: 'compareceu' }).eq('id', c.id);
    await admin!.from('appointments').update({ notes: 'obs' }).eq('id', c.id);
    evs = (await eventos(negocioAberto)).filter((e) => e.appointment_id === c.id);
    expect(evs).toHaveLength(2);

    // Arrependimento: sai de compareceu → o marco pendente vira skipped.
    await admin!.from('appointments').update({ status: 'agendado' }).eq('id', c.id);
    evs = (await eventos(negocioAberto)).filter((e) => e.appointment_id === c.id);
    expect(evs.find((e) => e.event_type === 'attended')?.meta_status).toBe('skipped');
  });

  it('"faltou" vira marco de faltou, já descartado para a Meta', async () => {
    const c = await consulta(organizationA, contatoA, '2026-09-22T11:00:00-03:00');
    await admin!.from('appointments').update({ status: 'faltou' }).eq('id', c.id);
    const evs = (await eventos(negocioAberto)).filter((e) => e.appointment_id === c.id);
    expect(evs.map((e) => [e.event_type, e.meta_status])).toEqual([['scheduled', 'pending'], ['no_show', 'skipped']]);
  });

  it('consulta sem contato (espelho do Clinicorp) ou de contato sem negócio aberto não liga nada', async () => {
    const semContato = await consulta(organizationA, null, '2026-09-23T10:00:00-03:00', { source: 'clinicorp_api', external_id: `ext-${runId}` });
    expect(semContato.deal_id).toBeNull();

    const outro = await admin!.from('contacts').insert({ organization_id: organizationA, name: `Sem negócio ${runId}` }).select('id').single();
    const semNegocio = await consulta(organizationA, outro.data!.id, '2026-09-23T11:00:00-03:00');
    expect(semNegocio.deal_id).toBeNull();
  });

  it('negócio marcado como ganho por UPDATE direto gera "fechou" com o valor; repetir não duplica; reabrir descarta', async () => {
    const ganho = await admin!
      .from('deals')
      .update({ is_won: true, is_lost: false, closed_at: '2026-09-15T16:00:00-03:00' })
      .eq('id', negocioAberto);
    expect(ganho.error).toBeNull();

    let won = (await eventos(negocioAberto)).filter((e) => e.event_type === 'won');
    expect(won).toHaveLength(1);
    expect(won[0]).toMatchObject({ value: 1500, source: 'system', meta_status: 'pending' });
    expect(new Date(won[0].occurred_at).toISOString()).toBe('2026-09-15T19:00:00.000Z');

    // Outro UPDATE mantendo is_won = true não gera segundo marco.
    await admin!.from('deals').update({ title: `Aberto renomeado ${runId}` }).eq('id', negocioAberto);
    await admin!.from('deals').update({ is_won: true }).eq('id', negocioAberto);
    won = (await eventos(negocioAberto)).filter((e) => e.event_type === 'won');
    expect(won).toHaveLength(1);

    // Reabriu antes do envio: o ganho pendente vira skipped. Ganhar de novo gera marco novo.
    await admin!.from('deals').update({ is_won: false, closed_at: null }).eq('id', negocioAberto);
    won = (await eventos(negocioAberto)).filter((e) => e.event_type === 'won');
    expect(won[0].meta_status).toBe('skipped');

    await admin!.from('deals').update({ is_won: true, closed_at: '2026-09-16T10:00:00-03:00' }).eq('id', negocioAberto);
    won = (await eventos(negocioAberto)).filter((e) => e.event_type === 'won');
    expect(won).toHaveLength(2);
    expect(won[1].meta_status).toBe('pending');
  });

  it('a recepção autenticada lê os marcos da própria organização, não os de outra, e não escreve', async () => {
    await admin!.from('deals').update({ is_won: true, closed_at: '2026-09-15T16:00:00-03:00' }).eq('id', negocioB);

    const proprios = await adminA.client.from('deal_conversion_events').select('id, deal_id').eq('organization_id', organizationA);
    expect(proprios.error).toBeNull();
    expect(proprios.data!.length).toBeGreaterThan(0);

    const alheios = await adminA.client.from('deal_conversion_events').select('id').eq('organization_id', organizationB);
    expect(alheios.error).toBeNull();
    expect(alheios.data).toHaveLength(0);

    const escrita = await adminA.client.from('deal_conversion_events').insert({
      organization_id: organizationA,
      deal_id: negocioAberto,
      event_type: 'won',
      occurred_at: new Date().toISOString(),
      source: 'reception',
      idempotency_key: `forjado:${runId}`,
    });
    expect(escrita.error?.code).toBe('42501');
  });
});
