import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260803090000_p3_fixed_only_commission_guard.sql',
), 'utf8');

describe('P3 — contrato somente fixo', () => {
  it('resolve o pay_type histórico e zera comissão de contratos fixed', () => {
    const sql = migration();

    expect(sql).toContain('professional_pay_type_at');
    expect(sql).toMatch(/professional_pay_type_at\([\s\S]+\) = 'fixed'[\s\S]+RETURN 0/i);
    expect(sql).toMatch(/UPDATE public\.atendimentos a[\s\S]+SET commission_amount = 0/i);
    expect(sql).toContain("AT TIME ZONE 'America/Sao_Paulo'");
  });

  it('não expõe os resolvedores internos ao cliente autenticado', () => {
    const sql = migration();

    expect(sql).toMatch(/professional_pay_type_at[\s\S]+FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/resolve_commission_amount[\s\S]+FROM PUBLIC, anon, authenticated/i);
  });
});
