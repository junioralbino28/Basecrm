// @vitest-environment node
//
// Isolamento cross-tenant de leads + profiles — teste NÃO-tautológico (reescrito no M6).
//
// A versão antiga usava service-role + `.eq('organization_id', orgA)`: o filtro WHERE
// excluía org B, não a RLS — provava NADA. Aqui autentica um usuário REAL (clinic_staff
// de org A) via publishable key + signInWithPassword e faz SELECT SEM filtro algum.
// Quem isola é 100% a RLS (leads_select_by_tenant / profiles_select).
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
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
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
    user_metadata: { role: params.role, organization_id: params.organizationId },
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

describeSupabase('RLS hardening — isolamento cross-tenant leads/profiles (usuário real, RLS de verdade)', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let leadAId = '';
  let leadBId = '';
  let staffAId = '';
  let adminBId = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    const admin = getSupabaseAdminClient();

    const leadA = await admin
      .from('leads')
      .insert({ organization_id: orgAId, name: `Paciente A ${runId}`, email: `lead.a.${runId}@example.com`, status: 'NEW' })
      .select('id')
      .single();
    leadAId = requireSupabaseData(leadA, 'insert lead A').id;

    const leadB = await admin
      .from('leads')
      .insert({ organization_id: orgBId, name: `Paciente B ${runId}`, email: `lead.b.${runId}@example.com`, status: 'NEW' })
      .select('id')
      .single();
    leadBId = requireSupabaseData(leadB, 'insert lead B').id;

    staffEmail = `rls.staff.${runId}.${randomUUID()}@example.com`;
    staffAId = await createAuthUserWithProfile({ email: staffEmail, password, organizationId: orgAId, role: 'clinic_staff' });
    // admin de org B: prova que o staff de A nunca enxerga o profile de outra clínica
    adminBId = await createAuthUserWithProfile({
      email: `rls.adminB.${runId}.${randomUUID()}@example.com`,
      password,
      organizationId: orgBId,
      role: 'clinic_admin',
    });
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    if (leadAId) assertNoSupabaseError(await admin.from('leads').delete().eq('id', leadAId), 'delete lead A');
    if (leadBId) assertNoSupabaseError(await admin.from('leads').delete().eq('id', leadBId), 'delete lead B');
    if (staffAId) await admin.auth.admin.deleteUser(staffAId);
    if (adminBId) await admin.auth.admin.deleteUser(adminBId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('clinic_staff de org A, SELECT em leads SEM filtro, vê o lead de A e NUNCA o de B (RLS isola)', async () => {
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.from('leads').select('id, organization_id, email');
    expect(res.error).toBeNull();
    const ids = (res.data || []).map(r => r.id);
    const orgIds = (res.data || []).map(r => r.organization_id);

    expect(ids).toContain(leadAId);
    expect(ids).not.toContain(leadBId);
    expect(orgIds.every(o => o === orgAId)).toBe(true);

    await client.auth.signOut();
  });

  it('clinic_staff de org A, SELECT em profiles SEM filtro, nunca vê o profile do admin de org B', async () => {
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.from('profiles').select('id, organization_id');
    expect(res.error).toBeNull();
    const ids = (res.data || []).map(r => r.id);
    const orgIds = (res.data || []).map(r => r.organization_id);

    expect(ids).toContain(staffAId);       // vê o próprio
    expect(ids).not.toContain(adminBId);   // nunca o de org B
    expect(orgIds.every(o => o === orgAId)).toBe(true);

    await client.auth.signOut();
  });
});
