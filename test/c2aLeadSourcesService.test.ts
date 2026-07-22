// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('C2A — serviço de origens arquiva em vez de apagar', () => {
  it('não expõe delete físico e mantém contacts.source fora do backfill', () => {
    const service = readFileSync(resolve(process.cwd(), 'lib/supabase/leadSources.ts'), 'utf8');
    const migration = readFileSync(resolve(
      process.cwd(),
      'supabase/migrations/20260722030000_c2a_lead_sources.sql',
    ), 'utf8');

    expect(service).toContain('async archive(');
    expect(service).not.toContain('async delete(');
    expect(service).not.toMatch(/from\('lead_sources'\)[\s\S]{0,120}\.delete\(\)/);
    expect(migration).not.toMatch(/insert into public\.lead_source_attributions[\s\S]+contacts\.source/i);
  });
});
