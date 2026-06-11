import { describe, expect, it, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('./client', () => ({
  supabase: { from: (...a: unknown[]) => fromMock(...a) },
}));

import { appointmentsService } from './appointments';

/**
 * Builder de chain Supabase: o mesmo objeto é retornado por select/order/eq/gte/lte
 * (chainable) e é thenable, resolvendo em { data, error } — espelha como o service
 * encadeia `.select().order().eq()` e depois `await query`.
 */
function chainReturning(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.order = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lte = vi.fn(self);
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => resolve({ data, error });
  return chain as {
    select: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    gte: ReturnType<typeof vi.fn>;
    lte: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('appointmentsService.getAll', () => {
  it('lê o cache filtrando por organization_id e transforma snake→camel', async () => {
    const chain = chainReturning([
      { id: 'a1', organization_id: 'org-1', contact_id: null, professional_id: null, starts_at: '2026-06-12T09:00:00', ends_at: '2026-06-12T10:00:00', status: 'agendado', source: 'clinicorp_api', external_id: '987', notes: 'Lucas', created_at: 'x', updated_at: 'y', owner_id: null },
    ]);
    fromMock.mockReturnValue(chain);

    const { data, error } = await appointmentsService.getAll('11111111-1111-4111-8111-111111111111');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].externalId).toBe('987');
    expect(data![0].organizationId).toBe('org-1');
    expect(data![0].startsAt).toBe('2026-06-12T09:00:00');
    expect(fromMock).toHaveBeenCalledWith('appointments');
    expect(chain.eq).toHaveBeenCalledWith('organization_id', '11111111-1111-4111-8111-111111111111');
  });

  it('propaga erro do supabase', async () => {
    fromMock.mockReturnValue(chainReturning(null, new Error('rls')));
    const { data, error } = await appointmentsService.getAll('11111111-1111-4111-8111-111111111111');
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});
