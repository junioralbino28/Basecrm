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

const hardeningMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260612000000_rls_hardening_clinic_pii.sql'
);

describe('rls hardening migration (clinic PII)', () => {
  const sql = readFileSync(hardeningMigrationPath, 'utf-8');

  it('blinda profiles_select por tenant (remove USING (true))', () => {
    expect(sql).toContain('drop policy if exists "profiles_select" on public.profiles');
    expect(sql).toContain('create policy "profiles_select" on public.profiles');
    expect(sql).toContain('public.can_access_organization(organization_id)');
    expect(sql).toContain('id = auth.uid()');
  });

  it('nunca reintroduz policies permissivas', () => {
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('USING (true)');
    expect(sql).not.toContain('with check (true)');
    expect(sql).not.toContain('WITH CHECK (true)');
  });

  it('restringe organizations a can_access/can_configure (mantém deleted_at)', () => {
    expect(sql).toContain('drop policy if exists "authenticated_access" on public.organizations');
    expect(sql).toContain('create policy "organizations_select_by_tenant" on public.organizations');
    expect(sql).toContain('create policy "organizations_mutate_by_tenant_admin" on public.organizations');
    expect(sql).toContain('public.can_access_organization(id)');
    expect(sql).toContain('public.can_configure_organization(id)');
    expect(sql).toContain('deleted_at is null');
  });

  it('blinda leads por tenant (select can_access, mutate can_operate)', () => {
    expect(sql).toContain('drop policy if exists "Enable all access for authenticated users" on public.leads');
    expect(sql).toContain('create policy "leads_select_by_tenant" on public.leads');
    expect(sql).toContain('create policy "leads_mutate_by_tenant_operator" on public.leads');
  });

  it('blinda tags e custom_field_definitions por tenant', () => {
    expect(sql).toContain('drop policy if exists "Enable all access for authenticated users" on public.tags');
    expect(sql).toContain('create policy "tags_select_by_tenant" on public.tags');
    expect(sql).toContain('create policy "tags_mutate_by_tenant_operator" on public.tags');
    expect(sql).toContain('drop policy if exists "Enable all access for authenticated users" on public.custom_field_definitions');
    expect(sql).toContain('create policy "custom_field_definitions_select_by_tenant" on public.custom_field_definitions');
    expect(sql).toContain('create policy "custom_field_definitions_mutate_by_tenant_operator" on public.custom_field_definitions');
  });

  it('adiciona policies a profile_permissions (era deny-all)', () => {
    expect(sql).toContain('create policy "profile_permissions_select" on public.profile_permissions');
    expect(sql).toContain('create policy "profile_permissions_mutate_by_admin" on public.profile_permissions');
    expect(sql).toContain('user_id = auth.uid()');
    expect(sql).toContain('public.can_configure_organization(organization_id)');
  });

  it('cada tabela blindada referencia helper can_*_organization', () => {
    for (const tableName of [
      'profiles',
      'organizations',
      'leads',
      'tags',
      'custom_field_definitions',
      'profile_permissions',
    ]) {
      expect(sql).toContain(`on public.${tableName}`);
    }
    expect(sql).toContain('public.can_access_organization');
    expect(sql).toContain('public.can_operate_organization');
    expect(sql).toContain('public.can_configure_organization');
  });
});
