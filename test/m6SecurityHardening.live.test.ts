// @vitest-environment node
//
// M6 — isolamento AO VIVO (usuário real, RLS de verdade). Prova, sem tautologia:
//  1. channel_connections.config.apiKey (SECRET) invisível a clinic_staff E clinic_admin
//     (service-role only). Fecha o furo: hoje a Vitória lia o apiKey do WhatsApp.
//  2. clinicorp_config.api_token (SECRET) invisível até ao clinic_admin (service-role only).
//  3. system_notifications: read escopado ao tenant (nunca vê o de outra clínica).
//  4. audit_logs: só admin lê os logs da PRÓPRIA org; staff não; nunca cross-tenant.
//  5. lifecycle_stages: leitura global OK, mas mutação (reference compartilhada) só agency_admin.
//
// Roda DEPOIS de aplicar 20260630000000_m6_security_hardening.sql. Sem skip que mascare
// o estado da migração — se o M6 não foi aplicado, ESTES testes falham (é o objetivo).
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
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
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

describeSupabase('M6 — secret-locks + cross-tenant AO VIVO (usuário real)', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let adminAId = '';
  let staffAId = '';
  let adminEmail = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;
  const auditMarker = () => `M6_TEST_${runId}`;

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;
    const admin = getSupabaseAdminClient();

    // SECRET Evolution na org A
    assertNoSupabaseError(
      await admin.from('channel_connections').insert({
        organization_id: orgAId,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: `Evo A ${runId}`,
        status: 'connected',
        config: { apiUrl: 'https://evo.example.com', apiKey: `SECRET_APIKEY_${runId}` },
      }),
      'seed channel_connections A',
    );

    // SECRET Clinicorp na org A
    assertNoSupabaseError(
      await admin.from('clinicorp_config').insert({
        organization_id: orgAId,
        api_user: 'barros',
        api_token: `SECRET_TOKEN_${runId}`,
        subscriber_id: 'barros',
        business_id: 999,
      }),
      'seed clinicorp_config A',
    );

    // system_notifications nas duas orgs
    assertNoSupabaseError(
      await admin.from('system_notifications').insert([
        { organization_id: orgAId, type: 'SYSTEM_INFO', title: `Notif A ${runId}`, message: 'a', severity: 'low' },
        { organization_id: orgBId, type: 'SYSTEM_INFO', title: `Notif B ${runId}`, message: 'b', severity: 'low' },
      ]),
      'seed system_notifications',
    );

    // audit_logs nas duas orgs (mesmo action marker; RLS é quem isola)
    assertNoSupabaseError(
      await admin.from('audit_logs').insert([
        { organization_id: orgAId, action: auditMarker(), resource_type: 'test', severity: 'info' },
        { organization_id: orgBId, action: auditMarker(), resource_type: 'test', severity: 'info' },
      ]),
      'seed audit_logs',
    );

    adminEmail = `m6.admin.${runId}.${randomUUID()}@example.com`;
    staffEmail = `m6.staff.${runId}.${randomUUID()}@example.com`;
    adminAId = await createAuthUserWithProfile({ email: adminEmail, password, organizationId: orgAId, role: 'clinic_admin' });
    staffAId = await createAuthUserWithProfile({ email: staffEmail, password, organizationId: orgAId, role: 'clinic_staff' });
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    if (orgAId) {
      await admin.from('channel_connections').delete().eq('organization_id', orgAId);
      await admin.from('clinicorp_config').delete().eq('organization_id', orgAId);
      await admin.from('system_notifications').delete().eq('organization_id', orgAId);
    }
    if (orgBId) {
      await admin.from('system_notifications').delete().eq('organization_id', orgBId);
    }
    if (runId) await admin.from('audit_logs').delete().eq('action', auditMarker());
    if (adminAId) await admin.auth.admin.deleteUser(adminAId);
    if (staffAId) await admin.auth.admin.deleteUser(staffAId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('SECRET: clinic_staff NÃO lê channel_connections (apiKey do WhatsApp fora do browser)', async () => {
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: staffEmail, password })).error).toBeNull();
    const res = await client.from('channel_connections').select('id, config');
    expect(res.error).toBeNull();
    expect((res.data || []).length).toBe(0); // service-role only
    await client.auth.signOut();
  });

  it('SECRET: clinic_admin também NÃO lê channel_connections (nem o dono vê o apiKey no browser)', async () => {
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: adminEmail, password })).error).toBeNull();
    const res = await client.from('channel_connections').select('id, config');
    expect(res.error).toBeNull();
    expect((res.data || []).length).toBe(0);
    await client.auth.signOut();
  });

  it('SECRET: clinic_admin NÃO lê clinicorp_config (api_token fora do browser)', async () => {
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: adminEmail, password })).error).toBeNull();
    const res = await client.from('clinicorp_config').select('id, api_token');
    expect(res.error).toBeNull();
    expect((res.data || []).length).toBe(0);
    await client.auth.signOut();
  });

  it('system_notifications: clinic_staff de A vê a notif de A e NUNCA a de B (RLS isola)', async () => {
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: staffEmail, password })).error).toBeNull();
    const res = await client.from('system_notifications').select('id, organization_id, title');
    expect(res.error).toBeNull();
    const orgIds = (res.data || []).map(r => r.organization_id);
    const titles = (res.data || []).map(r => r.title);
    expect(titles).toContain(`Notif A ${runId}`);
    expect(titles).not.toContain(`Notif B ${runId}`);
    expect(orgIds.every(o => o === orgAId)).toBe(true);
    await client.auth.signOut();
  });

  it('audit_logs: clinic_admin de A lê o log de A e NUNCA o de B (SELECT can_configure)', async () => {
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: adminEmail, password })).error).toBeNull();
    // .eq('action') isola NOSSAS linhas de teste; o org é filtrado pela RLS, não pelo WHERE
    const res = await client.from('audit_logs').select('id, organization_id').eq('action', auditMarker());
    expect(res.error).toBeNull();
    const orgIds = (res.data || []).map(r => r.organization_id);
    expect(orgIds).toContain(orgAId);
    expect(orgIds).not.toContain(orgBId);
    await client.auth.signOut();
  });

  it('audit_logs: clinic_staff NÃO lê logs da org (não é admin) — append-only pela recepção', async () => {
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: staffEmail, password })).error).toBeNull();
    const res = await client.from('audit_logs').select('id').eq('action', auditMarker());
    expect(res.error).toBeNull();
    expect((res.data || []).length).toBe(0);
    await client.auth.signOut();
  });

  it('lifecycle_stages: clinic_staff LÊ o reference global, mas NÃO consegue mutar (só agency_admin)', async () => {
    const client = createUserClient();
    expect((await client.auth.signInWithPassword({ email: staffEmail, password })).error).toBeNull();

    const read = await client.from('lifecycle_stages').select('id');
    expect(read.error).toBeNull();
    expect((read.data || []).length).toBeGreaterThanOrEqual(5); // 5 stages globais semeados

    const write = await client
      .from('lifecycle_stages')
      .insert({ id: `M6TEST_${runId}`, name: 'invasor', color: 'bg-x', order: 99 })
      .select('id')
      .single();
    expect(write.data).toBeNull();
    expect(write.error).not.toBeNull(); // RLS: mutação de reference global bloqueada

    await client.auth.signOut();
  });
});
