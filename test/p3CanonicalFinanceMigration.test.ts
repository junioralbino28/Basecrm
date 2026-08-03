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
    expect(sql).toContain('canonicalize_commission_rule_refs');
  });

  it('não transforma especialidade legada não migrada em regra global', () => {
    const sql = migration();
    expect(sql).toContain('(c.specialty_id IS NULL AND c.specialty IS NULL)');
    expect(sql).toMatch(/c\.specialty_id IS NULL[\s\S]+c\.specialty IS NOT NULL[\s\S]+professional_has_specialty/i);
  });

  it('protege os IDs canônicos de regras históricas', () => {
    const sql = migration();
    expect(sql).toContain('OLD.specialty_id IS DISTINCT FROM NEW.specialty_id');
    expect(sql).toContain('OLD.product_id IS DISTINCT FROM NEW.product_id');
  });

  it('mantém no relatório a remuneração fixa histórica de pessoa hoje inativa', () => {
    const sql = migration();
    expect(sql).toMatch(/OR EXISTS \([\s\S]+professional_compensation_versions cv[\s\S]+cv\.active = true[\s\S]+cv\.pay_type IN \('fixed', 'both'\)/i);
  });

  it('congela a comissão no atendimento e ignora tentativa de editar só o snapshot', () => {
    const sql = migration();
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS commission_amount numeric');
    expect(sql).toContain('ALTER COLUMN commission_amount SET NOT NULL');
    expect(sql).toContain('atendimentos_commission_amount_chk');
    expect(sql).toContain('snapshot_atendimento_commission');
    expect(sql).toMatch(/snapshot_atendimento_commission\(\)[\s\S]+SECURITY DEFINER/i);
    expect(sql).toContain('NEW.commission_amount := OLD.commission_amount');
    expect(sql).toMatch(/UPDATE public\.atendimentos a[\s\S]+SET commission_amount = public\.resolve_commission_amount/i);
  });

  it('relatórios somam o snapshot e não reavaliam fatos históricos', () => {
    const sql = migration();
    const reportStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_commission_report');
    const netStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_net_result');
    const report = sql.slice(reportStart, netStart);
    const net = sql.slice(netStart);
    expect(report).toContain('sum(a.commission_amount)');
    expect(net).toContain('sum(a.commission_amount)');
    expect(report).not.toContain('resolve_commission_amount(');
    expect(net).not.toContain('resolve_commission_amount(');
  });

  it('aplica settings.finance nas policies de commission_rules', () => {
    const sql = migration();
    expect(sql).toMatch(/CREATE POLICY "commission_rules_select_by_tenant_admin"[\s\S]+has_permission\('settings\.finance'\)/i);
    expect(sql).toMatch(/CREATE POLICY "commission_rules_mutate_by_tenant_admin"[\s\S]+WITH CHECK[\s\S]+has_permission\('settings\.finance'\)/i);
  });
});
