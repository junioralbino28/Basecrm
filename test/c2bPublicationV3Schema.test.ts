// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260722040000_c2b_publication_v3.sql',
);

describe('C2B — contrato SQL da publicação por etiqueta UUID', () => {
  const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

  it('materializa dependências v2 e v3 sem reescrever snapshots', () => {
    expect(sql).toContain('create or replace function public.refresh_draft_tag_dependencies');
    expect(sql).toContain('create or replace function public.refresh_published_tag_dependencies');
    expect(sql).toContain("definition ->> 'schemaversion'");
    expect(sql).toContain("definition -> 'trigger' -> 'config' ->> 'tagid'");
    expect(sql).toContain("definition -> 'trigger' -> 'config' ->> 'tag'");
    expect(sql).not.toContain('update public.automation_versions');
  });

  it('serializa a publicação pelo UUID e recusa dois donos ativos', () => {
    expect(sql).toContain('create or replace function public.guard_published_automation_tag_owner');
    expect(sql).toMatch(/from public\.tags[\s\S]*for update/);
    expect(sql).toContain('já possui uma automação publicada ativa');
    expect(sql).toContain('create trigger guard_published_automation_tag_owner');
  });

  it('mantém funções internas fora de anon e authenticated', () => {
    expect(sql).toMatch(
      /revoke all on function public\.guard_published_automation_tag_owner\(\)\s+from public, anon, authenticated/,
    );
  });
});
