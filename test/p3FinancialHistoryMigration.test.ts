import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260803010000_p3_financial_history.sql',
), 'utf8');

describe('Pacote 3 — histórico financeiro imutável', () => {
  it('versiona a remuneração fixa por colaborador e vigência', () => {
    expect(sql()).toContain('CREATE TABLE IF NOT EXISTS public.professional_compensation_versions');
    expect(sql()).toContain('valid_from date NOT NULL');
    expect(sql()).toContain('trg_version_professional_compensation');
  });

  it('bloqueia update e delete de regra de comissão já vigente', () => {
    expect(sql()).toContain('protect_historical_commission_rule');
    expect(sql()).toMatch(/BEFORE UPDATE OR DELETE ON public\.commission_rules/i);
    expect(sql()).toContain("(now() AT TIME ZONE 'America/Sao_Paulo')::date");
    expect(sql()).toContain('OLD.valid_from < v_today');
  });

  it('mantém amount e percent coerentes por constraint', () => {
    expect(sql()).toContain('commission_rules_percent_consistency_chk');
    expect(sql()).toMatch(/amount_type = 'percent'[\s\S]+amount = percent/i);
  });

  it('protege a tabela de versões com same-org, RLS e ACL mínima', () => {
    const migration = sql();
    expect(migration).toContain('FOREIGN KEY (organization_id, professional_id)');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.professional_compensation_versions FROM PUBLIC, anon/i);
    expect(migration).toMatch(/REVOKE INSERT, UPDATE, DELETE ON TABLE public\.professional_compensation_versions FROM authenticated/i);
    expect(migration).toMatch(/version_professional_compensation\(\)[\s\S]+SECURITY DEFINER/i);
    expect(migration).not.toMatch(/GRANT SELECT, INSERT ON TABLE public\.professional_compensation_versions TO authenticated/i);
  });

  it('exige settings.finance para criar ou alterar remuneração financeira', () => {
    const migration = sql();
    expect(migration).toContain('guard_professional_financial_fields');
    expect(migration).toContain("has_permission('settings.finance')");
    expect(migration).toContain("NEW.pay_type IS DISTINCT FROM 'commission'");
    expect(migration).toContain('OLD.fixed_amount IS DISTINCT FROM NEW.fixed_amount');
  });
});
