// @vitest-environment node
//
// Isolamento cross-tenant das tarefas (N2) — teste NÃO-tautológico.
//
// Espelha test/financeConfig.multiTenant.test.ts: autentica usuários REAIS via
// publishable key + signInWithPassword e faz SELECT SEM filtro algum — quem
// isola é a RLS. Diferença vs config financeira: tasks é tabela OPERACIONAL
// (SELECT can_access / mutação can_operate) — o caso obrigatório é
// clinic_staff (Vitória) OPERAR tasks da PRÓPRIA org e NUNCA da org B.
//
// Também prova no banco (service role, sem RLS no caminho) as invariantes:
// done ⇔ completed_at · type/status do domínio · contact_preference do domínio.
//
// ⚠️ Skip gracioso: se a tabela tasks ainda não existe no banco (migração
// 20260618000000 não aplicada), a suíte inteira é pulada com aviso.
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

describeSupabase('tasks - isolamento multi-tenant operacional (usuário real, RLS de verdade)', () => {
  let tableMissing = false;
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let contactAId = '';
  let taskAId = '';
  let taskBId = '';

  let staffUserId = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const admin = getSupabaseAdminClient();

    // Skip gracioso: tabela tasks ainda não aplicada no banco.
    const probe = await admin.from('tasks').select('id').limit(1);
    if (isMissingTableError(probe.error)) {
      tableMissing = true;
      console.warn(
        '[tasks.multiTenant] tabela tasks ainda não aplicada — rodar pós-migração 20260618000000_tasks.sql',
      );
      return;
    }

    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;
    contactAId = fx.contactA.contactId;

    const insA = await admin
      .from('tasks')
      .insert({
        organization_id: orgAId,
        contact_id: contactAId,
        type: 'reminder',
        title: `Retorno raio-X A ${runId}`,
        due_date: '2026-06-17',
        julia_first: true,
      })
      .select('id')
      .single();
    taskAId = requireSupabaseData(insA, 'insert task A').id;

    const insB = await admin
      .from('tasks')
      .insert({
        organization_id: orgBId,
        type: 'call',
        title: `Ligar paciente B ${runId}`,
        due_date: '2026-06-18',
      })
      .select('id')
      .single();
    taskBId = requireSupabaseData(insB, 'insert task B').id;

    staffEmail = `tasks.staff.${runId}.${randomUUID()}@example.com`;
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
          await admin.from('tasks').delete().eq('organization_id', orgId),
          'delete tasks',
        );
      }
    }

    if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('clinic_staff de org A, com SELECT SEM filtro, vê a task de A e NUNCA a de B (RLS isola)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    // Nenhum .eq('organization_id', ...) — o isolamento aqui é 100% RLS.
    const res = await client.from('tasks').select('id, organization_id, title');

    expect(res.error).toBeNull();
    const ids = (res.data || []).map(r => r.id);
    const orgIds = (res.data || []).map(r => r.organization_id);

    expect(ids).toContain(taskAId);
    expect(ids).not.toContain(taskBId);
    expect(orgIds.every(o => o === orgAId)).toBe(true);

    await client.auth.signOut();
  });

  it('clinic_staff (Vitória) CRIA e CONCLUI task na própria org (mutação = can_operate, não deny-all)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const ins = await client
      .from('tasks')
      .insert({
        organization_id: orgAId,
        type: 'call',
        title: `Tarefa da Vitória ${runId}`,
        due_date: '2026-06-19',
      })
      .select('id, organization_id, status')
      .single();

    expect(ins.error).toBeNull();
    expect(ins.data?.organization_id).toBe(orgAId);
    expect(ins.data?.status).toBe('open');

    // Concluir = done + completed_at JUNTOS (CHECK do banco exige os dois).
    const done = await client
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', ins.data!.id)
      .select('status, completed_at')
      .single();

    expect(done.error).toBeNull();
    expect(done.data?.status).toBe('done');
    expect(done.data?.completed_at).not.toBeNull();

    await client.auth.signOut();
  });

  it('clinic_staff de org A NÃO insere task em org B (WITH CHECK cross-org)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client
      .from('tasks')
      .insert({
        organization_id: orgBId,
        type: 'reminder',
        title: `Invasora ${runId}`,
        due_date: '2026-06-19',
      })
      .select('id')
      .single();

    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();

    await client.auth.signOut();
  });

  it('clinic_staff de org A NÃO atualiza nem exclui task da org B (update/delete viram no-op)', async ctx => {
    if (tableMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const upd = await client
      .from('tasks')
      .update({ title: `Hackeada ${runId}` })
      .eq('id', taskBId)
      .select('id');
    expect(upd.error).toBeNull();
    expect(upd.data ?? []).toHaveLength(0);

    const del = await client.from('tasks').delete().eq('id', taskBId).select('id');
    expect(del.error).toBeNull();
    expect(del.data ?? []).toHaveLength(0);

    // A task de B continua intacta (visão do service role).
    const admin = getSupabaseAdminClient();
    const still = await admin.from('tasks').select('id, title').eq('id', taskBId).single();
    expect(still.error).toBeNull();
    expect(still.data?.title).toBe(`Ligar paciente B ${runId}`);

    await client.auth.signOut();
  });

  it('banco rejeita done sem completed_at e completed_at sem done (invariante F4)', async ctx => {
    if (tableMissing) return ctx.skip();
    const admin = getSupabaseAdminClient();

    // done sem completed_at viola tasks_done_completed_at_chk mesmo via service role.
    const doneSemCarimbo = await admin
      .from('tasks')
      .insert({
        organization_id: orgAId,
        type: 'reminder',
        title: `Done sem carimbo ${runId}`,
        due_date: '2026-06-19',
        status: 'done',
      })
      .select('id')
      .single();
    expect(doneSemCarimbo.data).toBeNull();
    expect(doneSemCarimbo.error).not.toBeNull();

    // completed_at preenchido com status open também viola (vice-versa).
    const carimboSemDone = await admin
      .from('tasks')
      .insert({
        organization_id: orgAId,
        type: 'reminder',
        title: `Carimbo sem done ${runId}`,
        due_date: '2026-06-19',
        status: 'open',
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    expect(carimboSemDone.data).toBeNull();
    expect(carimboSemDone.error).not.toBeNull();
  });

  it('banco rejeita type/status fora do domínio (CHECKs)', async ctx => {
    if (tableMissing) return ctx.skip();
    const admin = getSupabaseAdminClient();

    const badType = await admin
      .from('tasks')
      .insert({
        organization_id: orgAId,
        type: 'email',
        title: `Tipo inválido ${runId}`,
        due_date: '2026-06-19',
      })
      .select('id')
      .single();
    expect(badType.data).toBeNull();
    expect(badType.error).not.toBeNull();

    const badStatus = await admin
      .from('tasks')
      .insert({
        organization_id: orgAId,
        type: 'call',
        title: `Status inválido ${runId}`,
        due_date: '2026-06-19',
        status: 'paused',
      })
      .select('id')
      .single();
    expect(badStatus.data).toBeNull();
    expect(badStatus.error).not.toBeNull();
  });

  it('contacts.contact_preference: aceita whatsapp_only e rejeita fora do domínio', async ctx => {
    if (tableMissing) return ctx.skip();
    const admin = getSupabaseAdminClient();

    // Coluna pode não existir se só a parte de tasks foi aplicada — skip coerente.
    const ok = await admin
      .from('contacts')
      .update({ contact_preference: 'whatsapp_only' })
      .eq('id', contactAId)
      .select('contact_preference')
      .single();
    if (ok.error && /contact_preference/.test(ok.error.message || '')) {
      console.warn('[tasks.multiTenant] contacts.contact_preference ainda não aplicada — skip');
      return ctx.skip();
    }
    expect(ok.error).toBeNull();
    expect(ok.data?.contact_preference).toBe('whatsapp_only');

    const bad = await admin
      .from('contacts')
      .update({ contact_preference: 'sms_only' })
      .eq('id', contactAId)
      .select('id')
      .single();
    expect(bad.data).toBeNull();
    expect(bad.error).not.toBeNull();
  });
});
