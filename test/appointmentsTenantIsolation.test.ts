// @vitest-environment node
//
// Isolamento cross-tenant de `appointments` (cache da agenda) — teste NÃO-tautológico.
//
// Espelha test/professionals.multiTenant.test.ts e test/atendimentos.multiTenant.test.ts:
// autentica um usuário REAL clinic_staff da org A (auth admin API + signInWithPassword
// via publishable key) e faz SELECT SEM filtro de organization_id — quem isola é a RLS
// (appointments_select_by_tenant = can_access_organization). Mutação cross-org é barrada
// pelo WITH CHECK (appointments_mutate_by_tenant_operator = can_operate_organization).
//
// O vício antigo (service-role + WHERE org A) passaria mesmo com RLS vazada; aqui o
// isolamento é provado pela própria policy, com sessão de usuário real.
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

describeSupabase('appointments - isolamento multi-tenant (usuário real, RLS de verdade)', () => {
  let tableMissing = false;
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let apptAId = '';
  let apptBId = '';

  let staffUserId = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const admin = getSupabaseAdminClient();

    // Skip gracioso: tabela appointments ainda não aplicada no banco.
    const probe = await admin.from('appointments').select('id').limit(1);
    if (isMissingTableError(probe.error)) {
      tableMissing = true;
      console.warn(
        '[appointmentsTenantIsolation] tabela appointments ainda não aplicada — rodar pós-migração 20260627000000_appointments.sql',
      );
      return;
    }

    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    const insA = await admin
      .from('appointments')
      .insert({
        organization_id: orgAId,
        starts_at: '2026-06-12T09:00:00Z',
        status: 'agendado',
        source: 'clinicorp_api',
        external_id: `extA-${runId}`,
      })
      .select('id')
      .single();
    apptAId = requireSupabaseData(insA, 'insert appointment A').id;

    const insB = await admin
      .from('appointments')
      .insert({
        organization_id: orgBId,
        starts_at: '2026-06-12T10:00:00Z',
        status: 'agendado',
        source: 'clinicorp_api',
        external_id: `extB-${runId}`,
      })
      .select('id')
      .single();
    apptBId = requireSupabaseData(insB, 'insert appointment B').id;

    staffEmail = `appt.staff.${runId}.${randomUUID()}@example.com`;
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
        await admin.from('appointments').delete().eq('organization_id', orgAId),
        'delete appointments org A',
      );
    }
    if (orgBId) {
      assertNoSupabaseError(
        await admin.from('appointments').delete().eq('organization_id', orgBId),
        'delete appointments org B',
      );
    }

    if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);

    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('clinic_staff de org A, com SELECT SEM filtro, vê o appointment de A e NUNCA o de B (RLS isola)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    // Nenhum .eq('organization_id', ...) — o isolamento aqui é 100% RLS.
    const res = await client.from('appointments').select('id, organization_id, external_id');

    expect(res.error).toBeNull();
    const ids = (res.data || []).map(r => r.id);
    const orgIds = (res.data || []).map(r => r.organization_id);

    expect(ids).toContain(apptAId);
    expect(ids).not.toContain(apptBId);
    expect(orgIds.every(o => o === orgAId)).toBe(true);

    await client.auth.signOut();
  });

  it('clinic_staff de org A insere appointment na própria org (can_operate) e nunca cross-org', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    // Mutação na própria org: permitida pelo WITH CHECK (can_operate_organization).
    const own = await client
      .from('appointments')
      .insert({
        organization_id: orgAId,
        starts_at: '2026-06-13T08:00:00Z',
        status: 'agendado',
        source: 'manual',
        external_id: `extOwn-${runId}`,
      })
      .select('id, organization_id')
      .single();

    expect(own.error).toBeNull();
    expect(own.data?.organization_id).toBe(orgAId);

    // Mutação cross-org: barrada pelo WITH CHECK.
    const cross = await client
      .from('appointments')
      .insert({
        organization_id: orgBId,
        starts_at: '2026-06-13T09:00:00Z',
        status: 'agendado',
        source: 'manual',
        external_id: `extInvasor-${runId}`,
      })
      .select('id')
      .single();

    expect(cross.data).toBeNull();
    expect(cross.error).not.toBeNull();

    await client.auth.signOut();
  });
});
