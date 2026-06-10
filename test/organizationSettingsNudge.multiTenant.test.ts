// @vitest-environment node
//
// Isolamento + gate de papel do nudge de tarefas (N3) — teste NÃO-tautológico.
//
// Espelha test/tasks.multiTenant.test.ts: autentica usuários REAIS via
// publishable key + signInWithPassword, sem filtro manual — quem decide é a
// RLS. organization_settings é tabela de CONFIG (select = can_access,
// mutate = can_configure), então o caso obrigatório do adendo é:
//   clinic_staff (Vitória) LÊ o intervalo (o nudge precisa ler) mas NÃO muta;
//   clinic_admin (Adel) muta o da própria org e NUNCA o da org B.
//
// Também prova no banco (service role) a invariante de domínio:
// task_nudge_interval_minutes é null ou 15/30/60 — CHECK rejeita 45.
//
// ⚠️ Skip gracioso: se a coluna ainda não existe no banco (migração
// 20260619000000 não aplicada), a suíte inteira é pulada com aviso.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import {
  getSupabaseAdminClient,
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

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /task_nudge_interval_minutes|does not exist|schema cache/i.test(error.message || '')
  );
}

describeSupabase('organization_settings.task_nudge_interval — gate can_configure (usuário real, RLS de verdade)', () => {
  let columnMissing = false;
  let runId = '';
  let orgAId = '';
  let orgBId = '';

  let staffUserId = '';
  let staffEmail = '';
  let adminUserId = '';
  let adminEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const admin = getSupabaseAdminClient();

    // Skip gracioso: coluna ainda não aplicada no banco.
    const probe = await admin
      .from('organization_settings')
      .select('task_nudge_interval_minutes')
      .limit(1);
    if (isMissingColumnError(probe.error)) {
      columnMissing = true;
      console.warn(
        '[organizationSettingsNudge.multiTenant] coluna task_nudge_interval_minutes ainda não aplicada — rodar pós-migração 20260619000000_task_nudge_interval.sql',
      );
      return;
    }

    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    // Garante a linha de settings das duas orgs (trigger cria na org nova;
    // upsert idempotente cobre fixtures antigas).
    for (const orgId of [orgAId, orgBId]) {
      assertNoSupabaseError(
        await admin
          .from('organization_settings')
          .upsert({ organization_id: orgId }, { onConflict: 'organization_id' }),
        'upsert organization_settings',
      );
    }

    staffEmail = `nudge.staff.${runId}.${randomUUID()}@example.com`;
    staffUserId = await createAuthUserWithProfile({
      email: staffEmail,
      password,
      organizationId: orgAId,
      role: 'clinic_staff',
    });

    adminEmail = `nudge.admin.${runId}.${randomUUID()}@example.com`;
    adminUserId = await createAuthUserWithProfile({
      email: adminEmail,
      password,
      organizationId: orgAId,
      role: 'clinic_admin',
    });
  }, 120_000);

  afterAll(async () => {
    if (columnMissing) return;
    const admin = getSupabaseAdminClient();

    if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);
    if (adminUserId) await admin.auth.admin.deleteUser(adminUserId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('clinic_staff LÊ o intervalo da própria org (o nudge precisa ler) e NUNCA o da org B', async ctx => {
    if (columnMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    // Nenhum .eq('organization_id', ...) — o isolamento aqui é 100% RLS.
    const res = await client
      .from('organization_settings')
      .select('organization_id, task_nudge_interval_minutes');

    expect(res.error).toBeNull();
    const orgIds = (res.data || []).map(r => r.organization_id);
    expect(orgIds).toContain(orgAId);
    expect(orgIds).not.toContain(orgBId);

    await client.auth.signOut();
  });

  it('clinic_staff NÃO muta o intervalo (update vira no-op — mutate = can_configure)', async ctx => {
    if (columnMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const upd = await client
      .from('organization_settings')
      .update({ task_nudge_interval_minutes: 15 })
      .eq('organization_id', orgAId)
      .select('organization_id');
    expect(upd.error).toBeNull();
    expect(upd.data ?? []).toHaveLength(0);

    // Visão do service role: o valor NÃO mudou.
    const admin = getSupabaseAdminClient();
    const still = await admin
      .from('organization_settings')
      .select('task_nudge_interval_minutes')
      .eq('organization_id', orgAId)
      .single();
    expect(still.error).toBeNull();
    expect(still.data?.task_nudge_interval_minutes).toBeNull();

    await client.auth.signOut();
  });

  it('clinic_admin configura o intervalo da própria org (30) e desliga (null)', async ctx => {
    if (columnMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const set = await client
      .from('organization_settings')
      .update({ task_nudge_interval_minutes: 30 })
      .eq('organization_id', orgAId)
      .select('task_nudge_interval_minutes')
      .single();
    expect(set.error).toBeNull();
    expect(set.data?.task_nudge_interval_minutes).toBe(30);

    const off = await client
      .from('organization_settings')
      .update({ task_nudge_interval_minutes: null })
      .eq('organization_id', orgAId)
      .select('task_nudge_interval_minutes')
      .single();
    expect(off.error).toBeNull();
    expect(off.data?.task_nudge_interval_minutes).toBeNull();

    await client.auth.signOut();
  });

  it('clinic_admin de A NÃO muta o intervalo da org B (update vira no-op cross-org)', async ctx => {
    if (columnMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: adminEmail, password });
    expect(signIn.error).toBeNull();

    const upd = await client
      .from('organization_settings')
      .update({ task_nudge_interval_minutes: 60 })
      .eq('organization_id', orgBId)
      .select('organization_id');
    expect(upd.error).toBeNull();
    expect(upd.data ?? []).toHaveLength(0);

    const admin = getSupabaseAdminClient();
    const still = await admin
      .from('organization_settings')
      .select('task_nudge_interval_minutes')
      .eq('organization_id', orgBId)
      .single();
    expect(still.error).toBeNull();
    expect(still.data?.task_nudge_interval_minutes).toBeNull();

    await client.auth.signOut();
  });

  it('banco rejeita intervalo fora do domínio (CHECK 15/30/60), mesmo via service role', async ctx => {
    if (columnMissing) return ctx.skip();
    const admin = getSupabaseAdminClient();

    const bad = await admin
      .from('organization_settings')
      .update({ task_nudge_interval_minutes: 45 })
      .eq('organization_id', orgAId)
      .select('organization_id')
      .single();
    expect(bad.data).toBeNull();
    expect(bad.error).not.toBeNull();
  });
});
