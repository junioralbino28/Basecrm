// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_PERMISSIONS,
  ROLE_PERMISSION_DEFAULTS,
  getDefaultPermissionMap,
} from '@/lib/auth/permissions';
import { assertSafeE2SupabaseTarget } from './helpers/e2Supabase';
import { shouldLoadTestEnvFiles } from './helpers/env';

const MIGRATION_NAME = '20260635000000_e2_server_permission_enforcement.sql';
const migrationPath = resolve(process.cwd(), 'supabase/migrations', MIGRATION_NAME);
const SNAPSHOT_MIGRATION_NAME = '20260718000000_funil_f1_authoring.sql';
const snapshotMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations',
  SNAPSHOT_MIGRATION_NAME,
);
const generatorPath = resolve(
  process.cwd(),
  'scripts/generate-e2-role-permission-defaults.mjs',
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const snapshotSql = existsSync(snapshotMigrationPath)
  ? readFileSync(snapshotMigrationPath, 'utf8')
  : '';

const ROLES = [
  'agency_admin',
  'agency_staff',
  'clinic_admin',
  'clinic_staff',
  'admin',
  'vendedor',
] as const;

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) return '';
  const end = sql.indexOf('\n$$;', start);
  return sql.slice(start, end < 0 ? sql.length : end + 4);
}

function policyBody(name: string): string {
  const start = sql.indexOf(`create policy "${name}"`);
  if (start < 0) return '';
  const end = sql.indexOf(';', start);
  return sql.slice(start, end < 0 ? sql.length : end + 1);
}

describe('E2 S1 — snapshot de defaults sem drift', () => {
  it('trava local impede que suítes legadas recarreguem .env.local', () => {
    const previous = process.env.SUPABASE_TEST_TARGET;
    process.env.SUPABASE_TEST_TARGET = 'local';
    try {
      expect(shouldLoadTestEnvFiles()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.SUPABASE_TEST_TARGET;
      else process.env.SUPABASE_TEST_TARGET = previous;
    }
  });

  it('harness aceita loopback e recusa explicitamente o projeto de produção', () => {
    expect(assertSafeE2SupabaseTarget('http://127.0.0.1:54321')).toEqual({ isLocal: true });
    expect(() => assertSafeE2SupabaseTarget(
      'https://eqidsihasmwwamkaqfka.supabase.co',
    )).toThrow(/RECUSADO.*produção/i);
  });

  it('mantém permissions.ts como fonte e não exige manifesto novo', () => {
    expect(Object.keys(ROLE_PERMISSION_DEFAULTS).sort()).toEqual([...ROLES].sort());
    expect(getDefaultPermissionMap('admin')).toEqual(getDefaultPermissionMap('agency_admin'));
    expect(getDefaultPermissionMap('vendedor')).toEqual(getDefaultPermissionMap('clinic_staff'));
  });

  it('possui migration e gerador determinístico em modo --check', () => {
    expect(existsSync(migrationPath), MIGRATION_NAME).toBe(true);
    expect(existsSync(snapshotMigrationPath), SNAPSHOT_MIGRATION_NAME).toBe(true);
    expect(existsSync(generatorPath), 'gerador do snapshot').toBe(true);

    execFileSync(process.execPath, [generatorPath, '--check'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
  });

  it('materializa exatamente o produto cartesiano cargo × permissão no snapshot v1', () => {
    const snapshotMatch = snapshotSql.match(
      /-- E2_ROLE_PERMISSION_DEFAULTS:START\r?\n([\s\S]*?)\r?\n-- E2_ROLE_PERMISSION_DEFAULTS:END/,
    );
    expect(snapshotMatch, 'marcadores do snapshot gerado').not.toBeNull();

    const tuples = [...(snapshotMatch?.[1] ?? '').matchAll(
      /\(1, '([^']+)', '([^']+)', (true|false)\)/g,
    )].map((match) => ({
      role: match[1],
      permission: match[2],
      enabled: match[3] === 'true',
    }));

    expect(tuples).toHaveLength(ROLES.length * APP_PERMISSIONS.length);
    expect(new Set(tuples.map(({ role, permission }) => `${role}:${permission}`)).size)
      .toBe(tuples.length);

    for (const role of ROLES) {
      const expected = getDefaultPermissionMap(role);
      const actual = Object.fromEntries(
        tuples
          .filter((tuple) => tuple.role === role)
          .map((tuple) => [tuple.permission, tuple.enabled]),
      );
      expect(actual).toEqual(expected);
    }
  });

  it('usa tabela de versão única com coluna de versão e sem ponteiro ativo no v1', () => {
    expect(sql).toContain('create table if not exists public.role_permission_defaults');
    expect(sql).toMatch(/defaults_version integer not null/);
    expect(sql).toMatch(/primary key \(role, permission_key\)/);
    expect(sql).not.toContain('permission_defaults_state');
    expect(sql).not.toContain('active_version');
  });
});

describe('E2 S1 — has_permission fail-closed', () => {
  const helper = functionBody('has_permission');

  it('é STABLE + SECURITY DEFINER com search_path vazio e identidade exclusiva de auth.uid()', () => {
    expect(helper).toContain('returns boolean');
    expect(helper).toMatch(/\bstable\b/i);
    expect(helper).toMatch(/security definer/i);
    expect(helper).toMatch(/set search_path = ''/i);
    expect(helper).toContain('auth.uid()');
    expect(helper).toMatch(
      /^create or replace function public\.has_permission\(permission_key text\)/,
    );
  });

  it('nega default ausente antes do override e nega override cross-org', () => {
    expect(helper).toContain('defaults_version = 1');
    expect(helper).toContain('if not found then');
    expect(helper).toContain('return false');
    expect(helper).toContain('is distinct from v_profile_organization_id');
  });

  it('não expõe tabela e helper a anon/public e só libera execução autenticada', () => {
    expect(sql).toContain('revoke all on table public.role_permission_defaults from public');
    expect(sql).toContain('revoke all on table public.role_permission_defaults from anon');
    expect(sql).toContain('revoke all on table public.role_permission_defaults from authenticated');
    expect(sql).toContain('revoke all on function public.has_permission(text) from public');
    expect(sql).toContain('revoke all on function public.has_permission(text) from anon');
    expect(sql).toContain('grant execute on function public.has_permission(text) to authenticated');
  });
});

describe('E2 S1 — Atendimentos usa policies separadas', () => {
  it('remove a policy FOR ALL antiga e cria SELECT/INSERT/UPDATE/DELETE distintas', () => {
    expect(sql).toContain(
      'drop policy if exists "atendimentos_mutate_by_tenant_operator" on public.atendimentos',
    );

    expect(policyBody('atendimentos_select_by_tenant_permission')).toContain('for select');
    expect(policyBody('atendimentos_insert_by_tenant_permission')).toContain('for insert');
    expect(policyBody('atendimentos_update_by_tenant_permission')).toContain('for update');
    expect(policyBody('atendimentos_delete_by_tenant_permission')).toContain('for delete');
    expect(sql).not.toMatch(/create policy "atendimentos[^\"]+"[\s\S]*?for all/i);
  });

  it('compõe tenant AND view/manage e protege as duas pontas do UPDATE', () => {
    const select = policyBody('atendimentos_select_by_tenant_permission');
    expect(select).toContain('public.can_access_organization(organization_id)');
    expect(select).toContain("public.has_permission('atendimentos.view')");

    for (const name of [
      'atendimentos_insert_by_tenant_permission',
      'atendimentos_update_by_tenant_permission',
      'atendimentos_delete_by_tenant_permission',
    ]) {
      const policy = policyBody(name);
      expect(policy).toContain('public.can_operate_organization(organization_id)');
      expect(policy).toContain("public.has_permission('atendimentos.manage')");
    }

    const update = policyBody('atendimentos_update_by_tenant_permission');
    expect(update).toContain('using (');
    expect(update).toContain('with check (');
  });
});

describe('E2 S1 — RPCs financeiros', () => {
  const permissionByRpc = {
    get_revenue_report: 'reports.finance',
    get_net_result: 'reports.finance',
    get_commission_report: 'reports.professionals',
  } as const;

  it('compõe can_access_organization AND a permissão correta em cada SECURITY DEFINER', () => {
    for (const [rpc, permission] of Object.entries(permissionByRpc)) {
      const body = functionBody(rpc);
      expect(body, rpc).toMatch(/security definer/i);
      expect(body, rpc).toMatch(/set search_path = ''/i);
      expect(body, rpc).toContain('public.can_access_organization(v_org)');
      expect(body, rpc).toContain(`public.has_permission('${permission}')`);
      expect(body, rpc).not.toContain('public.can_configure_organization(v_org)');
      expect(body, rpc).toContain("errcode = '42501'");
    }
  });

  it('preserva as correções efetivas de junho', () => {
    expect(functionBody('get_revenue_report')).toContain("at time zone 'America/Sao_Paulo'");

    const commission = functionBody('get_commission_report');
    expect(commission).toContain("'sem_profissional'");
    expect(commission).toContain('(c.specialty is not null and c.specialty = p.specialty) desc');

    const net = functionBody('get_net_result');
    expect(net).toContain("lower(trim(coalesce(f.card_brand, '')))");
    expect(net).toContain('v_contas := v_contas_mensal * v_meses');
    expect(net).toContain("'meses_periodo'");
  });

  it('mantém settings.finance nas tabelas de configuração fora deste S1', () => {
    expect(sql).not.toContain("public.has_permission('settings.finance')");
    expect(sql).not.toMatch(/create policy[\s\S]*?on public\.(payment_method_fees|commission_rules|fixed_costs|commission_payments)/i);
  });
});
