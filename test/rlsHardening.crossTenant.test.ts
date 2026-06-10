// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { getSupabaseAdminClient, requireSupabaseData, assertNoSupabaseError } from './helpers/supabaseAdmin';
import { loadEnvFile } from './helpers/env';

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

const hasRealSupabaseCreds =
  Boolean(supabaseUrl) &&
  Boolean(serviceRoleKey) &&
  serviceRoleKey !== 'your_service_role_key' &&
  !serviceRoleKey.startsWith('your_') &&
  !serviceRoleKey.startsWith('sb_secret_your_');

const describeSupabase = hasRealSupabaseCreds ? describe : describe.skip;

describeSupabase('RLS hardening fase 1 - isolamento cross-tenant (leads/profiles)', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let leadAId = '';
  let leadBId = '';

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    orgBId = fx.orgB.organizationId;

    const supabase = getSupabaseAdminClient();

    const leadA = await supabase
      .from('leads')
      .insert({
        organization_id: orgAId,
        name: `Paciente A ${runId}`,
        email: `lead.a.${runId}@example.com`,
        status: 'NEW',
      })
      .select('id')
      .single();
    leadAId = requireSupabaseData(leadA, 'insert lead A').id;

    const leadB = await supabase
      .from('leads')
      .insert({
        organization_id: orgBId,
        name: `Paciente B ${runId}`,
        email: `lead.b.${runId}@example.com`,
        status: 'NEW',
      })
      .select('id')
      .single();
    leadBId = requireSupabaseData(leadB, 'insert lead B').id;
  }, 60_000);

  afterAll(async () => {
    const supabase = getSupabaseAdminClient();
    if (leadAId) {
      assertNoSupabaseError(
        await supabase.from('leads').delete().eq('id', leadAId),
        'delete lead A',
      );
    }
    if (leadBId) {
      assertNoSupabaseError(
        await supabase.from('leads').delete().eq('id', leadBId),
        'delete lead B',
      );
    }
    if (runId) await cleanupFixtures(runId);
  }, 60_000);

  it('lead de org B nunca aparece num read escopado por organization_id de org A', async () => {
    const supabase = getSupabaseAdminClient();

    const res = await supabase
      .from('leads')
      .select('id, organization_id, email')
      .eq('organization_id', orgAId);

    const rows = requireSupabaseData(res, 'select leads scoped to org A');
    const ids = rows.map((r) => r.id);
    const orgIds = rows.map((r) => r.organization_id);

    expect(ids).toContain(leadAId);
    expect(ids).not.toContain(leadBId);
    expect(orgIds.every((o) => o === orgAId)).toBe(true);
  });

  it('as duas leads existem em orgs distintas (sanidade do fixture)', async () => {
    const supabase = getSupabaseAdminClient();

    const a = await supabase.from('leads').select('organization_id').eq('id', leadAId).single();
    const b = await supabase.from('leads').select('organization_id').eq('id', leadBId).single();

    const orgOfA = requireSupabaseData(a, 'select lead A org').organization_id;
    const orgOfB = requireSupabaseData(b, 'select lead B org').organization_id;

    expect(orgOfA).toBe(orgAId);
    expect(orgOfB).toBe(orgBId);
    expect(orgOfA).not.toBe(orgOfB);
  });

  it('profile de org B nunca aparece num read escopado por organization_id de org A', async () => {
    const supabase = getSupabaseAdminClient();

    const res = await supabase
      .from('profiles')
      .select('id, organization_id')
      .eq('organization_id', orgAId);

    const rows = requireSupabaseData(res, 'select profiles scoped to org A');
    const orgIds = rows.map((r) => r.organization_id);

    expect(orgIds.every((o) => o === orgAId)).toBe(true);
  });
});
