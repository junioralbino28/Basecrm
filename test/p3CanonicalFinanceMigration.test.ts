import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260803020000_p3_canonical_finance_resolver.sql',
), 'utf8');

describe('Pacote 3 — resolvedor financeiro canônico', () => {
  it('resolve comissão em uma função compartilhada usando performed_at', () => {
    const sql = migration();
    expect(sql).toContain('resolve_commission_amount');
    expect(sql).toContain('a.performed_at');
    expect(sql.match(/resolve_commission_amount/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('não condiciona comissão ao recebimento do atendimento', () => {
    const sql = migration();
    const resolver = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.resolve_commission_amount'));
    expect(resolver).not.toMatch(/a\.recebido\s*=\s*true[\s\S]*resolve_commission_amount/i);
  });

  it('rateia o fixo por dia e inclui fixo e comissão no resultado líquido', () => {
    const sql = migration();
    expect(sql).toContain('fixed_compensation_for_period');
    expect(sql).toContain("generate_series");
    expect(sql).toContain("'salarios_fixos'");
    expect(sql).toMatch(/v_faturamento\s*-\s*v_comissoes\s*-\s*v_salarios_fixos/i);
  });

  it('usa IDs estáveis de produto e especialidade no resolvedor', () => {
    const sql = migration();
    expect(sql).toContain('product_id uuid');
    expect(sql).toContain('specialty_id uuid');
    expect(sql).toContain('specialty_products');
  });
});
