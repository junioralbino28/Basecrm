/**
 * TanStack Query hooks para relatórios financeiros (read-only — F8).
 *
 * Lê dos RPCs via reportsService. Sem mutations (relatório é derivado).
 * Enabled-gate aguarda auth + tenant prontos; a org do tenant ativo é passada
 * pro RPC (que valida can_configure_organization DENTRO — clinic_staff recebe
 * erro, nunca dado).
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { reportsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';

/**
 * Faturamento (recebido) do período + breakdown por mês e por semana.
 */
export const useRevenueReport = (start: string, end: string) => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.dashboard.revenue(start, end), organizationId],
    queryFn: async () => {
      const { data, error } = await reportsService.getRevenueReport(start, end, organizationId);
      if (error) throw error;
      return data;
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 60 * 1000,
  });
};

/**
 * Comissão por profissional no período (com paga/a pagar).
 */
export const useCommissionReport = (start: string, end: string) => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.dashboard.commission(start, end), organizationId],
    queryFn: async () => {
      const { data, error } = await reportsService.getCommissionReport(start, end, organizationId);
      if (error) throw error;
      return data;
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 60 * 1000,
  });
};

/**
 * Resultado líquido do período (faturamento − comissões − taxas − contas).
 */
export const useNetResult = (start: string, end: string) => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.dashboard.netResult(start, end), organizationId],
    queryFn: async () => {
      const { data, error } = await reportsService.getNetResult(start, end, organizationId);
      if (error) throw error;
      return data;
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 60 * 1000,
  });
};
