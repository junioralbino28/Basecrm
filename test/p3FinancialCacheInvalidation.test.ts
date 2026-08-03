import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const read = (file: string) => fs.readFileSync(file, 'utf8');

describe('P3 — invalidação derivada dos relatórios financeiros', () => {
  it('atendimentos invalidam receita, comissão e resultado líquido', () => {
    const source = read('lib/query/hooks/useAtendimentosQuery.ts');
    expect(source).toContain('queryKeys.dashboard.revenueRoot');
    expect(source).toContain('queryKeys.dashboard.commissionRoot');
    expect(source).toContain('queryKeys.dashboard.netResultRoot');
  });

  it.each([
    'lib/query/hooks/useCommissionRulesQuery.ts',
    'lib/query/hooks/useProfessionalsQuery.ts',
  ])('%s invalida comissão e resultado líquido', (file) => {
    const source = read(file);
    expect(source).toContain('queryKeys.dashboard.commissionRoot');
    expect(source).toContain('queryKeys.dashboard.netResultRoot');
  });

  it.each([
    'lib/query/hooks/useFixedCostsQuery.ts',
    'lib/query/hooks/usePaymentMethodFeesQuery.ts',
  ])('%s invalida resultado líquido', (file) => {
    expect(read(file)).toContain('queryKeys.dashboard.netResultRoot');
  });

  it.each([
    'features/settings/components/SpecialtyProductsPicker.tsx',
    'features/settings/components/CommissionsManager.tsx',
  ])('%s invalida relatórios ao mudar vínculos', (file) => {
    const source = read(file);
    expect(source).toContain('queryKeys.dashboard.commissionRoot');
    expect(source).toContain('queryKeys.dashboard.netResultRoot');
  });
});
