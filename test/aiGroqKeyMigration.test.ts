import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');
const SECRET_COLUMNS = ['ai_groq_key', 'ai_google_key', 'ai_openai_key', 'ai_anthropic_key', 'meta_capi_access_token'];

/** Todas as listas de colunas de `grant select (...) on public.organization_settings` do histórico. */
function grantedColumns() {
  const columns: Array<{ file: string; column: string }> = [];
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    const pattern = /grant\s+select\s*\(([^)]*)\)\s*on\s+(?:table\s+)?public\.organization_settings/gi;
    for (const match of sql.matchAll(pattern)) {
      for (const column of match[1].split(',')) columns.push({ file, column: column.trim().toLowerCase() });
    }
  }
  return columns;
}

describe('organization_settings.ai_groq_key: segredo que o navegador não lê', () => {
  const sql = readFileSync(resolve(MIGRATIONS, '20260921010000_organization_settings_ai_groq_key.sql'), 'utf8');

  it('a migration é aditiva: só acrescenta a coluna, sem conceder nem revogar nada', () => {
    expect(sql).toContain('add column if not exists ai_groq_key text');
    const statements = sql.replace(/--.*$/gm, '').toLowerCase();
    expect(statements).not.toMatch(/\bgrant\b/);
    expect(statements).not.toMatch(/\brevoke\b/);
    expect(statements).not.toMatch(/\bdrop\b/);
    expect(statements).not.toMatch(/\bpolicy\b/);
  });

  it('o SELECT do navegador em organization_settings continua sendo lista fechada (M6)', () => {
    const m6 = readFileSync(resolve(MIGRATIONS, '20260630020000_m6_adversarial_fixes.sql'), 'utf8');
    expect(m6).toContain('revoke select on public.organization_settings from anon;');
    expect(m6).toContain('revoke select on public.organization_settings from authenticated;');
  });

  it('nenhuma migration, antiga ou futura, concede SELECT de coluna secreta ao navegador', () => {
    const granted = grantedColumns();
    expect(granted.length).toBeGreaterThan(0);
    for (const secret of SECRET_COLUMNS) {
      expect(granted.filter((entry) => entry.column === secret)).toEqual([]);
    }
  });

  it('nenhuma migration devolve o SELECT da tabela inteira ao navegador', () => {
    for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))) {
      const statements = readFileSync(resolve(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '');
      expect(statements, file).not.toMatch(
        /grant\s+(?:select|all(?:\s+privileges)?)\s+on\s+(?:table\s+)?public\.organization_settings\s+to\s+[^;]*\b(?:authenticated|anon)\b/i,
      );
    }
  });
});
