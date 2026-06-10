// @vitest-environment node
//
// RLS-as-text das configs financeiras (Fase 5) — gate do Adel.
//
// Diferente das tabelas operacionais (atendimentos = select can_access /
// mutate can_operate), TODA a config financeira usa can_configure_organization
// em SELECT e mutação: clinic_staff (Vitória) NÃO lê taxa, comissão, conta
// fixa nem pagamento de comissão. Se qualquer policy usar can_operate ou
// can_access, a Vitória ganha leitura de margem — este teste trava por contrato.
//
// Também trava as invariantes de domínio NO BANCO (lição F4): percentuais
// 0..100, valores ≥ 0, parcelas ≥ 1, dia de vencimento 1..31, período YYYY-MM.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260616000000_finance_config.sql'
);

describe('finance config RLS migration (só Adel — can_configure)', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  const financeConfigTables = [
    'payment_method_fees',
    'commission_rules',
    'fixed_costs',
    'commission_payments',
  ] as const;

  it('cria as 4 tabelas de config financeira com RLS habilitada', () => {
    for (const table of financeConfigTables) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain('references public.organizations(id) on delete cascade');
  });

  it('protege SELECT e mutação com can_configure_organization (exclui clinic_staff/Vitória)', () => {
    for (const table of financeConfigTables) {
      expect(sql).toContain(`"${table}_select_by_tenant_admin"`);
      expect(sql).toContain(`"${table}_mutate_by_tenant_admin"`);
    }
    expect(sql).toContain('public.can_configure_organization');
  });

  it('NÃO usa can_operate nem can_access nas tabelas de config financeira (senão Vitória lê margem)', () => {
    // Gate crítico: config financeira é exclusiva do admin da clínica.
    expect(sql).not.toContain('public.can_operate_organization');
    expect(sql).not.toContain('public.can_access_organization');
  });

  it('não deixa policies permissivas', () => {
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('aplica trigger updated_at e índices por organização', () => {
    for (const table of financeConfigTables) {
      expect(sql).toContain(`update_${table}_updated_at`);
      expect(sql).toContain(`idx_${table}_org on public.${table}(organization_id, created_at desc)`);
    }
  });

  it('garante invariantes de domínio no banco (CHECKs — lição F4)', () => {
    // Percentuais nunca fora de 0..100.
    expect(sql).toContain('fee_percent >= 0 and fee_percent <= 100');
    expect(sql).toContain('percent >= 0 and percent <= 100');
    // Valores nunca negativos.
    expect(sql).toMatch(/fixed_costs_amount_chk\s+check \(amount >= 0\)/);
    expect(sql).toMatch(/commission_payments_amount_chk\s+check \(amount >= 0\)/);
    // Parcelas ≥ 1 e forma de pagamento do domínio.
    expect(sql).toContain('installments >= 1');
    expect(sql).toContain("payment_type in ('credito', 'debito', 'pix', 'dinheiro')");
    // Dia de vencimento válido (1..31) quando informado.
    expect(sql).toContain('due_day is null or (due_day >= 1 and due_day <= 31)');
    // Período de competência YYYY-MM (alimenta o "Paga/A pagar" por período).
    expect(sql).toContain("period ~ '^\\d{4}-(0[1-9]|1[0-2])$'");
  });
});
