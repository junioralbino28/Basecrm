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

/**
 * Várias especialidades por funcionário (`professional_specialties`).
 *
 * Decisão do Junior (2026-07-27): "o ideal é que se possa colocar mais de uma
 * especialidade por funcionário, pois ele pode fazer vários procedimentos".
 *
 * O que estes testes protegem, e por quê:
 *  1. **GRANT existe** — a tabela nasceu junto com a lição de 24/07 (RLS só
 *     restringe; sem grant o Postgres nega antes de olhar a policy).
 *  2. **O motor usa a LIGAÇÃO, não a coluna antiga** — `professional_has_specialty`
 *     precisa responder `true` para uma especialidade que NÃO é a do espelho
 *     legado. Se alguém "simplificar" a função de volta pra `p.specialty`, este
 *     teste cai.
 *  3. **Isolamento entre clínicas** continua valendo na tabela nova.
 */
describeLocal('Especialidades múltiplas por funcionário — Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const runId = randomUUID().slice(0, 8);
  const password = `Esp!${runId}aA1`;
  const authUserIds: string[] = [];
  let organizationA = '';
  let organizationB = '';
  let clientA: SupabaseClient;
  let professionalId = '';
  let idEndodontia = '';
  let idOrtodontia = '';

  // Alfabeticamente "Endodontia…" < "Ortodontia…": o espelho legado fica com a
  // primeira, então perguntar pela SEGUNDA é o que prova que a ligação manda.
  const nomeEndo = `Endodontia ${runId}`;
  const nomeOrto = `Ortodontia ${runId}`;

  beforeAll(async () => {
    if (!admin || !config) return;

    const orgs = await admin.from('organizations').insert([
      { name: `Espec A ${runId}` },
      { name: `Espec B ${runId}` },
    ]).select('id, name');
    if (orgs.error) throw orgs.error;
    organizationA = orgs.data.find((o) => o.name.includes('A'))!.id;
    organizationB = orgs.data.find((o) => o.name.includes('B'))!.id;

    const email = `espec.admin.${runId}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error;
    authUserIds.push(created.data.user.id);
    const profile = await admin.from('profiles').upsert({
      id: created.data.user.id,
      email,
      name: 'Espec admin',
      first_name: 'Espec',
      role: 'clinic_admin',
      organization_id: organizationA,
      updated_at: new Date().toISOString(),
    });
    if (profile.error) throw profile.error;

    clientA = createE2UserClient(config);
    const signed = await clientA.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;

    const especialidades = await admin.from('specialties').insert([
      { organization_id: organizationA, name: nomeEndo },
      { organization_id: organizationA, name: nomeOrto },
    ]).select('id, name');
    if (especialidades.error) throw especialidades.error;
    idEndodontia = especialidades.data.find((s) => s.name === nomeEndo)!.id;
    idOrtodontia = especialidades.data.find((s) => s.name === nomeOrto)!.id;

    const pro = await admin.from('professionals').insert({
      organization_id: organizationA,
      name: `Dra. Multi ${runId}`,
      specialty: nomeEndo,
      active: true,
    }).select('id').single();
    if (pro.error) throw pro.error;
    professionalId = pro.data.id;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('professional_specialties').delete().in('organization_id', [organizationA, organizationB]);
    await admin.from('professionals').delete().in('organization_id', [organizationA, organizationB]);
    await admin.from('specialties').delete().in('organization_id', [organizationA, organizationB]);
    await admin.from('profiles').delete().in('id', authUserIds);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
    await admin.from('organizations').delete().in('id', [organizationA, organizationB]);
  });

  it('admin liga a pessoa a DUAS especialidades e lê de volta (o GRANT existe)', async (ctx) => {
    if (!admin) return ctx.skip();

    const inserido = await clientA.from('professional_specialties').insert([
      { organization_id: organizationA, professional_id: professionalId, specialty_id: idEndodontia },
      { organization_id: organizationA, professional_id: professionalId, specialty_id: idOrtodontia },
    ]).select('id');
    expect(inserido.error).toBeNull();
    expect(inserido.data).toHaveLength(2);

    const lidos = await clientA
      .from('professional_specialties')
      .select('specialty_id, specialties(name)')
      .eq('professional_id', professionalId);
    expect(lidos.error).toBeNull();
    expect(lidos.data).toHaveLength(2);
  });

  it('recusa a mesma especialidade duas vezes na mesma pessoa', async (ctx) => {
    if (!admin) return ctx.skip();
    const repetido = await clientA.from('professional_specialties').insert({
      organization_id: organizationA,
      professional_id: professionalId,
      specialty_id: idOrtodontia,
    });
    expect(repetido.error).not.toBeNull();
  });

  it('o motor enxerga a especialidade que NÃO está no espelho legado', async (ctx) => {
    if (!admin) return ctx.skip();

    // O espelho legado (`professionals.specialty`) tem "Endodontia…". Se a função
    // ainda olhasse só a coluna antiga, a resposta aqui seria false.
    const segunda = await clientA.rpc('professional_has_specialty', {
      p_professional_id: professionalId,
      p_specialty: nomeOrto,
    });
    expect(segunda.error).toBeNull();
    expect(segunda.data).toBe(true);

    const primeira = await clientA.rpc('professional_has_specialty', {
      p_professional_id: professionalId,
      p_specialty: nomeEndo,
    });
    expect(primeira.data).toBe(true);

    const inexistente = await clientA.rpc('professional_has_specialty', {
      p_professional_id: professionalId,
      p_specialty: `Prótese ${runId}`,
    });
    expect(inexistente.data).toBe(false);
  });

  it('ignora diferença de caixa e espaço no nome da especialidade', async (ctx) => {
    if (!admin) return ctx.skip();
    // A regra de comissão guarda a especialidade como TEXTO — se o casamento
    // fosse sensível a caixa, "ortodontia" deixaria de pagar comissão em silêncio.
    const resposta = await clientA.rpc('professional_has_specialty', {
      p_professional_id: professionalId,
      p_specialty: `  ${nomeOrto.toLowerCase()}  `,
    });
    expect(resposta.data).toBe(true);
  });

  it('não liga funcionário de outra clínica nem enxerga ligação alheia', async (ctx) => {
    if (!admin) return ctx.skip();

    const outraEsp = await admin.from('specialties')
      .insert({ organization_id: organizationB, name: `Segredo B ${runId}` })
      .select('id').single();
    const outroPro = await admin.from('professionals')
      .insert({ organization_id: organizationB, name: `Dr. B ${runId}`, active: true })
      .select('id').single();
    await admin.from('professional_specialties').insert({
      organization_id: organizationB,
      professional_id: outroPro.data!.id,
      specialty_id: outraEsp.data!.id,
    });

    const lidos = await clientA.from('professional_specialties').select('organization_id');
    expect(lidos.error).toBeNull();
    expect((lidos.data || []).every((r) => r.organization_id === organizationA)).toBe(true);

    const invasao = await clientA.from('professional_specialties').insert({
      organization_id: organizationB,
      professional_id: outroPro.data!.id,
      specialty_id: outraEsp.data!.id,
    });
    expect(invasao.error).not.toBeNull();

    // RLS sozinho aceitaria estas linhas porque elas DECLARAM organizationA.
    // As FKs compostas do P3-04 precisam barrar a referência escondida a B.
    const profissionalCruzado = await clientA.from('professional_specialties').insert({
      organization_id: organizationA,
      professional_id: outroPro.data!.id,
      specialty_id: idEndodontia,
    });
    expect(profissionalCruzado.error).not.toBeNull();

    const especialidadeCruzada = await clientA.from('professional_specialties').insert({
      organization_id: organizationA,
      professional_id: professionalId,
      specialty_id: outraEsp.data!.id,
    });
    expect(especialidadeCruzada.error).not.toBeNull();
  });
});
