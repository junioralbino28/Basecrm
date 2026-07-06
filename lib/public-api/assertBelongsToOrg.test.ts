import { describe, it, expect } from 'vitest';
import { belongsToOrg, firstInvalidFk } from './assertBelongsToOrg';

// Fake mínimo do supabase client: `.from(t).select().eq('organization_id',org).eq('id',id).maybeSingle()`
// resolve para a linha só se `belongs(table,id,org)`.
function makeSb(belongs: (table: string, id: string, org: string) => boolean) {
  return {
    from(table: string) {
      let org = '';
      let id = '';
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === 'organization_id') org = val;
          if (col === 'id') id = val;
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: belongs(table, id, org) ? { id } : null, error: null }),
      };
      return chain;
    },
  } as any;
}

// Só 'own' pertence à org 'A'.
const sb = makeSb((_t, id, org) => org === 'A' && id === 'own');

describe('belongsToOrg', () => {
  it('true para linha da própria org', async () => {
    expect(await belongsToOrg(sb, 'boards', 'own', 'A')).toBe(true);
  });
  it('false para linha de outra org (fix cross-tenant)', async () => {
    expect(await belongsToOrg(sb, 'boards', 'other', 'A')).toBe(false);
  });
  it('true quando id é vazio/null (campo opcional ausente)', async () => {
    expect(await belongsToOrg(sb, 'boards', null, 'A')).toBe(true);
    expect(await belongsToOrg(sb, 'boards', '', 'A')).toBe(true);
  });
});

describe('firstInvalidFk', () => {
  it('retorna o PRIMEIRO campo cross-org', async () => {
    const bad = await firstInvalidFk(sb, 'A', [
      { table: 'boards', id: 'own', field: 'board_id' },
      { table: 'contacts', id: 'other', field: 'contact_id' },
      { table: 'crm_companies', id: 'other', field: 'client_company_id' },
    ]);
    expect(bad).toBe('contact_id');
  });
  it('null quando todos pertencem à org', async () => {
    const ok = await firstInvalidFk(sb, 'A', [
      { table: 'boards', id: 'own', field: 'board_id' },
      { table: 'contacts', id: 'own', field: 'contact_id' },
    ]);
    expect(ok).toBeNull();
  });
});
