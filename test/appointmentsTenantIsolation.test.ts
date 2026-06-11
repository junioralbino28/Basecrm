// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { getSupabaseAdminClient } from './helpers/supabaseAdmin';
import { loadEnvFile } from './helpers/env';

const nextRoot = process.cwd();
const repoRoot = `${nextRoot}/..`;
loadEnvFile(`${repoRoot}/.env`);
loadEnvFile(`${repoRoot}/.env.local`, { override: true });
loadEnvFile(`${nextRoot}/.env`);
loadEnvFile(`${nextRoot}/.env.local`, { override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hasRealSupabaseCreds =
  Boolean(supabaseUrl) &&
  Boolean(serviceRoleKey) &&
  !serviceRoleKey.startsWith('your_') &&
  !serviceRoleKey.startsWith('sb_secret_your_');

const describeSupabase = hasRealSupabaseCreds ? describe : describe.skip;

describeSupabase('appointments cache - isolamento cross-tenant', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;
  }, 60_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    if (orgAId) await admin.from('appointments').delete().eq('organization_id', orgAId);
    if (orgBId) await admin.from('appointments').delete().eq('organization_id', orgBId);
    if (runId) await cleanupFixtures(runId);
  }, 60_000);

  it('linha de appointments da org B não aparece numa leitura filtrada por org A', async () => {
    const admin = getSupabaseAdminClient();

    const insertB = await admin.from('appointments').insert({
      organization_id: orgBId,
      starts_at: '2026-06-12T09:00:00Z',
      status: 'agendado',
      source: 'clinicorp_api',
      external_id: `ext-${runId}`,
    });
    expect(insertB.error).toBeNull();

    // Leitura escopada à org A (service-role + filtro explícito por organization_id).
    const readA = await admin
      .from('appointments')
      .select('id, organization_id, external_id')
      .eq('organization_id', orgAId)
      .eq('external_id', `ext-${runId}`);

    expect(readA.error).toBeNull();
    expect(readA.data || []).toHaveLength(0);

    // A linha existe de fato na org B (sanidade).
    const readB = await admin
      .from('appointments')
      .select('id')
      .eq('organization_id', orgBId)
      .eq('external_id', `ext-${runId}`);
    expect((readB.data || []).length).toBe(1);
  });
});
