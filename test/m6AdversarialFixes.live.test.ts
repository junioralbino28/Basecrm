// @vitest-environment node
//
// M6 (parte 3) — prova AO VIVO os 4 fixes do review adversarial (usuário real, RLS de verdade):
//  1. organization_settings.ai_*_key: clinic_staff lê task_nudge_interval mas NÃO a chave de IA (coluna revogada).
//  2. organization_invites: clinic_staff NÃO lê token de convite (fecha escalada staff->admin).
//  3. organization_editions: clinic_staff NÃO lê a metadata (fecha apiKey Evolution duplicado).
//  4. audit_logs: clinic_staff NÃO forja log em org alheia (with check), mas grava o próprio.
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
  email: string; password: string; organizationId: string; role: 'clinic_admin' | 'clinic_staff';
}): Promise<string> {
  const admin = getSupabaseAdminClient();
  const created = await admin.auth.admin.createUser({
    email: params.email, password: params.password, email_confirm: true,
    user_metadata: { role: params.role, organization_id: params.organizationId },
  });
  if (created.error || !created.data?.user?.id) throw new Error(`createUser ${params.role}: ${created.error?.message}`);
  const userId = created.data.user.id;
  const displayName = params.email.split('@')[0] || params.role;
  assertNoSupabaseError(
    await admin.from('profiles').upsert(
      { id: userId, email: params.email, name: displayName, first_name: displayName,
        organization_id: params.organizationId, role: params.role, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    ),
    `upsert profile ${params.role}`,
  );
  return userId;
}

describeSupabase('M6 fixes adversariais — AO VIVO (usuário real)', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let staffAId = '';
  let staffEmail = '';
  let inviteToken = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;
    const admin = getSupabaseAdminClient();

    // (1) organization_settings com chave de IA na org A
    assertNoSupabaseError(
      await admin.from('organization_settings').upsert(
        { organization_id: orgAId, ai_google_key: `SECRET_G_${runId}`, task_nudge_interval_minutes: 30 },
        { onConflict: 'organization_id' },
      ),
      'seed organization_settings A',
    );

    // (2) convite clinic_admin PENDENTE na org A (email null = pior caso)
    const inv = await admin.from('organization_invites')
      .insert({ organization_id: orgAId, role: 'clinic_admin' })
      .select('token').single();
    inviteToken = (inv.data as any)?.token || '';

    // (3) organization_editions da org A com apiKey na metadata
    assertNoSupabaseError(
      await admin.from('organization_editions').upsert(
        { organization_id: orgAId, edition_key: 'clinic', metadata: { evolutionDefaults: { apiKey: `SECRET_E_${runId}` } } },
        { onConflict: 'organization_id' },
      ),
      'seed organization_editions A',
    );

    staffEmail = `m6fix.staff.${runId}.${randomUUID()}@example.com`;
    staffAId = await createAuthUserWithProfile({ email: staffEmail, password, organizationId: orgAId, role: 'clinic_staff' });
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    if (orgAId) {
      await admin.from('organization_settings').delete().eq('organization_id', orgAId);
      await admin.from('organization_invites').delete().eq('organization_id', orgAId);
      await admin.from('organization_editions').delete().eq('organization_id', orgAId);
      await admin.from('audit_logs').delete().eq('organization_id', orgAId);
    }
    if (orgBId) await admin.from('audit_logs').delete().eq('organization_id', orgBId);
    if (staffAId) await admin.auth.admin.deleteUser(staffAId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('(1) clinic_staff LÊ task_nudge_interval mas a chave de IA é INVISÍVEL (coluna revogada)', async () => {
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: staffEmail, password })).error).toBeNull();

    // coluna não-secret: ok
    const okCol = await client.from('organization_settings').select('task_nudge_interval_minutes').eq('organization_id', orgAId);
    expect(okCol.error).toBeNull();

    // coluna secret: permission denied (grant de coluna removido)
    const secret = await client.from('organization_settings').select('ai_google_key').eq('organization_id', orgAId);
    expect(secret.error).not.toBeNull();
    expect(secret.data).toBeNull();

    await client.auth.signOut();
  });

  it('(2) clinic_staff NÃO lê o token de convite clinic_admin (fecha escalada de privilégio)', async () => {
    expect(inviteToken).toBeTruthy(); // sanidade do seed
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: staffEmail, password })).error).toBeNull();

    const res = await client.from('organization_invites').select('token, role').eq('organization_id', orgAId);
    expect(res.error).toBeNull();
    expect((res.data || []).length).toBe(0); // RLS can_configure barra staff

    await client.auth.signOut();
  });

  it('(3) clinic_staff NÃO lê organization_editions (apiKey Evolution na metadata protegido)', async () => {
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: staffEmail, password })).error).toBeNull();

    const res = await client.from('organization_editions').select('organization_id, metadata').eq('organization_id', orgAId);
    expect(res.error).toBeNull();
    expect((res.data || []).length).toBe(0);

    await client.auth.signOut();
  });

  it('(4) clinic_staff NÃO forja audit_log em org alheia, mas grava o próprio (own+org válida)', async () => {
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: staffEmail, password })).error).toBeNull();

    // forjar log na org B (não é a org dela) → with check barra
    const forge = await client.from('audit_logs')
      .insert({ user_id: staffAId, organization_id: orgBId, action: 'FORGE', resource_type: 'x', severity: 'info' })
      .select('id').single();
    expect(forge.data).toBeNull();
    expect(forge.error).not.toBeNull();

    // gravar o próprio na org dela → ok
    const own = await client.from('audit_logs')
      .insert({ user_id: staffAId, organization_id: orgAId, action: 'OWN', resource_type: 'x', severity: 'info' })
      .select('id').single();
    expect(own.error).toBeNull();
    expect(own.data?.id).toBeTruthy();

    await client.auth.signOut();
  });
});
