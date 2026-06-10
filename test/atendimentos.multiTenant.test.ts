// @vitest-environment node
//
// Isolamento cross-tenant de `atendimentos` — teste NÃO-tautológico.
//
// Espelha test/professionals.multiTenant.test.ts: autentica usuários REAIS via
// publishable key + signInWithPassword e faz SELECT SEM filtro algum — quem
// isola é a RLS (can_access_organization). Mutações provam o
// can_operate_organization (clinic_staff SIM — atendimento é operacional, a
// Vitória registra; cross-org nunca). Também prova que recebido=true persiste
// com paid_at preenchido (faturamento = RECEBIDO).
//
// ⚠️ Skip gracioso: se a tabela `atendimentos` ainda não existe no banco
// (migração 20260614000000 não aplicada), a suíte inteira é pulada com aviso.
// Rodar de novo PÓS-migração.
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

describeSupabase('atendimentos - isolamento multi-tenant (usuário real, RLS de verdade)', () => {
  let tableMissing = false;
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let atdAId = '';
  let atdBId = '';

  let adminUserId = '';
  let staffUserId = '';
  let adminEmail = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const admin = getSupabaseAdminClient();

    // Skip gracioso: tabela atendimentos ainda não aplicada no banco.
    const probe = await admin.from('atendimentos').select('id').limit(1);
    if (isMissingTableError(probe.error)) {
      tableMissing = true;
      console.warn(
        '[atendimentos.multiTenant] tabela atendimentos ainda não aplicada — rodar pós-migração 20260614000000_atendimentos.sql',
      );
      return;
    }

    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    const insA = await admin
      .from('atendimentos')
      .insert({
        organization_id: orgAId,
        procedimento: `Limpeza A ${runId}`,
        valor: 250,
        desconto: 0,
        payment_method: 'pix',
        installments: 1,
        recebido: false,
        performed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    atdAId = requireSupabaseData(insA, 'insert atendimento A').id;

    const insB = await admin
      .from('atendimentos')
      .insert({
        organization_id: orgBId,
        procedimento: `Canal B ${runId}`,
        valor: 800,
        desconto: 0,
        payment_method: 'credito',
        installments: 3,
        recebido: false,
        performed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    atdBId = requireSupabaseData(insB, 'insert atendimento B').id;

    adminEmail = `atd.admin.${runId}.${randomUUID()}@example.com`;
    staffEmail = `atd.staff.${runId}.${randomUUID()}@example.com`;

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

    if (orgAId) {
      assertNoSupabaseError(
        await admin.from('atendimentos').delete().eq('organization_id', orgAId),
        'delete atendimentos org A',
      );
    }
    if (orgBId) {
      assertNoSupabaseError(
        await admin.from('atendimentos').delete().eq('organization_id', orgBId),
        'delete atendimentos org B',
      );
    }

    if (adminUserId) await admin.auth.admin.deleteUser(adminUserId);
    if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);

    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('clinic_admin de org A, com SELECT SEM filtro, vê o atendimento de A e NUNCA o de B (RLS isola)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    // Nenhum .eq('organization_id', ...) — o isolamento aqui é 100% RLS.
    const res = await client.from('atendimentos').select('id, organization_id, procedimento');

    expect(res.error).toBeNull();
    const ids = (res.data || []).map(r => r.id);
    const orgIds = (res.data || []).map(r => r.organization_id);

    expect(ids).toContain(atdAId);
    expect(ids).not.toContain(atdBId);
    expect(orgIds.every(o => o === orgAId)).toBe(true);

    await client.auth.signOut();
  });

  it('clinic_staff de org A LÊ os atendimentos da própria org e nunca os de B (policy SELECT can_access)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.from('atendimentos').select('id, organization_id');

    expect(res.error).toBeNull();
    const ids = (res.data || []).map(r => r.id);
    expect(ids).toContain(atdAId);
    expect(ids).not.toContain(atdBId);

    await client.auth.signOut();
  });

  it('clinic_staff REGISTRA atendimento na própria org (mutação = can_operate; recebido=true persiste paid_at)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const paidAt = new Date().toISOString();
    const res = await client
      .from('atendimentos')
      .insert({
        organization_id: orgAId,
        procedimento: `Restauração Staff ${runId}`,
        valor: 350,
        desconto: 30,
        payment_method: 'credito',
        card_brand: 'visa',
        installments: 3,
        recebido: true,
        paid_at: paidAt,
        performed_at: paidAt,
      })
      .select('id, organization_id, recebido, paid_at, desconto')
      .single();

    expect(res.error).toBeNull();
    expect(res.data?.organization_id).toBe(orgAId);
    expect(res.data?.recebido).toBe(true);
    expect(res.data?.paid_at).toBeTruthy();
    expect(Number(res.data?.desconto)).toBe(30);

    await client.auth.signOut();
  });

  it('clinic_staff registra atendimento NÃO recebido com paid_at nulo (faturamento só com recebido)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client
      .from('atendimentos')
      .insert({
        organization_id: orgAId,
        procedimento: `Avaliação Pendente ${runId}`,
        valor: 120,
        desconto: 0,
        payment_method: 'pix',
        installments: 1,
        recebido: false,
        performed_at: new Date().toISOString(),
      })
      .select('id, recebido, paid_at')
      .single();

    expect(res.error).toBeNull();
    expect(res.data?.recebido).toBe(false);
    expect(res.data?.paid_at).toBeNull();

    await client.auth.signOut();
  });

  it('clinic_staff de org A NÃO consegue inserir atendimento em org B (WITH CHECK cross-org)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client
      .from('atendimentos')
      .insert({
        organization_id: orgBId,
        procedimento: `Invasor ${runId}`,
        valor: 999,
        installments: 1,
        recebido: false,
        performed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();

    await client.auth.signOut();
  });
});
