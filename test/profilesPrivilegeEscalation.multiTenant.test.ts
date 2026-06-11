// @vitest-environment node
//
// CRÍTICO — trava de escalonamento de privilégio em profiles (review F8).
//
// Prova NÃO-tautológica com usuário REAL autenticado (publishable key +
// signInWithPassword): a Vitória (clinic_staff) NÃO consegue se promover a
// clinic_admin nem pular de organização editando a própria linha — mesmo com a
// RLS por linha permitindo (id = auth.uid()). O guard é o trigger BEFORE UPDATE
// prevent_profile_privilege_escalation (migração 20260623000000).
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { getSupabaseAdminClient, assertNoSupabaseError } from './helpers/supabaseAdmin';
import { loadEnvFile, getAnonKey } from './helpers/env';

const nextRoot = process.cwd();
const repoRoot = `${nextRoot}/..`;
loadEnvFile(`${repoRoot}/.env`);
loadEnvFile(`${repoRoot}/.env.local`, { override: true });
loadEnvFile(`${nextRoot}/.env`);
loadEnvFile(`${nextRoot}/.env.local`, { override: true });

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = getAnonKey();

const hasRealSupabaseCreds =
  Boolean(supabaseUrl) &&
  Boolean(serviceRoleKey) &&
  Boolean(anonKey) &&
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

async function createStaff(params: { email: string; password: string; organizationId: string }): Promise<string> {
  const admin = getSupabaseAdminClient();
  const created = await admin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
    user_metadata: { role: 'clinic_staff', organization_id: params.organizationId },
  });
  if (created.error || !created.data?.user?.id) {
    throw new Error(`Falha ao criar staff: ${created.error?.message}`);
  }
  const userId = created.data.user.id;
  const displayName = params.email.split('@')[0] || 'staff';
  assertNoSupabaseError(
    await admin.from('profiles').upsert(
      {
        id: userId,
        email: params.email,
        name: displayName,
        first_name: displayName,
        organization_id: params.organizationId,
        role: 'clinic_staff',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    ),
    'upsert profile staff',
  );
  return userId;
}

describeSupabase('profiles — trava de escalonamento de privilégio (usuário real)', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let staffUserId = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;
    staffEmail = `profesc.staff.${runId}.${randomUUID()}@example.com`;
    staffUserId = await createStaff({ email: staffEmail, password, organizationId: orgAId });
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('clinic_staff NÃO consegue se promover a clinic_admin (trigger bloqueia)', async () => {
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.from('profiles').update({ role: 'clinic_admin' }).eq('id', staffUserId).select('id, role');
    // o update é barrado (erro do trigger) — e nunca persiste
    expect(res.error).not.toBeNull();

    const check = await getSupabaseAdminClient().from('profiles').select('role').eq('id', staffUserId).single();
    expect((check.data as { role: string }).role).toBe('clinic_staff');

    await client.auth.signOut();
  });

  it('clinic_staff NÃO consegue pular de organização (trigger bloqueia)', async () => {
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.from('profiles').update({ organization_id: orgBId }).eq('id', staffUserId).select('id');
    expect(res.error).not.toBeNull();

    const check = await getSupabaseAdminClient().from('profiles').select('organization_id').eq('id', staffUserId).single();
    expect((check.data as { organization_id: string }).organization_id).toBe(orgAId);

    await client.auth.signOut();
  });

  it('clinic_staff AINDA edita o próprio nome (uso legítimo não é bloqueado)', async () => {
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const novoNome = `Vitória ${runId}`;
    const res = await client.from('profiles').update({ name: novoNome }).eq('id', staffUserId).select('name').single();
    expect(res.error).toBeNull();
    expect((res.data as { name: string }).name).toBe(novoNome);

    await client.auth.signOut();
  });
});
