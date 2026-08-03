import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const sql = fs.readFileSync(
  'supabase/migrations/20260803060000_p3_operational_maintenance.sql',
  'utf8',
);

describe('P3 — manutenção operacional segura', () => {
  it('mantém idempotência automática apenas como fallback de inserts internos', () => {
    expect(sql).toContain('ALTER COLUMN idempotency_key SET DEFAULT gen_random_uuid()');
  });

  it('remove versões somente quando a exclusão do profissional é permitida', () => {
    expect(sql).toContain('professional_compensation_versions_professional_same_org_fk');
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('reserva bypass histórico a roles internos', () => {
    expect(sql).toContain("current_user IN ('postgres', 'service_role')");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
  });
});
