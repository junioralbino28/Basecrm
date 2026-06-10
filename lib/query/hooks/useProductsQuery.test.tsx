import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useProducts } from './useProductsQuery';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false }),
}));
vi.mock('@/context/TenantContext', () => ({
  useTenant: () => ({ tenant: { organizationId: 'org1' }, loading: false }),
}));

const getActive = vi.fn();
vi.mock('@/lib/supabase', () => ({
  productsService: {
    getActive: (...args: unknown[]) => getActive(...args),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useProducts (catálogo ativo)', () => {
  beforeEach(() => getActive.mockReset());

  it('busca o catálogo ativo do tenant atual via productsService.getActive', async () => {
    getActive.mockResolvedValue({
      data: [{ id: 'prod1', name: 'Limpeza', price: 250, active: true }],
      error: null,
    });

    const { result } = renderHook(() => useProducts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getActive).toHaveBeenCalledWith('org1');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name).toBe('Limpeza');
  });
});
