import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContactStageCounts } from './useContactsQuery';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false }),
}));

vi.mock('@/context/TenantContext', () => ({
  useTenant: () => ({
    tenant: { organizationId: '10000000-0000-4000-8000-000000000001' },
    loading: false,
  }),
}));

const { getStageCounts, getAll } = vi.hoisted(() => ({
  getStageCounts: vi.fn(),
  getAll: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  contactsService: {
    getStageCounts: (...args: unknown[]) => getStageCounts(...args),
    getAll: (...args: unknown[]) => getAll(...args),
  },
  companiesService: {},
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useContactStageCounts', () => {
  beforeEach(() => {
    getStageCounts.mockReset();
    getAll.mockReset();
  });

  it('usa a RPC tenantizada e não baixa até 10 mil contatos para contar no cliente', async () => {
    getStageCounts.mockResolvedValue({
      data: { LEAD: 3, CUSTOMER: 1 },
      error: null,
    });

    const { result } = renderHook(() => useContactStageCounts(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getStageCounts).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
    );
    expect(getAll).not.toHaveBeenCalled();
    expect(result.current.data).toEqual({ LEAD: 3, CUSTOMER: 1 });
  });

  it('expõe como falha o erro devolvido pela RPC segura', async () => {
    getStageCounts.mockResolvedValue({
      data: null,
      error: new Error('acesso recusado'),
    });

    const { result } = renderHook(() => useContactStageCounts(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'acesso recusado' });
  });
});
