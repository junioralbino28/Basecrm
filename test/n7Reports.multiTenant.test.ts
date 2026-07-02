// @vitest-environment node
//
// N7 — planilhas conectadas. Prova AO VIVO (usuário real, RLS de verdade):
//  1. buildSummaryCsv (link público) = SÓ TOTAIS, NUNCA telefone/nome de paciente.
//  2. validate_report_token resolve o token de planilha -> org; revogado -> vazio.
//  3. CRÍTICO (fix adversarial): report_token e api_key são espaços DISJUNTOS —
//     um report_token NÃO vale como api_key (não abre /contacts PII, /mcp, escrita) e vice-versa.
//  4. buildAtendimentosCsv (export logado) traz a PII da própria org e NENHUMA da outra.
//  5. create_report_token: clinic_admin (Adel) gera; clinic_staff (Vitória) leva Forbidden.
import { createHash, randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { getSupabaseAdminClient, assertNoSupabaseError } from './helpers/supabaseAdmin';
import { loadEnvFile, getAnonKey } from './helpers/env';
import { buildSummaryCsv } from '@/lib/reports/summaryCsv';
import { buildAtendimentosCsv } from '@/lib/reports/atendimentosCsv';

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

describeSupabase('N7 — planilhas conectadas AO VIVO (token de planilha isolado + export logado)', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let adminAId = '';
  let staffAId = '';
  let adminEmail = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;
  let reportToken = '';
  let reportTokenId = '';
  let apiToken = '';
  let phoneA = '';
  let phoneB = '';

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;
    const admin = getSupabaseAdminClient();

    phoneA = `PHONE_A_${runId}`;
    phoneB = `PHONE_B_${runId}`;
    assertNoSupabaseError(await admin.from('contacts').update({ phone: phoneA }).eq('id', fx.contactA.contactId), 'phone A');
    assertNoSupabaseError(await admin.from('contacts').update({ phone: phoneB }).eq('id', fx.contactB.contactId), 'phone B');

    assertNoSupabaseError(
      await admin.from('atendimentos').insert({
        organization_id: orgAId, contact_id: fx.contactA.contactId, procedimento: `Limpeza ${runId}`,
        valor: 250, desconto: 0, payment_method: 'pix', installments: 1, recebido: true,
        paid_at: new Date().toISOString(), performed_at: new Date().toISOString(),
      }), 'atendimento A');
    assertNoSupabaseError(
      await admin.from('atendimentos').insert({
        organization_id: orgBId, contact_id: fx.contactB.contactId, procedimento: `Canal ${runId}`,
        valor: 999, desconto: 0, payment_method: 'pix', installments: 1, recebido: true,
        paid_at: new Date().toISOString(), performed_at: new Date().toISOString(),
      }), 'atendimento B');

    assertNoSupabaseError(await admin.from('leads').insert({ organization_id: orgAId, name: `Lead A ${runId}`, status: 'NEW' }), 'lead A');
    assertNoSupabaseError(await admin.from('leads').insert({ organization_id: orgBId, name: `Lead B ${runId}`, status: 'NEW' }), 'lead B');

    // token de PLANILHA (report_tokens) — espaço isolado
    reportToken = `rpt_test_${runId}`;
    const rHash = createHash('sha256').update(reportToken).digest('hex');
    const rIns = await admin.from('report_tokens')
      .insert({ organization_id: orgAId, name: 'Planilha Test', key_prefix: reportToken.slice(0, 16), key_hash: rHash })
      .select('id').single();
    reportTokenId = (rIns.data as any)?.id || '';
    if (rIns.error) throw new Error(`seed report_token: ${rIns.error.message}`);

    // api_key FULL (api_keys) — pra provar disjunção
    apiToken = `ncrm_test_${runId}`;
    const aHash = createHash('sha256').update(apiToken).digest('hex');
    assertNoSupabaseError(
      await admin.from('api_keys').insert({ organization_id: orgAId, name: 'API Test', key_prefix: apiToken.slice(0, 12), key_hash: aHash }),
      'seed api_key');

    adminEmail = `n7.admin.${runId}.${randomUUID()}@example.com`;
    staffEmail = `n7.staff.${runId}.${randomUUID()}@example.com`;
    adminAId = await createAuthUserWithProfile({ email: adminEmail, password, organizationId: orgAId, role: 'clinic_admin' });
    staffAId = await createAuthUserWithProfile({ email: staffEmail, password, organizationId: orgAId, role: 'clinic_staff' });
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    if (orgAId) {
      await admin.from('atendimentos').delete().eq('organization_id', orgAId);
      await admin.from('leads').delete().eq('organization_id', orgAId);
      await admin.from('report_tokens').delete().eq('organization_id', orgAId);
      await admin.from('api_keys').delete().eq('organization_id', orgAId);
    }
    if (orgBId) {
      await admin.from('atendimentos').delete().eq('organization_id', orgBId);
      await admin.from('leads').delete().eq('organization_id', orgBId);
    }
    if (adminAId) await admin.auth.admin.deleteUser(adminAId);
    if (staffAId) await admin.auth.admin.deleteUser(staffAId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('(1) buildSummaryCsv da org A: totais corretos e SEM PII', async () => {
    const admin = getSupabaseAdminClient();
    const csv = await buildSummaryCsv(admin, orgAId);
    expect(csv).toContain('Faturamento (total),250.00'); // só org A (999 da B não entra)
    expect(csv).toContain('Leads (total),1');
    expect(csv).not.toContain(phoneA);
    expect(csv).not.toContain(`Limpeza ${runId}`);
  });

  it('(2) validate_report_token: token -> org A; revogado -> vazio', async () => {
    const anon = createUserClient();
    const ok = await anon.rpc('validate_report_token', { p_token: reportToken }).maybeSingle();
    expect(ok.error).toBeNull();
    expect((ok.data as any)?.organization_id).toBe(orgAId);

    const admin = getSupabaseAdminClient();
    assertNoSupabaseError(await admin.from('report_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', reportTokenId), 'revoke');
    const revoked = await anon.rpc('validate_report_token', { p_token: reportToken }).maybeSingle();
    expect(revoked.data).toBeNull();
    // desfaz p/ os outros testes
    assertNoSupabaseError(await admin.from('report_tokens').update({ revoked_at: null }).eq('id', reportTokenId), 'unrevoke');
  });

  it('(3) CRÍTICO: report_token e api_key são DISJUNTOS (link nunca abre a API full/PII)', async () => {
    const anon = createUserClient();
    // report_token NÃO vale como api_key (não autentica /contacts, /mcp, escrita)
    const asApiKey = await anon.rpc('validate_api_key', { p_token: reportToken }).maybeSingle();
    expect(asApiKey.data).toBeNull();
    // api_key NÃO vale como report_token (a rota de totais não aceita chave full)
    const asReport = await anon.rpc('validate_report_token', { p_token: apiToken }).maybeSingle();
    expect(asReport.data).toBeNull();
  });

  it('(4) buildAtendimentosCsv da org A: PII da própria org, NENHUMA da org B', async () => {
    const admin = getSupabaseAdminClient();
    const csv = await buildAtendimentosCsv(admin, orgAId);
    expect(csv).toContain(phoneA);
    expect(csv).not.toContain(phoneB);
    expect(csv).toContain('Paciente');
  });

  it('(5) create_report_token: clinic_admin gera; clinic_staff leva Forbidden', async () => {
    const adminClient = createUserClient();
    expect((await adminClient.auth.signInWithPassword({ email: adminEmail, password })).error).toBeNull();
    const gen = await adminClient.rpc('create_report_token', { p_name: `Planilha ${runId}` }).maybeSingle();
    expect(gen.error).toBeNull();
    expect((gen.data as any)?.token).toBeTruthy();
    expect(String((gen.data as any)?.token)).toContain('rpt_'); // prefixo distinto
    const admin = getSupabaseAdminClient();
    await admin.from('report_tokens').delete().eq('organization_id', orgAId).neq('id', reportTokenId);
    await adminClient.auth.signOut();

    const staffClient = createUserClient();
    expect((await staffClient.auth.signInWithPassword({ email: staffEmail, password })).error).toBeNull();
    const denied = await staffClient.rpc('create_report_token', { p_name: 'x' }).maybeSingle();
    expect(denied.error).not.toBeNull();
    await staffClient.auth.signOut();
  });
});
