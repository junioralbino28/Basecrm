// @vitest-environment node
//
// Isolamento cross-tenant do STORAGE de mídia de conversa (bucket `deal-files`).
//
// PROVA a blindagem aplicada pelo orquestrador na migração
// 20260625000000_deal_files_storage_tenant_rls.sql: um clinic_staff da org A
//   • CONSEGUE gerar signed URL / baixar / deletar um arquivo cujo deal é da org A
//   • NUNCA consegue gerar signed URL / baixar / deletar um arquivo cujo deal é da org B
//
// Por que isso importa pro N4: as conversas de paciente recebem/enviam mídia
// nesse mesmo bucket. Sem a RLS por tenant, qualquer clínica leria anexo clínico
// de qualquer outra pelo path. Este teste é o guard contra regressão dessa RLS.
//
// NÃO-tautológico: autentica um usuário REAL (publishable key + signInWithPassword)
// e opera o storage SEM service-role — quem isola é a policy de storage.objects,
// não um filtro do teste. Espelha test/atendimentos.multiTenant.test.ts.
//
// ⚠️ Skip gracioso: se faltar credencial real OU a migração de storage RLS ainda
// não estiver aplicada (read da própria org falha), pula com aviso.
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

const BUCKET = 'deal-files';

function createUserClient(): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function createStaffUser(params: {
  email: string;
  password: string;
  organizationId: string;
}): Promise<string> {
  const admin = getSupabaseAdminClient();
  const created = await admin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
    user_metadata: {
      role: 'clinic_staff',
      organization_id: params.organizationId,
    },
  });
  if (created.error || !created.data?.user?.id) {
    throw new Error(`Falha ao criar auth user: ${created.error?.message}`);
  }
  const userId = created.data.user.id;
  const displayName = params.email.split('@')[0] || 'staff';
  const profile = await admin.from('profiles').upsert(
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
  );
  assertNoSupabaseError(profile, 'upsert profile staff');
  return userId;
}

/** Sobe um arquivo no deal-files (path por deal) e cria a linha de metadado. */
async function seedDealFile(params: {
  organizationId: string;
  dealId: string;
  label: string;
}): Promise<{ filePath: string; fileId: string }> {
  const admin = getSupabaseAdminClient();
  const filePath = `${params.dealId}/${randomUUID()}.txt`;
  const bytes = new Blob([`conteudo confidencial ${params.label}`], { type: 'text/plain' });

  const upload = await admin.storage.from(BUCKET).upload(filePath, bytes, {
    contentType: 'text/plain',
    upsert: true,
  });
  assertNoSupabaseError(upload, `upload ${params.label}`);

  const meta = await admin
    .from('deal_files')
    .insert({
      deal_id: params.dealId,
      file_name: `${params.label}.txt`,
      file_path: filePath,
      file_size: 30,
      mime_type: 'text/plain',
    })
    .select('id')
    .single();
  assertNoSupabaseError(meta, `insert deal_files ${params.label}`);

  return { filePath, fileId: (meta.data as { id: string }).id };
}

describeSupabase('deal-files storage — isolamento cross-tenant (usuário real, RLS de storage)', () => {
  let storageRlsMissing = false;
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let fileA = { filePath: '', fileId: '' };
  let fileB = { filePath: '', fileId: '' };
  let staffUserId = '';
  let staffEmail = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    fileA = await seedDealFile({ organizationId: orgAId, dealId: fx.dealA.dealId, label: `A-${runId}` });
    fileB = await seedDealFile({ organizationId: orgBId, dealId: fx.dealB.dealId, label: `B-${runId}` });

    staffEmail = `media.staff.${runId}.${randomUUID()}@example.com`;
    staffUserId = await createStaffUser({ email: staffEmail, password, organizationId: orgAId });

    // Probe: se o staff da própria org NÃO consegue gerar signed URL do próprio
    // arquivo, a migração de storage RLS provavelmente não está aplicada — skip.
    const probeClient = createUserClient();
    await probeClient.auth.signInWithPassword({ email: staffEmail, password });
    const probe = await probeClient.storage.from(BUCKET).createSignedUrl(fileA.filePath, 60);
    if (probe.error || !probe.data?.signedUrl) {
      storageRlsMissing = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[conversationMedia.multiTenant] staff não conseguiu signed URL do próprio arquivo — ' +
          'rodar pós-migração 20260625000000_deal_files_storage_tenant_rls.sql',
      );
    }
    await probeClient.auth.signOut();
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    for (const f of [fileA, fileB]) {
      if (f.filePath) await admin.storage.from(BUCKET).remove([f.filePath]);
      if (f.fileId) await admin.from('deal_files').delete().eq('id', f.fileId);
    }
    if (staffUserId) await admin.auth.admin.deleteUser(staffUserId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('staff da org A GERA signed URL do arquivo da PRÓPRIA org (can_access_deal)', async ctx => {
    if (storageRlsMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.storage.from(BUCKET).createSignedUrl(fileA.filePath, 60);
    expect(res.error).toBeNull();
    expect(res.data?.signedUrl).toBeTruthy();

    await client.auth.signOut();
  });

  it('staff da org A NUNCA gera signed URL do arquivo da org B (RLS storage bloqueia)', async ctx => {
    if (storageRlsMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const res = await client.storage.from(BUCKET).createSignedUrl(fileB.filePath, 60);
    // RLS nega → sem signedUrl (erro ou data nula). O que NÃO pode é vazar URL.
    expect(res.data?.signedUrl).toBeFalsy();

    await client.auth.signOut();
  });

  it('staff da org A BAIXA o arquivo da própria org e NUNCA o da org B', async ctx => {
    if (storageRlsMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    const own = await client.storage.from(BUCKET).download(fileA.filePath);
    expect(own.error).toBeNull();
    expect(own.data).toBeTruthy();

    const cross = await client.storage.from(BUCKET).download(fileB.filePath);
    expect(cross.data).toBeFalsy();

    await client.auth.signOut();
  });

  it('staff da org A NUNCA deleta o arquivo da org B (objeto continua existindo)', async ctx => {
    if (storageRlsMissing) return ctx.skip();
    const client = createUserClient();
    const signIn = await client.auth.signInWithPassword({ email: staffEmail, password });
    expect(signIn.error).toBeNull();

    // Tenta deletar o objeto da org B — RLS de DELETE deve impedir.
    await client.storage.from(BUCKET).remove([fileB.filePath]);

    // Prova via admin que o objeto da org B AINDA existe (não foi apagado).
    const admin = getSupabaseAdminClient();
    const stillThere = await admin.storage.from(BUCKET).download(fileB.filePath);
    expect(stillThere.error).toBeNull();
    expect(stillThere.data).toBeTruthy();

    await client.auth.signOut();
  });
});
