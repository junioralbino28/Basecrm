import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAtendimentos } from './useAtendimentosQuery';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false }),
}));
vi.mock('@/context/TenantContext', () => ({
  useTenant: () => ({ tenant: { organizationId: 'org1' }, loading: false }),
}));

const getAll = vi.fn();
vi.mock('@/lib/supabase', () => ({
  atendimentosService: {
    getAll: (...args: unknown[]) => getAll(...args),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAtendimentos', () => {
  beforeEach(() => getAll.mockReset());

  it('busca atendimentos do tenant atual', async () => {
    getAll.mockResolvedValue({
      data: [
        {
          id: 'a1',
          procedimento: 'Limpeza',
          valor: 250,
          desconto: 0,
          recebido: true,
          installments: 1,
          performedAt: '2026-06-09T12:00:00.000Z',
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useAtendimentos(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAll).toHaveBeenCalledWith('org1');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].procedimento).toBe('Limpeza');
  });
});
