import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('P3 — especialidade é arquivada, nunca apagada pelo cliente', () => {
  it('remove DELETE/TRUNCATE de authenticated e elimina a policy de exclusão', () => {
    const sql = read('supabase/migrations/20260803100000_p3_specialty_archive_guard.sql');

    expect(sql).toMatch(
      /REVOKE DELETE, TRUNCATE ON TABLE public\.specialties FROM authenticated/i,
    );
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS specialties_delete_by_admin ON public\.specialties/i,
    );
  });

  it('mantém o fluxo do aplicativo como UPDATE active=false', () => {
    const service = read('lib/supabase/teamCatalogs.ts');

    expect(service).toMatch(
      /kind === 'specialties'[\s\S]{0,180}from\(kind\)\.update\(\{ active: false/i,
    );
  });
});
