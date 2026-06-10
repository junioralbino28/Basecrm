import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getRevenueReport = vi.fn();
const getCommissionReport = vi.fn();
const getNetResult = vi.fn();

vi.mock('@/lib/supabase', () => ({
  reportsService: {
    getRevenueReport: (...a: unknown[]) => getRevenueReport(...a),
    getCommissionReport: (...a: unknown[]) => getCommissionReport(...a),
    getNetResult: (...a: unknown[]) => getNetResult(...a),
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false }),
}));

vi.mock('@/context/TenantContext', () => ({
  useTenant: () => ({ tenant: { organizationId: 'org-1' }, loading: false }),
}));

import { useRevenueReport, useNetResult } from './useFinanceReports';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useFinanceReports', () => {
  beforeEach(() => {
    getRevenueReport.mockReset();
    getNetResult.mockReset();
  });

  it('useRevenueReport busca o faturamento do período passando a org do tenant pro RPC', async () => {
    getRevenueReport.mockResolvedValue({
      data: { faturamento: 10000, totalAtendimentos: 5, porMes: [], porSemana: [] },
      error: null,
    });

    const { result } = renderHook(
      () => useRevenueReport('2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.faturamento).toBe(10000);
    expect(getRevenueReport).toHaveBeenCalledWith(
      '2026-06-01T00:00:00Z',
      '2026-06-30T23:59:59Z',
      'org-1'
    );
  });

  it('useNetResult lança erro quando o service retorna error', async () => {
    getNetResult.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(
      () => useNetResult('2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
