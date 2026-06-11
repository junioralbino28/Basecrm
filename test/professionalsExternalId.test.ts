// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260628000000_professionals_external_id.sql'
);

describe('professionals.external_id migration', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('adiciona a coluna external_id idempotente', () => {
    expect(sql).toContain('alter table public.professionals');
    expect(sql).toContain('add column if not exists external_id text');
  });

  it('cria índice único por org+external_id (arbiter do onConflict do sync)', () => {
    expect(sql).toContain('uniq_professionals_org_external_id');
    expect(sql).toContain('(organization_id, external_id)');
  });
});
