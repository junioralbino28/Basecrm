import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const sql = fs.readFileSync(
  'supabase/migrations/20260803070000_p3_internal_finance_maintenance.sql',
  'utf8',
);

describe('P3 — manutenção interna de remuneração', () => {
  it('service_role e postgres não dependem de profile', () => {
    expect(sql).toContain("current_user IN ('postgres', 'service_role')");
    expect(sql.indexOf("current_user IN ('postgres', 'service_role')"))
      .toBeLessThan(sql.indexOf("has_permission('settings.finance')"));
  });
});
