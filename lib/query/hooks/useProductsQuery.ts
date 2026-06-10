/**
 * TanStack Query hook para o catálogo de Produtos/Procedimentos.
 *
 * Wrapper fino de `productsService.getActive` (CONTRATO da Fase 4):
 * o drawer de atendimento lista só itens ativos do catálogo.
 */
import { useQuery } from '@tanstack/react-query';
import { productsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';

/**
 * Busca os produtos/procedimentos ATIVOS do tenant. Aguarda auth/tenant prontos (RLS).
 */
export const useProducts = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: ['products', 'list', 'active', organizationId],
    queryFn: async () => {
      const { data, error } = await productsService.getActive(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};
