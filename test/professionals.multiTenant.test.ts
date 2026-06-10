// @vitest-environment node
//
// Isolamento cross-tenant de `professionals` — teste NÃO-tautológico.
//
// Diferente do padrão service-role + WHERE (que provaria apenas o próprio filtro),
// este teste autentica usuários REAIS via publishable key + signInWithPassword e
// faz SELECT SEM filtro algum: quem isola é a RLS (can_access_organization).
// Mutações provam o can_configure_organization (clinic_admin sim, clinic_staff não,
// cross-org nunca).
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

describeSupabase('professionals - isolamento multi-tenant (usuário real, RLS de verdade)', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let profAId = '';
  let profBId = '';

  let adminUserId = '';
  let staffUserId = '';
  let adminEmail = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    const admin = getSupabaseAdminClient();

    const insA = await admin
      .from('professionals')
      .insert({ organization_id: orgAId, name: `Dra. A ${runId}`, specialty: 'Ortodontia', active: true })
      .select('id')
      .single();
    profAId = requireSupabaseData(insA, 'insert professional A').id;

    const insB = await admin
      .from('professionals')
      .insert({ organization_id: orgBId, name: `Dr. B ${runId}`, specialty: 'Implantodontia', active: true })
      .select('id')
      .single();
    profBId = requireSupabaseData(insB, 'insert professional B').id;

    adminEmail = `prof.admin.${runId}.${randomUUID()}@example.com`;
    staffEmail = `prof.staff.${runId}.${randomUUID()}@example.com`;

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
    const admin = getSupabaseAdminClient();

    // professionals primeiro (org delete cascataria, mas mantemos explícito)
    if (orgAId) {
      assertNoSupabaseError(
        await admin.from('professionals').delete().eq('organization_id', orgAId),
        'delete professionals org A',
      );
    }
    if (orgBId) {
      assertNoSupabaseError(
        await admin.from('professionals').delete().eq('organization_id', orgBId),
        'delete professionals org B',
      );
    }

    // auth users (profiles caem junto via FK/cleanup)
    if (adminUserId) await admin.auth.admin.deleteUser(adminUserId);
    if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);

    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('clinic_admin de org A, com SELECT SEM filtro, vê o profissional de A e NUNCA o de B (RLS isola)', async () => {
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    // Nenhum .eq('organization_id', ...) — o isolamento aqui é 100% RLS.
    const res = await client
      .from('professionals')
      .select('id, organization_id, name');

    expect(res.error).toBeNull();
    const ids = (res.data || []).map((r) => r.id);
    const orgIds = (res.data || []).map((r) => r.organization_id);

    expect(ids).toContain(profAId);
    expect(ids).not.toContain(profBId);
    expect(orgIds.every((o) => o === orgAId)).toBe(true);

    await client.auth.signOut();
  });

  it('clinic_staff de org A LÊ os profissionais da própria org (policy SELECT can_access)', async () => {
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client
      .from('professionals')
      .select('id, organization_id');

    expect(res.error).toBeNull();
    const ids = (res.data || []).map((r) => r.id);
    expect(ids).toContain(profAId);
    expect(ids).not.toContain(profBId);

    await client.auth.signOut();
  });

  it('clinic_staff NÃO consegue inserir profissional nem na própria org (mutação = can_configure)', async () => {
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client
      .from('professionals')
      .insert({ organization_id: orgAId, name: `Staff Bloqueado ${runId}`, active: true })
      .select('id')
      .single();

    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();

    await client.auth.signOut();
  });

  it('clinic_admin de org A NÃO consegue inserir profissional em org B (WITH CHECK cross-org)', async () => {
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client
      .from('professionals')
      .insert({ organization_id: orgBId, name: `Invasor ${runId}`, active: true })
      .select('id')
      .single();

    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();

    await client.auth.signOut();
  });

  it('clinic_admin de org A consegue inserir na própria org (controle positivo da policy)', async () => {
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client
      .from('professionals')
      .insert({ organization_id: orgAId, name: `Dra. Nova ${runId}`, specialty: 'Endodontia', active: true })
      .select('id, organization_id')
      .single();

    expect(res.error).toBeNull();
    expect(res.data?.organization_id).toBe(orgAId);

    await client.auth.signOut();
  });
});
