// @vitest-environment node
//
// Isolamento cross-tenant + gate financeiro das configs financeiras — teste
// NÃO-tautológico (Fase 5).
//
// Espelha test/atendimentos.multiTenant.test.ts: autentica usuários REAIS via
// publishable key + signInWithPassword e faz SELECT SEM filtro algum — quem
// isola é a RLS. Diferença CRÍTICA vs tabelas operacionais: aqui SELECT e
// mutação usam can_configure_organization — clinic_staff (Vitória) NÃO lê nem
// muta config financeira nem da PRÓPRIA org (taxa/margem/comissão é dado do
// Adel). Org B nunca enxerga org A.
//
// ⚠️ Skip gracioso: se as tabelas de config financeira ainda não existem no
// banco (migração 20260616000000 não aplicada), a suíte inteira é pulada com
// aviso. Rodar de novo PÓS-migração.
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

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|schema cache/i.test(error.message || '')
  );
}

const FINANCE_TABLES = ['payment_method_fees', 'commission_rules', 'fixed_costs', 'commission_payments'] as const;

describeSupabase('finance config - gate financeiro multi-tenant (usuário real, RLS de verdade)', () => {
  let tableMissing = false;
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let feeAId = '';
  let feeBId = '';
  let professionalAId = '';

  let adminUserId = '';
  let staffUserId = '';
  let adminEmail = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const admin = getSupabaseAdminClient();

    // Skip gracioso: tabelas de config financeira ainda não aplicadas no banco.
    const probe = await admin.from('payment_method_fees').select('id').limit(1);
    if (isMissingTableError(probe.error)) {
      tableMissing = true;
      console.warn(
        '[financeConfig.multiTenant] tabelas de config financeira ainda não aplicadas — rodar pós-migração 20260616000000_finance_config.sql',
      );
      return;
    }

    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    // Profissional da org A (commission_rules/commission_payments referenciam).
    const profA = await admin
      .from('professionals')
      .insert({ organization_id: orgAId, name: `Dra. Comissão ${runId}`, active: true })
      .select('id')
      .single();
    professionalAId = requireSupabaseData(profA, 'insert professional A').id;

    const insA = await admin
      .from('payment_method_fees')
      .insert({
        organization_id: orgAId,
        label: `Crédito A ${runId}`,
        payment_type: 'credito',
        card_brand: 'visa',
        installments: 3,
        fee_percent: 4.5,
      })
      .select('id')
      .single();
    feeAId = requireSupabaseData(insA, 'insert fee A').id;

    const insB = await admin
      .from('payment_method_fees')
      .insert({
        organization_id: orgBId,
        label: `Pix B ${runId}`,
        payment_type: 'pix',
        installments: 1,
        fee_percent: 0,
      })
      .select('id')
      .single();
    feeBId = requireSupabaseData(insB, 'insert fee B').id;

    // Seeds das demais tabelas na org A — provam que a Vitória não lê NADA financeiro.
    assertNoSupabaseError(
      await admin.from('commission_rules').insert({
        organization_id: orgAId,
        professional_id: professionalAId,
        specialty: 'ortodontia',
        percent: 30,
      }),
      'insert commission_rule A',
    );
    assertNoSupabaseError(
      await admin.from('fixed_costs').insert({
        organization_id: orgAId,
        name: `Aluguel ${runId}`,
        amount: 5000,
        due_day: 10,
      }),
      'insert fixed_cost A',
    );
    assertNoSupabaseError(
      await admin.from('commission_payments').insert({
        organization_id: orgAId,
        professional_id: professionalAId,
        amount: 1200,
        period: '2026-06',
      }),
      'insert commission_payment A',
    );

    adminEmail = `fin.admin.${runId}.${randomUUID()}@example.com`;
    staffEmail = `fin.staff.${runId}.${randomUUID()}@example.com`;

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
    if (tableMissing) return;
    const admin = getSupabaseAdminClient();

    for (const table of FINANCE_TABLES) {
      if (orgAId) {
        assertNoSupabaseError(
          await admin.from(table).delete().eq('organization_id', orgAId),
          `delete ${table} org A`,
        );
      }
      if (orgBId) {
        assertNoSupabaseError(
          await admin.from(table).delete().eq('organization_id', orgBId),
          `delete ${table} org B`,
        );
      }
    }
    if (orgAId) {
      assertNoSupabaseError(
        await admin.from('professionals').delete().eq('organization_id', orgAId),
        'delete professionals org A',
      );
    }

    if (adminUserId) await admin.auth.admin.deleteUser(adminUserId);
    if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);

    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('clinic_admin de org A, com SELECT SEM filtro, vê a taxa de A e NUNCA a de B (RLS isola)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    // Nenhum .eq('organization_id', ...) — o isolamento aqui é 100% RLS.
    const res = await client.from('payment_method_fees').select('id, organization_id, label');

    expect(res.error).toBeNull();
    const ids = (res.data || []).map(r => r.id);
    const orgIds = (res.data || []).map(r => r.organization_id);

    expect(ids).toContain(feeAId);
    expect(ids).not.toContain(feeBId);
    expect(orgIds.every(o => o === orgAId)).toBe(true);

    await client.auth.signOut();
  });

  it('clinic_staff (Vitória) NÃO lê NENHUMA config financeira nem da PRÓPRIA org (gate do Adel)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    for (const table of FINANCE_TABLES) {
      const res = await client.from(table).select('id');
      expect(res.error, `select ${table} como staff não deve errar`).toBeNull();
      // can_configure_organization exclui clinic_staff — leitura vem VAZIA.
      expect(res.data ?? [], `staff não pode ler ${table}`).toHaveLength(0);
    }

    await client.auth.signOut();
  });

  it('clinic_staff NÃO insere config financeira na própria org (mutação = can_configure)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client
      .from('payment_method_fees')
      .insert({
        organization_id: orgAId,
        label: `Staff invasora ${runId}`,
        payment_type: 'pix',
        installments: 1,
        fee_percent: 1,
      })
      .select('id')
      .single();

    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();

    await client.auth.signOut();
  });

  it('clinic_admin REGISTRA e atualiza taxa na própria org (policy não é deny-all)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const ins = await client
      .from('payment_method_fees')
      .insert({
        organization_id: orgAId,
        label: `Débito Admin ${runId}`,
        payment_type: 'debito',
        installments: 1,
        fee_percent: 1.99,
      })
      .select('id, organization_id, fee_percent')
      .single();

    expect(ins.error).toBeNull();
    expect(ins.data?.organization_id).toBe(orgAId);

    const upd = await client
      .from('payment_method_fees')
      .update({ fee_percent: 2.49 })
      .eq('id', ins.data!.id)
      .select('fee_percent')
      .single();

    expect(upd.error).toBeNull();
    expect(Number(upd.data?.fee_percent)).toBe(2.49);

    await client.auth.signOut();
  });

  it('clinic_admin de org A NÃO insere taxa em org B (WITH CHECK cross-org)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client
      .from('payment_method_fees')
      .insert({
        organization_id: orgBId,
        label: `Invasor ${runId}`,
        payment_type: 'pix',
        installments: 1,
        fee_percent: 9,
      })
      .select('id')
      .single();

    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();

    await client.auth.signOut();
  });

  it('banco rejeita percentual fora de 0..100 e período inválido (CHECKs de domínio)', async ctx => {
    if (tableMissing) return ctx.skip();
    const admin = getSupabaseAdminClient();

    // fee_percent > 100 viola payment_method_fees_fee_percent_chk mesmo via service role.
    const badFee = await admin
      .from('payment_method_fees')
      .insert({
        organization_id: orgAId,
        label: `Taxa absurda ${runId}`,
        payment_type: 'credito',
        installments: 1,
        fee_percent: 250,
      })
      .select('id')
      .single();
    expect(badFee.data).toBeNull();
    expect(badFee.error).not.toBeNull();

    // period fora de YYYY-MM viola commission_payments_period_chk.
    const badPeriod = await admin
      .from('commission_payments')
      .insert({
        organization_id: orgAId,
        professional_id: professionalAId,
        amount: 10,
        period: 'junho/2026',
      })
      .select('id')
      .single();
    expect(badPeriod.data).toBeNull();
    expect(badPeriod.error).not.toBeNull();
  });
});
