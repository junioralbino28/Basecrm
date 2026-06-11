// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260626000000_clinicorp_config.sql'
);

describe('clinicorp_config RLS migration', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('cria a tabela idempotente com RLS habilitado', () => {
    expect(sql).toContain('create table if not exists public.clinicorp_config');
    expect(sql).toContain('alter table public.clinicorp_config enable row level security');
  });

  it('guarda credenciais por tenant (api_user, api_token, subscriber_id, code_link, business_id)', () => {
    for (const col of ['api_user', 'api_token', 'subscriber_id', 'code_link', 'business_id']) {
      expect(sql).toContain(col);
    }
  });

  it('config financeira/integração só pra quem configura — sem USING (true)', () => {
    expect(sql).toContain('public.can_configure_organization(organization_id)');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('não expõe SELECT a can_access (token nunca vaza pra clinic_staff)', () => {
    expect(sql).not.toContain('public.can_access_organization(organization_id)');
  });

  it('aplica trigger updated_at e índice por org', () => {
    expect(sql).toContain('update_clinicorp_config_updated_at');
    expect(sql).toContain('idx_clinicorp_config_org');
  });
});
