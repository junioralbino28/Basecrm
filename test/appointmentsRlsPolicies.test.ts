// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260627000000_appointments.sql'
);

describe('appointments RLS migration', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('cria a tabela idempotente com RLS habilitado', () => {
    expect(sql).toContain('create table if not exists public.appointments');
    expect(sql).toContain('alter table public.appointments enable row level security');
  });

  it('tem dedupe de import (UNIQUE org+source+external_id)', () => {
    expect(sql).toContain('unique (organization_id, source, external_id)');
  });

  it('SELECT can_access, mutate can_operate — sem USING (true)', () => {
    expect(sql).toContain('public.can_access_organization(organization_id)');
    expect(sql).toContain('public.can_operate_organization(organization_id)');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('aplica trigger updated_at e índice por org', () => {
    expect(sql).toContain('update_appointments_updated_at');
    expect(sql).toContain('idx_appointments_org');
  });
});
