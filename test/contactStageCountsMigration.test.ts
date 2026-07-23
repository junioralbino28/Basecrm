// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260723000000_hotfix_tenant_stage_counts.sql',
);
const sql = readFileSync(migrationPath, 'utf-8').toLowerCase();

function tenantRpcBody(): string {
  const start = sql.indexOf(
    'create function public.get_contact_stage_counts(p_organization_id uuid)',
  );
  expect(start, 'a assinatura tenantizada deve existir').toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', start);
  expect(end, 'o corpo da assinatura tenantizada deve terminar').toBeGreaterThan(start);
  return sql.slice(start, end + 3);
}

describe('hotfix das RPCs globais legadas', () => {
  it('revoga e remove as duas assinaturas vulneráveis sem CASCADE', () => {
    expect(sql).toContain(
      'revoke execute on function public.get_contact_stage_counts() from public, anon, authenticated;',
    );
    expect(sql).toContain('drop function public.get_contact_stage_counts();');
    expect(sql).toContain(
      'revoke execute on function public.get_dashboard_stats() from public, anon, authenticated;',
    );
    expect(sql).toContain('drop function public.get_dashboard_stats();');
    expect(sql).not.toContain('cascade');
  });

  it('não recria dashboard_stats e não preserva overload zero-arg', () => {
    expect(sql).not.toContain('create function public.get_dashboard_stats');
    expect(sql).not.toContain('create or replace function public.get_dashboard_stats');
    expect(sql).not.toContain('create function public.get_contact_stage_counts()');
    expect(sql).not.toContain('create or replace function public.get_contact_stage_counts()');
  });

  it('cria somente a contagem tenantizada como SECURITY INVOKER fail-closed', () => {
    const rpc = tenantRpcBody();

    expect(rpc).toMatch(/\bstable\b/);
    expect(rpc).toContain('security invoker');
    expect(rpc).toContain("set search_path = ''");
    expect(rpc).toContain('p_organization_id is null');
    expect(rpc).toContain('auth.uid() is null');
    expect(rpc).toContain('public.can_access_organization(p_organization_id)');
    expect(rpc).toContain("errcode = '42501'");
  });

  it('filtra organização, soft-delete e mantém estágio nulo como UNKNOWN', () => {
    const rpc = tenantRpcBody();

    expect(rpc).toContain('from public.contacts as c');
    expect(rpc).toContain('c.organization_id = p_organization_id');
    expect(rpc).toContain('c.deleted_at is null');
    expect(rpc).toContain("coalesce(c.stage, 'unknown')");
  });

  it('remove o grant implícito de PUBLIC/anon e libera apenas authenticated', () => {
    expect(sql).toContain(
      'revoke execute on function public.get_contact_stage_counts(uuid) from public, anon;',
    );
    expect(sql).toContain(
      'grant execute on function public.get_contact_stage_counts(uuid) to authenticated;',
    );
  });
});
