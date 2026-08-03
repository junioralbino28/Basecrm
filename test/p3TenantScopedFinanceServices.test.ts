import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('P3 — serviços financeiros sempre recebem o tenant ativo', () => {
  it('professionals não infere organização e filtra mutações por organização', () => {
    const service = read('lib/supabase/professionals.ts');
    const hooks = read('lib/query/hooks/useProfessionalsQuery.ts');

    expect(service).not.toContain('getCurrentOrganizationId');
    expect(service).toContain('async getAll(organizationId: string)');
    expect(service).toContain('async getActive(organizationId: string)');
    expect(service).toMatch(/async update\([\s\S]+organizationId: string[\s\S]+\.eq\('organization_id', orgId\)/i);
    expect(service).toMatch(/async delete\([\s\S]+organizationId: string[\s\S]+\.eq\('organization_id', orgId\)/i);
    expect(hooks).toContain('professionalsService.update(id, updates, organizationId)');
    expect(hooks).toContain('professionalsService.delete(id, organizationId)');
  });

  it('commissionRules não infere organização e filtra mutações por organização', () => {
    const service = read('lib/supabase/commissionRules.ts');
    const hooks = read('lib/query/hooks/useCommissionRulesQuery.ts');

    expect(service).not.toContain('getCurrentOrganizationId');
    expect(service).toContain('async getAll(organizationId: string)');
    expect(service).toMatch(/async update\([\s\S]+organizationId: string[\s\S]+\.eq\('organization_id', orgId\)/i);
    expect(service).toMatch(/async delete\([\s\S]+organizationId: string[\s\S]+\.eq\('organization_id', orgId\)/i);
    expect(hooks).toContain('commissionRulesService.update(id, updates, organizationId)');
    expect(hooks).toContain('commissionRulesService.delete(id, organizationId)');
  });
});
