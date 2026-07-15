// @vitest-environment node
//
// Teste mutável do E2 S1. Usa SOMENTE E2_SUPABASE_* e o helper de segurança
// recusa o projeto de produção. REQUIRE_E2_MIGRATION=1 converte ausência da
// migration/credenciais em falha (prova obrigatória); sem opt-in, a suíte pula.
import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_PERMISSIONS, getDefaultPermissionMap } from '@/lib/auth/permissions';
import {
  createE2AdminClient,
  createE2UserClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';

const config = loadE2SupabaseConfig();
const describeE2 = config ? describe : describe.skip;
const migrationRequired = process.env.REQUIRE_E2_MIGRATION === '1';

const TEST_ROLES = [
  'agency_admin',
  'agency_staff',
  'clinic_admin',
  'clinic_staff',
  'admin',
  'vendedor',
] as const;
type TestRole = (typeof TEST_ROLES)[number];

type UserFixture = {
  id: string;
  email: string;
  role: TestRole;
  organizationId: string;
  client: SupabaseClient;
};

type DbError = { code?: string; message?: string } | null;

function isMissingE2Migration(error: DbError): boolean {
  if (!error) return false;
  return (
    error.code === '42P01'
    || error.code === '42883'
    || error.code === 'PGRST202'
    || error.code === 'PGRST205'
    || /does not exist|schema cache/i.test(error.message ?? '')
  );
}

function atendimentoRow(organizationId: string, procedimento: string, valor: number) {
  const now = new Date().toISOString();
  return {
    organization_id: organizationId,
    procedimento,
    valor,
    desconto: 0,
    payment_method: 'pix',
    installments: 1,
    recebido: true,
    paid_at: now,
    performed_at: now,
  };
}

describeE2('E2 S1 — isolamento real em Supabase local/branch não produtivo', () => {
  const password = `E2!${randomUUID()}aA1`;
  const runId = randomUUID();
  const admin = config ? createE2AdminClient(config) : null;
  const users = new Map<TestRole, UserFixture>();
  const authUserIds: string[] = [];

  let ready = false;
  let organizationA = '';
  let organizationB = '';
  let atendimentoA = '';
  let atendimentoB = '';
  let noProfileUser: UserFixture | null = null;
  const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  async function createUser(role: TestRole, organizationId: string): Promise<UserFixture> {
    if (!admin || !config) throw new Error('config E2 ausente');
    const email = `e2.${role}.${runId}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role, organization_id: organizationId },
    });
    if (created.error || !created.data.user?.id) {
      throw new Error(`createUser ${role}: ${created.error?.message}`);
    }

    const id = created.data.user.id;
    authUserIds.push(id);
    const profile = await admin.from('profiles').upsert({
      id,
      email,
      name: `E2 ${role}`,
      first_name: 'E2',
      role,
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (profile.error) throw new Error(`profile ${role}: ${profile.error.message}`);

    const client = createE2UserClient(config);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`signIn ${role}: ${signedIn.error.message}`);

    return { id, email, role, organizationId, client };
  }

  async function setOverride(
    user: UserFixture,
    permissionKey: string,
    enabled: boolean,
    organizationId = user.organizationId,
  ) {
    if (!admin) throw new Error('admin E2 ausente');
    const result = await admin.from('profile_permissions').upsert({
      user_id: user.id,
      organization_id: organizationId,
      permission_key: permissionKey,
      enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,permission_key' });
    if (result.error) throw new Error(`override ${permissionKey}: ${result.error.message}`);
  }

  async function hasPermission(user: UserFixture, permissionKey: string): Promise<boolean> {
    const result = await user.client.rpc('has_permission', { permission_key: permissionKey });
    expect(result.error).toBeNull();
    return result.data as boolean;
  }

  beforeAll(async () => {
    if (!admin || !config) return;

    const probe = await admin
      .from('role_permission_defaults')
      .select('defaults_version, role, permission_key, enabled')
      .limit(1);
    if (probe.error) {
      if (migrationRequired || !isMissingE2Migration(probe.error)) {
        throw new Error(`probe E2 S1: ${probe.error.message}`);
      }
      console.warn('[E2 S1] migration ausente no alvo seguro; suíte pulada no modo não obrigatório');
      return;
    }

    const organizations = await admin
      .from('organizations')
      .insert([
        { name: `E2 Org A ${runId}` },
        { name: `E2 Org B ${runId}` },
      ])
      .select('id, name');
    if (organizations.error || organizations.data?.length !== 2) {
      throw new Error(`organizations E2: ${organizations.error?.message ?? 'retorno incompleto'}`);
    }
    organizationA = organizations.data[0].id;
    organizationB = organizations.data[1].id;

    for (const role of TEST_ROLES) {
      users.set(role, await createUser(role, organizationA));
    }

    if (!config) throw new Error('config E2 ausente');
    const noProfileEmail = `e2.no-profile.${runId}@example.com`;
    const createdNoProfile = await admin.auth.admin.createUser({
      email: noProfileEmail,
      password,
      email_confirm: true,
    });
    if (createdNoProfile.error || !createdNoProfile.data.user?.id) {
      throw new Error(`createUser no-profile: ${createdNoProfile.error?.message}`);
    }
    authUserIds.push(createdNoProfile.data.user.id);
    await admin.from('profiles').delete().eq('id', createdNoProfile.data.user.id);
    const noProfileClient = createE2UserClient(config);
    const signedNoProfile = await noProfileClient.auth.signInWithPassword({
      email: noProfileEmail,
      password,
    });
    if (signedNoProfile.error) throw new Error(`signIn no-profile: ${signedNoProfile.error.message}`);
    noProfileUser = {
      id: createdNoProfile.data.user.id,
      email: noProfileEmail,
      role: 'clinic_staff',
      organizationId: organizationA,
      client: noProfileClient,
    };

    const inserted = await admin
      .from('atendimentos')
      .insert([
        atendimentoRow(organizationA, `E2 A ${runId}`, 100),
        atendimentoRow(organizationB, `E2 B ${runId}`, 900),
      ])
      .select('id, organization_id');
    if (inserted.error || inserted.data?.length !== 2) {
      throw new Error(`atendimentos E2: ${inserted.error?.message ?? 'retorno incompleto'}`);
    }
    atendimentoA = inserted.data.find((row) => row.organization_id === organizationA)?.id ?? '';
    atendimentoB = inserted.data.find((row) => row.organization_id === organizationB)?.id ?? '';
    if (!atendimentoA || !atendimentoB) throw new Error('IDs de atendimentos E2 ausentes');

    ready = true;
  }, 120_000);

  beforeEach(async () => {
    if (!ready || !admin || authUserIds.length === 0) return;
    const reset = await admin.from('profile_permissions').delete().in('user_id', authUserIds);
    if (reset.error) throw new Error(`reset overrides E2: ${reset.error.message}`);
  });

  afterAll(async () => {
    if (!admin) return;

    if (organizationA || organizationB) {
      const orgIds = [organizationA, organizationB].filter(Boolean);
      await admin.from('profile_permissions').delete().in('user_id', authUserIds);
      await admin.from('atendimentos').delete().in('organization_id', orgIds);
    }
    for (const id of authUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    if (organizationA || organizationB) {
      await admin.from('organizations').delete().in(
        'id',
        [organizationA, organizationB].filter(Boolean),
      );
    }
  }, 120_000);

  it('prova que o alvo opt-in é local ou uma branch remota explicitamente liberada', (ctx) => {
    if (!ready) return ctx.skip();
    expect(config?.isLocal || process.env.E2_ALLOW_REMOTE_BRANCH === '1').toBe(true);
  });

  it('trava anti-drift: banco v1 é idêntico a getDefaultPermissionMap para os 6 cargos', async (ctx) => {
    if (!ready || !admin) return ctx.skip();
    const result = await admin
      .from('role_permission_defaults')
      .select('defaults_version, role, permission_key, enabled');
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(TEST_ROLES.length * APP_PERMISSIONS.length);
    expect(new Set((result.data ?? []).map((row) => row.defaults_version))).toEqual(new Set([1]));

    for (const role of TEST_ROLES) {
      const actual = Object.fromEntries(
        (result.data ?? [])
          .filter((row) => row.role === role)
          .map((row) => [row.permission_key, row.enabled]),
      );
      expect(actual).toEqual(getDefaultPermissionMap(role));
    }
  });

  it('defaults e aliases são resolvidos; chave órfã e usuário sem profile fecham em false', async (ctx) => {
    if (!ready || !noProfileUser) return ctx.skip();
    expect(await hasPermission(users.get('clinic_admin')!, 'reports.finance')).toBe(true);
    expect(await hasPermission(users.get('clinic_staff')!, 'reports.finance')).toBe(false);
    expect(await hasPermission(users.get('agency_staff')!, 'reports.finance')).toBe(true);
    expect(await hasPermission(users.get('admin')!, 'settings.users.manage')).toBe(true);
    expect(await hasPermission(users.get('vendedor')!, 'reports.professionals')).toBe(false);
    expect(await hasPermission(users.get('clinic_admin')!, 'permission.does_not_exist')).toBe(false);
    expect(await hasPermission(noProfileUser, 'atendimentos.view')).toBe(false);
  });

  it('override concede e nega; override cross-org malformado nega em vez de cair no default', async (ctx) => {
    if (!ready) return ctx.skip();
    const staff = users.get('clinic_staff')!;
    const clinicAdmin = users.get('clinic_admin')!;

    await setOverride(staff, 'reports.finance', true);
    expect(await hasPermission(staff, 'reports.finance')).toBe(true);

    await setOverride(clinicAdmin, 'reports.finance', false);
    expect(await hasPermission(clinicAdmin, 'reports.finance')).toBe(false);

    await setOverride(staff, 'reports.finance', true, organizationB);
    expect(await hasPermission(staff, 'reports.finance')).toBe(false);
  });

  it('authenticated não lê a tabela de defaults diretamente', async (ctx) => {
    if (!ready) return ctx.skip();
    const result = await users.get('clinic_admin')!
      .client
      .from('role_permission_defaults')
      .select('role')
      .limit(1);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('42501');
  });

  it('PostgREST direto: staff de A vê A, nunca B, e não insere nem move linha para B', async (ctx) => {
    if (!ready || !admin) return ctx.skip();
    const staff = users.get('clinic_staff')!;
    const selected = await staff.client.from('atendimentos').select('id, organization_id');
    expect(selected.error).toBeNull();
    expect((selected.data ?? []).map((row) => row.id)).toContain(atendimentoA);
    expect((selected.data ?? []).map((row) => row.id)).not.toContain(atendimentoB);
    expect((selected.data ?? []).every((row) => row.organization_id === organizationA)).toBe(true);

    const crossInsert = await staff.client
      .from('atendimentos')
      .insert(atendimentoRow(organizationB, `E2 cross insert ${runId}`, 1));
    expect(crossInsert.error?.code).toBe('42501');

    const crossMove = await staff.client
      .from('atendimentos')
      .update({ organization_id: organizationB })
      .eq('id', atendimentoA);
    expect(crossMove.error?.code).toBe('42501');

    const persisted = await admin.from('atendimentos')
      .select('organization_id')
      .eq('id', atendimentoA)
      .single();
    expect(persisted.data?.organization_id).toBe(organizationA);
  });

  it('atendimentos.view=false esconde SELECT mesmo com manage=true, sem bloquear INSERT em A', async (ctx) => {
    if (!ready || !admin) return ctx.skip();
    const staff = users.get('clinic_staff')!;
    await setOverride(staff, 'atendimentos.view', false);
    await setOverride(staff, 'atendimentos.manage', true);

    const selected = await staff.client.from('atendimentos').select('id');
    expect(selected.error).toBeNull();
    expect(selected.data).toEqual([]);

    const procedimento = `E2 manage without view ${runId}`;
    const inserted = await staff.client
      .from('atendimentos')
      .insert(atendimentoRow(organizationA, procedimento, 10));
    expect(inserted.error).toBeNull();

    const serviceCheck = await admin.from('atendimentos')
      .select('id')
      .eq('organization_id', organizationA)
      .eq('procedimento', procedimento)
      .single();
    expect(serviceCheck.error).toBeNull();
    await admin.from('atendimentos').delete().eq('id', serviceCheck.data?.id);
  });

  it('atendimentos.manage=false recusa INSERT/UPDATE/DELETE e mantém a linha intacta', async (ctx) => {
    if (!ready || !admin) return ctx.skip();
    const staff = users.get('clinic_staff')!;
    await setOverride(staff, 'atendimentos.view', true);
    await setOverride(staff, 'atendimentos.manage', false);

    const inserted = await staff.client
      .from('atendimentos')
      .insert(atendimentoRow(organizationA, `E2 denied insert ${runId}`, 10));
    expect(inserted.error?.code).toBe('42501');

    const updated = await staff.client
      .from('atendimentos')
      .update({ procedimento: `E2 denied update ${runId}` })
      .eq('id', atendimentoA)
      .select('id');
    expect(updated.error).toBeNull();
    expect(updated.data).toEqual([]);

    const deleted = await staff.client
      .from('atendimentos')
      .delete()
      .eq('id', atendimentoA)
      .select('id');
    expect(deleted.error).toBeNull();
    expect(deleted.data).toEqual([]);

    const persisted = await admin.from('atendimentos')
      .select('id, procedimento')
      .eq('id', atendimentoA)
      .single();
    expect(persisted.error).toBeNull();
    expect(persisted.data?.procedimento).toBe(`E2 A ${runId}`);
  });

  it('override true restaura manage dentro de A, sem conceder mutação em B', async (ctx) => {
    if (!ready || !admin) return ctx.skip();
    const staff = users.get('clinic_staff')!;
    await setOverride(staff, 'atendimentos.manage', false);
    const denied = await staff.client
      .from('atendimentos')
      .insert(atendimentoRow(organizationA, `E2 restore denied ${runId}`, 10));
    expect(denied.error?.code).toBe('42501');

    await setOverride(staff, 'atendimentos.manage', true);
    const procedimento = `E2 restore allowed ${runId}`;
    const allowed = await staff.client
      .from('atendimentos')
      .insert(atendimentoRow(organizationA, procedimento, 10));
    expect(allowed.error).toBeNull();

    const crossTenant = await staff.client
      .from('atendimentos')
      .insert(atendimentoRow(organizationB, `E2 restore cross ${runId}`, 10));
    expect(crossTenant.error?.code).toBe('42501');

    const cleanup = await admin.from('atendimentos')
      .delete()
      .eq('organization_id', organizationA)
      .eq('procedimento', procedimento);
    expect(cleanup.error).toBeNull();
  });

  it('RPCs: admin de A lê somente A e recebe 42501 ao pedir B', async (ctx) => {
    if (!ready) return ctx.skip();
    const clinicAdmin = users.get('clinic_admin')!;
    const own = await clinicAdmin.client.rpc('get_revenue_report', {
      p_start: periodStart,
      p_end: periodEnd,
      p_organization_id: organizationA,
    });
    expect(own.error).toBeNull();
    expect(Number(own.data?.faturamento)).toBe(100);

    const crossTenant = await clinicAdmin.client.rpc('get_revenue_report', {
      p_start: periodStart,
      p_end: periodEnd,
      p_organization_id: organizationB,
    });
    expect(crossTenant.data).toBeNull();
    expect(crossTenant.error?.code).toBe('42501');
  });

  it('RPCs: defaults/denies bloqueiam finance e professionals diretamente', async (ctx) => {
    if (!ready) return ctx.skip();
    const staff = users.get('clinic_staff')!;
    const clinicAdmin = users.get('clinic_admin')!;

    for (const rpc of ['get_revenue_report', 'get_net_result'] as const) {
      const denied = await staff.client.rpc(rpc, {
        p_start: periodStart,
        p_end: periodEnd,
        p_organization_id: organizationA,
      });
      expect(denied.data).toBeNull();
      expect(denied.error?.code).toBe('42501');
    }

    const deniedProfessionals = await staff.client.rpc('get_commission_report', {
      p_start: periodStart,
      p_end: periodEnd,
      p_organization_id: organizationA,
    });
    expect(deniedProfessionals.error?.code).toBe('42501');

    await setOverride(clinicAdmin, 'reports.finance', false);
    const adminDenied = await clinicAdmin.client.rpc('get_net_result', {
      p_start: periodStart,
      p_end: periodEnd,
      p_organization_id: organizationA,
    });
    expect(adminDenied.error?.code).toBe('42501');
  });

  it('RPCs: grants para clinic_staff liberam A e continuam negando B', async (ctx) => {
    if (!ready) return ctx.skip();
    const staff = users.get('clinic_staff')!;
    await setOverride(staff, 'reports.finance', true);
    await setOverride(staff, 'reports.professionals', true);

    for (const rpc of ['get_revenue_report', 'get_net_result'] as const) {
      const allowed = await staff.client.rpc(rpc, {
        p_start: periodStart,
        p_end: periodEnd,
        p_organization_id: organizationA,
      });
      expect(allowed.error).toBeNull();
    }
    const professionals = await staff.client.rpc('get_commission_report', {
      p_start: periodStart,
      p_end: periodEnd,
      p_organization_id: organizationA,
    });
    expect(professionals.error).toBeNull();

    const crossTenant = await staff.client.rpc('get_revenue_report', {
      p_start: periodStart,
      p_end: periodEnd,
      p_organization_id: organizationB,
    });
    expect(crossTenant.error?.code).toBe('42501');
  });

  it('RPCs: agency_staff segue o default TS e acessa a clínica selecionada', async (ctx) => {
    if (!ready) return ctx.skip();
    const agencyStaff = users.get('agency_staff')!;
    const result = await agencyStaff.client.rpc('get_revenue_report', {
      p_start: periodStart,
      p_end: periodEnd,
      p_organization_id: organizationB,
    });
    expect(result.error).toBeNull();
    expect(Number(result.data?.faturamento)).toBe(900);
  });
});
