/**
 * TanStack Query hooks para Contas Fixas - Supabase Edition
 *
 * Config financeira (gate do Adel): RLS can_configure em SELECT e mutação —
 * clinic_staff nem lê. Features:
 * - Chamadas reais ao Supabase
 * - Optimistic updates para feedback instantâneo
 * - Invalidação automática de cache
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { fixedCostsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import type { FixedCost } from '@/types';

// ============ QUERY HOOKS ============

/**
 * Busca todas as contas fixas do tenant. Aguarda auth/tenant prontos (RLS).
 */
export const useFixedCosts = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.fixedCosts.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await fixedCostsService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

// ============ MUTATION HOOKS ============

interface CreateFixedCostParams {
  name: string;
  amount: number;
  dueDay?: number;
}

/**
 * Cria uma conta fixa com optimistic insert + rollback.
 */
export const useCreateFixedCost = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (input: CreateFixedCostParams) => {
      const { data, error } = await fixedCostsService.create({
        ...input,
        organizationId,
      });
      if (error) throw error;
      return data!;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.fixedCosts.all });
      const listKey = [...queryKeys.fixedCosts.lists(), organizationId];
      const previous = queryClient.getQueryData<FixedCost[]>(listKey);

      const temp: FixedCost = {
        id: `temp-${Date.now()}`,
        organizationId: organizationId || undefined,
        name: input.name,
        amount: input.amount,
        dueDay: input.dueDay,
        active: true,
      };

      queryClient.setQueryData<FixedCost[]>(listKey, (old = []) => [temp, ...old]);
      return { previous, listKey, tempId: temp.id };
    },
    onSuccess: (data, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<FixedCost[]>(context.listKey, (old = []) => {
        const withoutTemp = old.filter((c) => c.id !== context.tempId);
        const exists = withoutTemp.some((c) => c.id === data.id);
        return exists ? withoutTemp : [data, ...withoutTemp];
      });
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fixedCosts.all });
    },
  });
};

/**
 * Atualiza uma conta fixa (parcial — só campos editados).
 */
export const useUpdateFixedCost = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{ name: string; amount: number; dueDay?: number; active: boolean }>;
    }) => {
      const { error } = await fixedCostsService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.fixedCosts.all });
      const listKey = [...queryKeys.fixedCosts.lists(), organizationId];
      const previous = queryClient.getQueryData<FixedCost[]>(listKey);
      queryClient.setQueryData<FixedCost[]>(listKey, (old = []) =>
        old.map((c) => (c.id === id ? { ...c, ...updates } : c))
      );
      return { previous, listKey };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fixedCosts.all });
    },
  });
};

/**
 * Exclui uma conta fixa com optimistic remove + rollback.
 */
export const useDeleteFixedCost = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await fixedCostsService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.fixedCosts.all });
      const listKey = [...queryKeys.fixedCosts.lists(), organizationId];
      const previous = queryClient.getQueryData<FixedCost[]>(listKey);
      queryClient.setQueryData<FixedCost[]>(listKey, (old = []) =>
        old.filter((c) => c.id !== id)
      );
      return { previous, listKey };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fixedCosts.all });
    },
  });
};
