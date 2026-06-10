import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('useRealtimeSync finance config support', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'lib/realtime/useRealtimeSync.ts'),
    'utf-8'
  );

  it('inclui as tabelas de config financeira na union RealtimeTable', () => {
    expect(src).toContain("| 'payment_method_fees'");
    expect(src).toContain("| 'commission_rules'");
    expect(src).toContain("| 'fixed_costs'");
  });

  it('mapeia cada tabela para a query key simples', () => {
    expect(src).toContain('payment_method_fees: [queryKeys.paymentMethodFees.all]');
    expect(src).toContain('commission_rules: [queryKeys.commissionRules.all]');
    expect(src).toContain('fixed_costs: [queryKeys.fixedCosts.all]');
  });
});
