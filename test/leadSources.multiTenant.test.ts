// @vitest-environment node
//
// Isolamento cross-tenant das origens de lead (N1) — teste NÃO-tautológico.
//
// Espelha test/financeConfig.multiTenant.test.ts (usuário real + RLS de
// verdade). lead_sources é tabela OPERACIONAL: SELECT can_access, mutação
// can_operate — clinic_staff (Vitória) cadastra origem na PRÓPRIA org e
// nunca na org B.
//
// ⚠️ Skip gracioso: se a tabela ainda não existe no banco (migração
// 20260617000000 não aplicada), a suíte inteira é pulada com aviso.
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

describeSupabase('lead_sources - isolamento multi-tenant operacional (usuário real, RLS de verdade)', () => {
  let tableMissing = false;
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let sourceAId = '';
  let sourceBId = '';

  let staffUserId = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const admin = getSupabaseAdminClient();

    const probe = await admin.from('lead_sources').select('id').limit(1);
    if (isMissingTableError(probe.error)) {
      tableMissing = true;
      console.warn(
        '[leadSources.multiTenant] tabela lead_sources ainda não aplicada — rodar pós-migração 20260617000000_lead_sources.sql',
      );
      return;
    }

    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    const insA = await admin
      .from('lead_sources')
      .insert({ organization_id: orgAId, name: `Anúncio Meta A ${runId}` })
      .select('id')
      .single();
    sourceAId = requireSupabaseData(insA, 'insert lead_source A').id;

    const insB = await admin
      .from('lead_sources')
      .insert({ organization_id: orgBId, name: `Indicação B ${runId}` })
      .select('id')
      .single();
    sourceBId = requireSupabaseData(insB, 'insert lead_source B').id;

    staffEmail = `sources.staff.${runId}.${randomUUID()}@example.com`;
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

    for (const orgId of [orgAId, orgBId]) {
      if (orgId) {
        assertNoSupabaseError(
          await admin.from('lead_sources').delete().eq('organization_id', orgId),
          'delete lead_sources',
        );
      }
    }

    if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('clinic_staff de org A, com SELECT SEM filtro, vê a origem de A e NUNCA a de B (RLS isola)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.from('lead_sources').select('id, organization_id, name');

    expect(res.error).toBeNull();
    const ids = (res.data || []).map(r => r.id);
    expect(ids).toContain(sourceAId);
    expect(ids).not.toContain(sourceBId);
    expect((res.data || []).every(r => r.organization_id === orgAId)).toBe(true);

    await client.auth.signOut();
  });

  it('clinic_staff CADASTRA e edita origem na própria org (mutação = can_operate, não deny-all)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const ins = await client
      .from('lead_sources')
      .insert({ organization_id: orgAId, name: `Google/GMN ${runId}` })
      .select('id, organization_id, active')
      .single();

    expect(ins.error).toBeNull();
    expect(ins.data?.organization_id).toBe(orgAId);
    expect(ins.data?.active).toBe(true);

    const upd = await client
      .from('lead_sources')
      .update({ active: false })
      .eq('id', ins.data!.id)
      .select('active')
      .single();

    expect(upd.error).toBeNull();
    expect(upd.data?.active).toBe(false);

    await client.auth.signOut();
  });

  it('clinic_staff de org A NÃO insere origem em org B (WITH CHECK cross-org)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client
      .from('lead_sources')
      .insert({ organization_id: orgBId, name: `Invasora ${runId}` })
      .select('id')
      .single();

    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();

    await client.auth.signOut();
  });
});
