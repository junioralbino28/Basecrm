// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260311013000_core_multi_tenant_rls.sql'
);

describe('multi-tenant core RLS migration', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('replaces permissive legacy policies for core tenant tables', () => {
    for (const tableName of [
      'boards',
      'board_stages',
      'crm_companies',
      'contacts',
      'products',
      'deals',
      'deal_items',
      'activities',
      'organization_settings',
      'api_keys',
    ]) {
      expect(sql).toContain(`on public.${tableName}`);
    }
  });

  it('adds tenant-aware helpers instead of USING (true)', () => {
    expect(sql).toContain('public.can_access_organization');
    expect(sql).toContain('public.can_operate_organization');
    expect(sql).toContain('public.can_configure_organization');
    expect(sql).not.toContain('USING (true)');
    expect(sql).not.toContain('WITH CHECK (true)');
  });

  it('hardens child cockpit tables through parent deal access', () => {
    expect(sql).toContain('public.can_access_deal(deal_id)');
    expect(sql).toContain('public.can_operate_deal(deal_id)');
  });
});
