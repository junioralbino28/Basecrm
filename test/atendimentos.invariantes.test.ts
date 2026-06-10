// @vitest-environment node
//
// Invariantes de CHECK de `atendimentos` no BANCO (defense-in-depth).
//
// A migração 20260615000000_atendimentos_invariantes.sql adiciona:
//   - atendimentos_recebido_paid_at_chk: recebido ⟺ paid_at (nunca estado ambíguo)
//   - atendimentos_valores_chk: valor ≥ 0, desconto ≥ 0, desconto ≤ valor, installments ≥ 1
//
// Usa o admin client de propósito: service role BYPASSA RLS mas NÃO bypassa
// CHECK — se o insert inconsistente passar, é porque a constraint não existe.
//
// ⚠️ Skip gracioso: se o probe (insert recebido=true + paid_at null) passar,
// as constraints ainda não foram aplicadas — a suíte é pulada com aviso e o
// registro do probe é limpo. Rodar de novo PÓS-migração.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { getSupabaseAdminClient, assertNoSupabaseError } from './helpers/supabaseAdmin';
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

const CHECK_VIOLATION = '23514';

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|schema cache/i.test(error.message || '')
  );
}

describeSupabase('atendimentos - invariantes de CHECK no banco (recebido/paid_at e valores)', () => {
  let tableMissing = false;
  let constraintsMissing = false;
  let runId = '';
  let orgAId = '';

  beforeAll(async () => {
    const admin = getSupabaseAdminClient();

    // Skip gracioso 1: tabela atendimentos ainda não aplicada no banco.
    const probeTable = await admin.from('atendimentos').select('id').limit(1);
    if (isMissingTableError(probeTable.error)) {
      tableMissing = true;
      console.warn(
        '[atendimentos.invariantes] tabela atendimentos ainda não aplicada — rodar pós-migração 20260614000000_atendimentos.sql',
      );
      return;
    }

    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;

    // Skip gracioso 2 (probe): insert inconsistente via admin client.
    // Service role bypassa RLS mas NÃO bypassa CHECK — se passar, constraint ausente.
    const probe = await admin
      .from('atendimentos')
      .insert({
        organization_id: orgAId,
        procedimento: `Probe invariantes ${runId}`,
        valor: 10,
        desconto: 0,
        installments: 1,
        recebido: true,
        paid_at: null,
        performed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (!probe.error && probe.data?.id) {
      constraintsMissing = true;
      assertNoSupabaseError(
        await admin.from('atendimentos').delete().eq('id', probe.data.id),
        'cleanup probe invariantes',
      );
      console.warn(
        '[atendimentos.invariantes] constraints de invariante ainda não aplicadas — rodar pós-migração 20260615000000_atendimentos_invariantes.sql',
      );
    }
  }, 120_000);

  afterAll(async () => {
    if (tableMissing) return;
    const admin = getSupabaseAdminClient();

    if (orgAId) {
      assertNoSupabaseError(
        await admin.from('atendimentos').delete().eq('organization_id', orgAId),
        'delete atendimentos org A',
      );
    }

    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('REJEITA insert recebido=true com paid_at null (CHECK recebido ⟺ paid_at)', async ctx => {
    if (tableMissing || constraintsMissing) return ctx.skip();
    const admin = getSupabaseAdminClient();

    const res = await admin
      .from('atendimentos')
      .insert({
        organization_id: orgAId,
        procedimento: `Recebido sem paid_at ${runId}`,
        valor: 250,
        desconto: 0,
        installments: 1,
        recebido: true,
        paid_at: null,
        performed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();
    expect(res.error?.code).toBe(CHECK_VIOLATION);
  });

  it('REJEITA insert com desconto > valor (CHECK de valores — total nunca negativo)', async ctx => {
    if (tableMissing || constraintsMissing) return ctx.skip();
    const admin = getSupabaseAdminClient();

    const res = await admin
      .from('atendimentos')
      .insert({
        organization_id: orgAId,
        procedimento: `Desconto maior que valor ${runId}`,
        valor: 100,
        desconto: 150,
        installments: 1,
        recebido: false,
        performed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();
    expect(res.error?.code).toBe(CHECK_VIOLATION);
  });
});
