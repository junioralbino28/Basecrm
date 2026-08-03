// @vitest-environment node
//
// RPCs de relatórios financeiros (F8) — teste de integração NÃO-tautológico.
//
// Espelha test/financeConfig.multiTenant.test.ts: usuários REAIS via
// publishable key + signInWithPassword chamando os RPCs SECURITY DEFINER.
// O que está em jogo:
//   1. clinic_staff (Vitória) NÃO obtém agregado financeiro via RPC — ERRO
//      (can_configure_organization barra DENTRO da função); admin obtém.
//   2. Org A nunca enxerga números da org B (org resolvida no servidor).
//   3. Admin de A pedindo p_organization_id = org B → erro.
//   4. Faturamento = SÓ recebido = true, e o valor real é valor − desconto.
//   5. Fronteira de mês no fuso da clínica: pagamento 23:30 de 30/06 em
//      America/Sao_Paulo (= 01/07 02:30 UTC) cai no bucket '2026-06'.
//   6. Comissão usa regra ÚNICA (específica > especialidade, sem dupla
//      contagem) e desconta o pago (commission_payments do período).
//
// ⚠️ Skip gracioso: se os RPCs ainda não foram aplicados no banco
// (migração 20260621000000), a suíte inteira é pulada com aviso.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import {
  getSupabaseAdminClient,
  requireSupabaseData,
  assertNoSupabaseError,
} from './helpers/supabaseAdmin';
import { loadEnvFile, getAnonKey } from './helpers/env';

const nextRoot = process.cwd();
const repoRoot = `${nextRoot}/..`;

loadEnvFile(`${repoRoot}/.env`);
loadEnvFile(`${repoRoot}/.env.local`, { override: true });
loadEnvFile(`${nextRoot}/.env`);
loadEnvFile(`${nextRoot}/.env.local`, { override: true });

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';

const serviceRoleKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const anonKey = getAnonKey();

const hasRealSupabaseCreds =
  Boolean(supabaseUrl) &&
  Boolean(serviceRoleKey) &&
  Boolean(anonKey) &&
  serviceRoleKey !== 'your_service_role_key' &&
  !serviceRoleKey.startsWith('your_') &&
  !serviceRoleKey.startsWith('sb_secret_your_') &&
  !anonKey.startsWith('your_') &&
  !anonKey.startsWith('sb_publishable_your_');

const describeSupabase = hasRealSupabaseCreds ? describe : describe.skip;

function createUserClient(): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function createAuthUserWithProfile(params: {
  email: string;
  password: string;
  organizationId: string;
  role: 'clinic_admin' | 'clinic_staff';
}): Promise<string> {
  const admin = getSupabaseAdminClient();

  const created = await admin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
    user_metadata: {
      role: params.role,
      organization_id: params.organizationId,
    },
  });
  if (created.error || !created.data?.user?.id) {
    throw new Error(`Falha ao criar auth user (${params.role}): ${created.error?.message}`);
  }
  const userId = created.data.user.id;

  const displayName = params.email.split('@')[0] || params.role;
  const profile = await admin.from('profiles').upsert(
    {
      id: userId,
      email: params.email,
      name: displayName,
      first_name: displayName,
      organization_id: params.organizationId,
      role: params.role,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  assertNoSupabaseError(profile, `upsert profile ${params.role}`);

  return userId;
}

function isMissingFunctionError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|function .* does not exist/i.test(error.message || '')
  );
}

// Junho/2026 no fuso da clínica (America/Sao_Paulo = UTC−3, sem DST em 2026).
const P_START = '2026-06-01T00:00:00-03:00';
const P_END = '2026-06-30T23:59:59.999-03:00';

describeSupabase('finance reports RPCs - gate financeiro multi-tenant (usuário real, RPC de verdade)', () => {
  let rpcMissing = false;
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let professionalAId = '';
  let professionalBId = '';
  let professionalCId = '';

  let adminUserId = '';
  let staffUserId = '';
  let adminEmail = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const admin = getSupabaseAdminClient();

    // Skip gracioso: RPCs ainda não aplicados no banco.
    const probe = await admin.rpc('get_revenue_report', { p_start: P_START, p_end: P_END });
    if (isMissingFunctionError(probe.error)) {
      rpcMissing = true;
      console.warn(
        '[financeReportsRpcs.multiTenant] RPCs de relatório ainda não aplicados — rodar pós-migração 20260621000000_finance_reports_rpcs.sql',
      );
      return;
    }

    // Nota: a migração de CORREÇÃO 20260624000000 (pró-rateio de contas, bandeira
    // normalizada, sem_profissional, desempate de comissão) JÁ está aplicada no
    // banco compartilhado. Não dá pra detectá-la via service-role (a RPC barra
    // service-role por design — sem org de perfil), então as asserções abaixo é
    // que PROVAM o fix ao vivo, autenticadas como admin real.
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    const specialtyAName = `Protese ${runId}`;
    const specialtyCName = `Ortodontia ${runId}`;
    const specialtyA = await admin
      .from('specialties')
      .insert({ organization_id: orgAId, name: specialtyAName })
      .select('id')
      .single();
    const specialtyAId = requireSupabaseData(specialtyA, 'insert specialty A').id;
    const specialtyC = await admin
      .from('specialties')
      .insert({ organization_id: orgAId, name: specialtyCName })
      .select('id')
      .single();
    const specialtyCId = requireSupabaseData(specialtyC, 'insert specialty C').id;

    // Profissionais (org A com especialidade pra regra de comissão; org B isolada).
    const profA = await admin
      .from('professionals')
      .insert({ organization_id: orgAId, name: `Dr. Marcos ${runId}`, specialty: specialtyAName, active: true })
      .select('id')
      .single();
    professionalAId = requireSupabaseData(profA, 'insert professional A').id;

    const profB = await admin
      .from('professionals')
      .insert({ organization_id: orgBId, name: `Dra. B ${runId}`, specialty: 'protese', active: true })
      .select('id')
      .single();
    professionalBId = requireSupabaseData(profB, 'insert professional B').id;

    // Profissional C (org A): especialidade 'ortodontia' — alvo do desempate HIGH-3.
    const profC = await admin
      .from('professionals')
      .insert({ organization_id: orgAId, name: `Dra. Carla ${runId}`, specialty: specialtyCName, active: true })
      .select('id')
      .single();
    professionalCId = requireSupabaseData(profC, 'insert professional C').id;

    assertNoSupabaseError(
      await admin.from('professional_specialties').insert([
        {
          organization_id: orgAId,
          professional_id: professionalAId,
          specialty_id: specialtyAId,
        },
        {
          organization_id: orgAId,
          professional_id: professionalCId,
          specialty_id: specialtyCId,
        },
      ]),
      'insert professional specialties A/C',
    );

    // Regras de comissão na org A:
    // - profA: específica do profissional (30%) E por especialidade 'protese' (50%).
    //   A específica DEVE vencer — sem dupla contagem (80%).
    // - profC: DUAS específicas do profissional — uma casando a especialidade do
    //   dentista ('ortodontia', 40%) e uma coringa sem especialidade (20%).
    //   HIGH-3: a que casa a especialidade do dentista DEVE vencer (40%).
    assertNoSupabaseError(
      await admin.from('commission_rules').insert([
        {
          organization_id: orgAId, professional_id: professionalAId,
          amount_type: 'percent', amount: 30, percent: 30, valid_from: '1900-01-01',
        },
        {
          organization_id: orgAId, specialty: specialtyAName, specialty_id: specialtyAId,
          amount_type: 'percent', amount: 50, percent: 50, valid_from: '1900-01-01',
        },
        {
          organization_id: orgAId, professional_id: professionalCId,
          specialty: specialtyCName, specialty_id: specialtyCId,
          amount_type: 'percent', amount: 40, percent: 40, valid_from: '1900-01-01',
        },
        {
          organization_id: orgAId, professional_id: professionalCId,
          amount_type: 'percent', amount: 20, percent: 20, valid_from: '1900-01-01',
        },
      ]),
      'insert commission_rules A',
    );

    // Taxa de cartão: crédito 'Visa' à vista 3,15%. A config grava a bandeira
    // FREE-TEXT capitalizada ('Visa'), mas o atendimento (A1) grava 'visa'
    // lowercase (select). HIGH-2: o RPC normaliza lower(trim) dos dois lados —
    // sem o fix, este left join zerava a taxa em silêncio (regressão se voltar).
    assertNoSupabaseError(
      await admin.from('payment_method_fees').insert({
        organization_id: orgAId,
        label: `Crédito Visa ${runId}`,
        payment_type: 'credito',
        card_brand: 'Visa',
        installments: 1,
        fee_percent: 3.15,
      }),
      'insert fee A',
    );

    // Conta fixa ativa (R$ 250) + uma inativa que NÃO pode entrar.
    assertNoSupabaseError(
      await admin.from('fixed_costs').insert([
        { organization_id: orgAId, name: `Clinicorp ${runId}`, amount: 250, active: true },
        { organization_id: orgAId, name: `Inativa ${runId}`, amount: 9999, active: false },
      ]),
      'insert fixed_costs A',
    );

    // Pagamento de comissão do período (alimenta o "Paga").
    assertNoSupabaseError(
      await admin.from('commission_payments').insert({
        organization_id: orgAId,
        professional_id: professionalAId,
        amount: 100,
        period: '2026-06',
      }),
      'insert commission_payment A',
    );

    // Atendimentos:
    // A1 — recebido meio do mês, crédito visa à vista, valor 1000 − desconto 100 = 900.
    // A2 — NÃO recebido (não entra no faturamento).
    // A3 — FRONTEIRA: pago 30/06 23:30 em SP (= 01/07 02:30 UTC), pix, 500.
    // A4 — recebido SEM dentista (professional_id null), pix, 300 — entra no
    //      faturamento bruto mas NÃO na tabela por-profissional (INNER join);
    //      MEDIUM-8: aparece em sem_profissional pra reconciliar o Financeiro.
    // B1 — org B, recebido, 9999 (nunca pode vazar pro relatório de A).
    assertNoSupabaseError(
      await admin.from('atendimentos').insert([
        {
          organization_id: orgAId,
          professional_id: professionalAId,
          procedimento: `Faceta ${runId}`,
          valor: 1000,
          desconto: 100,
          payment_method: 'credito',
          card_brand: 'visa',
          installments: 1,
          recebido: true,
          paid_at: '2026-06-15T15:00:00-03:00',
          performed_at: '2026-06-15T14:00:00-03:00',
        },
        {
          organization_id: orgAId,
          professional_id: professionalAId,
          procedimento: `Avaliação ${runId}`,
          valor: 700,
          desconto: 0,
          // bulk insert: PostgREST unifica as chaves do lote — coluna omitida
          // vira null explícito (não DEFAULT); installments é NOT NULL.
          installments: 1,
          recebido: false,
          paid_at: null,
          performed_at: '2026-06-16T10:00:00-03:00',
        },
        {
          organization_id: orgAId,
          professional_id: professionalAId,
          procedimento: `Limpeza fronteira ${runId}`,
          valor: 500,
          desconto: 0,
          payment_method: 'pix',
          installments: 1,
          recebido: true,
          paid_at: '2026-06-30T23:30:00-03:00',
          performed_at: '2026-06-30T22:00:00-03:00',
        },
        {
          organization_id: orgAId,
          professional_id: null,
          procedimento: `Sem dentista ${runId}`,
          valor: 300,
          desconto: 0,
          payment_method: 'pix',
          installments: 1,
          recebido: true,
          paid_at: '2026-06-12T10:00:00-03:00',
          performed_at: '2026-06-12T09:00:00-03:00',
        },
        {
          // profC em MAIO/2026 (isolado de junho) — alvo do desempate HIGH-3.
          organization_id: orgAId,
          professional_id: professionalCId,
          procedimento: `Aparelho ${runId}`,
          valor: 1000,
          desconto: 0,
          payment_method: 'pix',
          installments: 1,
          recebido: true,
          paid_at: '2026-05-15T10:00:00-03:00',
          performed_at: '2026-05-15T09:00:00-03:00',
        },
        {
          organization_id: orgBId,
          professional_id: professionalBId,
          procedimento: `Org B ${runId}`,
          valor: 9999,
          desconto: 0,
          installments: 1,
          recebido: true,
          paid_at: '2026-06-10T12:00:00-03:00',
          performed_at: '2026-06-10T11:00:00-03:00',
        },
      ]),
      'insert atendimentos',
    );

    adminEmail = `finrpc.admin.${runId}.${randomUUID()}@example.com`;
    staffEmail = `finrpc.staff.${runId}.${randomUUID()}@example.com`;

    adminUserId = await createAuthUserWithProfile({
      email: adminEmail,
      password,
      organizationId: orgAId,
      role: 'clinic_admin',
    });
    staffUserId = await createAuthUserWithProfile({
      email: staffEmail,
      password,
      organizationId: orgAId,
      role: 'clinic_staff',
    });
  }, 120_000);

  afterAll(async () => {
    if (rpcMissing) return;
    const admin = getSupabaseAdminClient();

    for (const orgId of [orgAId, orgBId]) {
      if (!orgId) continue;
      for (const table of [
        'atendimentos',
        'commission_payments',
        'commission_rules',
        'payment_method_fees',
        'fixed_costs',
        'professionals',
      ]) {
        assertNoSupabaseError(
          await admin.from(table).delete().eq('organization_id', orgId),
          `delete ${table} ${orgId}`,
        );
      }
    }

    if (adminUserId) await admin.auth.admin.deleteUser(adminUserId);
    if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);

    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('OBRIGATÓRIO: clinic_staff (Vitória) NÃO obtém agregado financeiro via RPC — erro, nunca dado', async ctx => {
    if (rpcMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    for (const rpc of ['get_revenue_report', 'get_commission_report', 'get_net_result'] as const) {
      const res = await client.rpc(rpc, { p_start: P_START, p_end: P_END });
      expect(res.error, `${rpc} deve negar clinic_staff`).not.toBeNull();
      expect(res.data, `${rpc} não pode retornar dado pra staff`).toBeNull();
    }

    await client.auth.signOut();
  });

  it('clinic_admin obtém faturamento SÓ da própria org: recebido=true, valor − desconto, sem números da org B', async ctx => {
    if (rpcMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.rpc('get_revenue_report', { p_start: P_START, p_end: P_END });
    expect(res.error).toBeNull();

    const report = res.data as {
      faturamento: number;
      total_atendimentos: number;
      por_mes: Array<{ mes: string; faturamento: number }>;
    };

    // 900 (A1, com desconto) + 500 (A3) + 300 (A4, sem dentista) = 1700.
    // A2 não recebido fora; 9999 da org B fora. Faturamento bruto conta TODO
    // recebido (sem join de profissional) — inclui o atendimento sem dentista.
    expect(Number(report.faturamento)).toBe(1700);
    expect(Number(report.total_atendimentos)).toBe(3);

    await client.auth.signOut();
  });

  it('FRONTEIRA: pagamento 23:30 de 30/06 em SP cai no bucket 2026-06 (não vira julho)', async ctx => {
    if (rpcMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.rpc('get_revenue_report', { p_start: P_START, p_end: P_END });
    expect(res.error).toBeNull();

    const report = res.data as { por_mes: Array<{ mes: string; faturamento: number }> };
    expect(report.por_mes).toHaveLength(1);
    expect(report.por_mes[0].mes).toBe('2026-06');
    expect(Number(report.por_mes[0].faturamento)).toBe(1700);

    await client.auth.signOut();
  });

  it('comissão usa regra ÚNICA (específica 30% vence a de especialidade 50%) e reporta o pago do período', async ctx => {
    if (rpcMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.rpc('get_commission_report', { p_start: P_START, p_end: P_END });
    expect(res.error).toBeNull();

    const report = res.data as {
      total_comissao: number;
      por_profissional: Array<{
        professional_id: string;
        comissao: number;
        faturamento_base: number;
        atendimentos: number;
        pago: number;
      }>;
      sem_profissional: { atendimentos: number; faturamento: number };
    };

    // Desde 2026-07-24 o relatório parte de `professionals` (LEFT JOIN): quem
    // não produziu no período TAMBÉM aparece, zerado (pedido do Adel — antes
    // o profissional sumia da tela). Por isso buscamos a linha pelo id.
    const linha = report.por_profissional.find(
      (item) => item.professional_id === professionalAId,
    )!;
    expect(linha).toBeDefined();
    // A comissão nasce na competência do atendimento, mesmo antes do
    // recebimento: 30% de (A1 900 + A2 700 + A3 500) = 630. A regra específica
    // continua vencendo a de especialidade, sem dupla contagem.
    expect(Number(linha.comissao)).toBeCloseTo(630, 2);
    expect(Number(linha.faturamento_base)).toBe(2100);
    expect(Number(linha.atendimentos)).toBe(3);
    expect(Number(linha.pago)).toBe(100);

    // MEDIUM-8: o atendimento recebido sem dentista (A4, 300) é reportado à
    // parte pra reconciliar com o "Recebido bruto" do Financeiro (1700).
    expect(Number(report.sem_profissional.atendimentos)).toBe(1);
    expect(Number(report.sem_profissional.faturamento)).toBe(300);

    await client.auth.signOut();
  });

  it('HIGH-3: desempate — entre 2 regras específicas, a que casa a especialidade do dentista vence', async ctx => {
    if (rpcMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    // Maio/2026 isolado: só o atendimento da profC (ortodontia, 1000).
    const res = await client.rpc('get_commission_report', {
      p_start: '2026-05-01T00:00:00-03:00',
      p_end: '2026-05-31T23:59:59.999-03:00',
    });
    expect(res.error).toBeNull();

    const report = res.data as {
      por_profissional: Array<{ professional_id: string; comissao: number; faturamento_base: number }>;
    };
    // LEFT JOIN desde 2026-07-24: quem não produziu aparece zerado, então a
    // linha da dentista é buscada pelo id (ver comentário no teste acima).
    const carla = report.por_profissional.find(
      (item) => item.professional_id === professionalCId,
    )!;
    expect(carla).toBeDefined();
    // 40% (regra que casa 'ortodontia' = especialidade da dentista) e NÃO 20%
    // (coringa sem especialidade): 40% de 1000 = 400.
    expect(Number(carla.comissao)).toBeCloseTo(400, 2);
    expect(Number(carla.faturamento_base)).toBe(1000);

    await client.auth.signOut();
  });

  it('líquido = faturamento − comissões − taxas (forma+bandeira+parcelas) − contas fixas ATIVAS', async ctx => {
    if (rpcMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.rpc('get_net_result', { p_start: P_START, p_end: P_END });
    expect(res.error).toBeNull();

    const net = res.data as {
      faturamento: number;
      comissoes: number;
      taxas: number;
      contas_fixas: number;
      contas_fixas_mensal: number;
      meses_periodo: number;
      liquido: number;
    };

    // 900 (A1) + 500 (A3) + 300 (A4 sem dentista) = 1700.
    expect(Number(net.faturamento)).toBe(1700);
    // Comissão é competência por performed_at; inclui também o A2 ainda não
    // recebido. Receita continua sendo caixa e, portanto, exclui o A2.
    expect(Number(net.comissoes)).toBeCloseTo(630, 2);
    // HIGH-2: taxa só no A1 (crédito 'Visa' config vs 'visa' atendimento — só
    // aplica porque o RPC normaliza): 3,15% de 900 = 28,35; pix sem taxa.
    expect(Number(net.taxas)).toBeCloseTo(28.35, 2);
    // conta inativa de 9999 NÃO entra. HIGH-1: junho é 1 mês → 1× 250.
    expect(Number(net.contas_fixas_mensal)).toBe(250);
    expect(Number(net.meses_periodo)).toBe(1);
    expect(Number(net.contas_fixas)).toBe(250);
    expect(Number(net.liquido)).toBeCloseTo(1700 - 630 - 28.35 - 250, 2);

    await client.auth.signOut();
  });

  it('HIGH-1: contas fixas pró-rateadas — range de 3 meses cobra 3× a mensalidade', async ctx => {
    if (rpcMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    // Abril→junho/2026 no fuso SP = 3 meses-calendário (inclusivo).
    const res = await client.rpc('get_net_result', {
      p_start: '2026-04-01T00:00:00-03:00',
      p_end: '2026-06-30T23:59:59.999-03:00',
    });
    expect(res.error).toBeNull();

    const net = res.data as {
      contas_fixas: number;
      contas_fixas_mensal: number;
      meses_periodo: number;
    };
    expect(Number(net.meses_periodo)).toBe(3);
    expect(Number(net.contas_fixas_mensal)).toBe(250);
    // pró-rateio: 250 × 3 = 750 (antes do fix entrava 250 cravado em qualquer range).
    expect(Number(net.contas_fixas)).toBe(750);

    await client.auth.signOut();
  });

  it('clinic_admin de A NÃO consulta org B via p_organization_id (validação interna do RPC)', async ctx => {
    if (rpcMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.rpc('get_revenue_report', {
      p_start: P_START,
      p_end: P_END,
      p_organization_id: orgBId,
    });

    expect(res.error).not.toBeNull();
    expect(res.data).toBeNull();

    await client.auth.signOut();
  });

  // ---------------------------------------------------------------------------
  // 2026-07-24 — funcionário + comissão por período de vigência
  // ---------------------------------------------------------------------------

  it('quem NÃO produziu no período aparece na lista, zerado (pedido do Adel)', async ctx => {
    if (rpcMissing) return ctx.skip();
    const admin = getSupabaseAdminClient();
    const prof = await admin
      .from('professionals')
      .insert({
        organization_id: orgAId,
        name: `Dra. Sem Producao ${runId}`,
        specialty: 'implante',
        role: 'Dentista',
        active: true,
      })
      .select('id')
      .single();
    const semProducaoId = requireSupabaseData(prof, 'insert professional sem producao').id;

    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: adminEmail, password })).error).toBeNull();

    const res = await client.rpc('get_commission_report', { p_start: P_START, p_end: P_END });
    expect(res.error).toBeNull();

    const report = res.data as {
      por_profissional: Array<{ professional_id: string; atendimentos: number; comissao: number }>;
    };
    // Antes de 24/07 o relatório partia de `atendimentos` (INNER join) e esta
    // pessoa simplesmente SUMIA da tela.
    const linha = report.por_profissional.find((i) => i.professional_id === semProducaoId);
    expect(linha).toBeDefined();
    expect(Number(linha!.atendimentos)).toBe(0);
    expect(Number(linha!.comissao)).toBe(0);

    await client.auth.signOut();
  });

  it('comissão em VALOR FIXO por procedimento; mudar a regra hoje NÃO reescreve o passado', async ctx => {
    if (rpcMissing) return ctx.skip();
    const admin = getSupabaseAdminClient();
    const prof = await admin
      .from('professionals')
      .insert({
        organization_id: orgAId,
        name: `Dr. Vigencia ${runId}`,
        specialty: 'clinica',
        role: 'Dentista',
        pay_type: 'both',
        fixed_amount: 1000,
        active: true,
      })
      .select('id')
      .single();
    const profId = requireSupabaseData(prof, 'insert professional vigencia').id;

    // O profissional é criado durante o teste (em agosto/2026), portanto o
    // trigger só registra a remuneração a partir da data atual. Para consultar
    // abril/2026, o fixture precisa declarar explicitamente a versão histórica.
    assertNoSupabaseError(
      await admin.from('professional_compensation_versions').insert({
        organization_id: orgAId,
        professional_id: profId,
        pay_type: 'both',
        fixed_amount: 1000,
        active: true,
        valid_from: '2020-01-01',
      }),
      'insert compensation version vigencia',
    );

    // O snapshot nasce junto com o atendimento: as regras e suas vigências
    // precisam existir antes do fato e mudanças posteriores não o reabrem.
    assertNoSupabaseError(
      await admin.from('commission_rules').insert([
        {
          organization_id: orgAId, professional_id: profId, procedimento: 'Consulta',
          amount_type: 'fixed', amount: 30, percent: 0, valid_from: '2020-01-01',
        },
        {
          organization_id: orgAId, professional_id: profId, procedimento: 'Consulta',
          amount_type: 'fixed', amount: 50, percent: 0, valid_from: '2026-04-15',
        },
      ]),
      'insert commission_rules vigencia',
    );

    // Dois atendimentos IDÊNTICOS, em dias diferentes de abril.
    assertNoSupabaseError(
      await admin.from('atendimentos').insert([
        {
          organization_id: orgAId, professional_id: profId, procedimento: 'Consulta',
          valor: 100, desconto: 0, recebido: true,
          paid_at: '2026-04-10T12:00:00-03:00', performed_at: '2026-04-10T12:00:00-03:00',
        },
        {
          organization_id: orgAId, professional_id: profId, procedimento: 'Consulta',
          valor: 100, desconto: 0, recebido: true,
          paid_at: '2026-04-20T12:00:00-03:00', performed_at: '2026-04-20T12:00:00-03:00',
        },
      ]),
      'insert atendimentos vigencia',
    );

    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: adminEmail, password })).error).toBeNull();

    const res = await client.rpc('get_commission_report', {
      p_start: '2026-04-01T00:00:00-03:00',
      p_end: '2026-04-30T23:59:59.999-03:00',
    });
    expect(res.error).toBeNull();

    const report = res.data as {
      por_profissional: Array<{
        professional_id: string; comissao: number; atendimentos: number;
        role: string | null; pay_type: string; fixed_amount: number;
      }>;
    };
    const linha = report.por_profissional.find((i) => i.professional_id === profId)!;
    expect(linha).toBeDefined();
    expect(Number(linha.atendimentos)).toBe(2);
    // 10/04 cai na regra antiga (30) e 20/04 na nova (50) → 80.
    // Se a mudança reescrevesse o passado, sairia 100. É ESTE o número que
    // prova o critério que o Junior pediu.
    expect(Number(linha.comissao)).toBeCloseTo(80, 2);
    // O cadastro de funcionário viaja junto (cargo + como a pessoa ganha).
    expect(linha.role).toBe('Dentista');
    expect(linha.pay_type).toBe('both');
    expect(Number(linha.fixed_amount)).toBe(1000);

    await client.auth.signOut();
  });
});
