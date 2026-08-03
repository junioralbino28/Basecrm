import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260803080000_p3_historical_rule_timezone.sql',
), 'utf8');

describe('P3 — data local na proteção de regras históricas', () => {
  it('usa o dia de São Paulo e mantém o bypass restrito aos roles internos', () => {
    const sql = migration();

    expect(sql).toContain("(now() AT TIME ZONE 'America/Sao_Paulo')::date");
    expect(sql).not.toMatch(/IF OLD\.valid_from < CURRENT_DATE/i);
    expect(sql).toContain("current_user IN ('postgres', 'service_role')");
    expect(sql).toContain('OLD.specialty_id IS DISTINCT FROM NEW.specialty_id');
    expect(sql).toContain('OLD.product_id IS DISTINCT FROM NEW.product_id');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
  });
});
