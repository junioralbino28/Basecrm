/**
 * TanStack Query hooks para Regras de Comissão - Supabase Edition
 *
 * Config financeira (gate do Adel): RLS can_configure em SELECT e mutação —
 * clinic_staff nem lê. Features:
 * - Chamadas reais ao Supabase
 * - Optimistic updates para feedback instantâneo
 * - Invalidação automática de cache
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { commissionRulesService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import type { CommissionRule } from '@/types';

// ============ QUERY HOOKS ============

/**
 * Busca todas as regras de comissão do tenant. Aguarda auth/tenant prontos (RLS).
 */
export const useCommissionRules = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.commissionRules.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await commissionRulesService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

// ============ MUTATION HOOKS ============

interface CreateCommissionRuleParams {
  professionalId?: string;
  specialty?: string;
  percent: number;
}

/**
 * Cria uma regra de comissão com optimistic insert + rollback.
 */
export const useCreateCommissionRule = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (input: CreateCommissionRuleParams) => {
      const { data, error } = await commissionRulesService.create({
        ...input,
        organizationId,
      });
      if (error) throw error;
      return data!;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.commissionRules.all });
      const listKey = [...queryKeys.commissionRules.lists(), organizationId];
      const previous = queryClient.getQueryData<CommissionRule[]>(listKey);

      const temp: CommissionRule = {
        id: `temp-${Date.now()}`,
        organizationId: organizationId || undefined,
        professionalId: input.professionalId,
        specialty: input.specialty,
        percent: input.percent,
      };

      queryClient.setQueryData<CommissionRule[]>(listKey, (old = []) => [temp, ...old]);
      return { previous, listKey, tempId: temp.id };
    },
    onSuccess: (data, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<CommissionRule[]>(context.listKey, (old = []) => {
        const withoutTemp = old.filter((r) => r.id !== context.tempId);
        const exists = withoutTemp.some((r) => r.id === data.id);
        return exists ? withoutTemp : [data, ...withoutTemp];
      });
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commissionRules.all });
    },
  });
};

/**
 * Atualiza uma regra de comissão (parcial — só campos editados).
 */
export const useUpdateCommissionRule = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{ professionalId?: string; specialty?: string; percent: number }>;
    }) => {
      const { error } = await commissionRulesService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.commissionRules.all });
      const listKey = [...queryKeys.commissionRules.lists(), organizationId];
      const previous = queryClient.getQueryData<CommissionRule[]>(listKey);
      queryClient.setQueryData<CommissionRule[]>(listKey, (old = []) =>
        old.map((r) => (r.id === id ? { ...r, ...updates } : r))
      );
      return { previous, listKey };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commissionRules.all });
    },
  });
};

/**
 * Exclui uma regra de comissão com optimistic remove + rollback.
 */
export const useDeleteCommissionRule = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await commissionRulesService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.commissionRules.all });
      const listKey = [...queryKeys.commissionRules.lists(), organizationId];
      const previous = queryClient.getQueryData<CommissionRule[]>(listKey);
      queryClient.setQueryData<CommissionRule[]>(listKey, (old = []) =>
        old.filter((r) => r.id !== id)
      );
      return { previous, listKey };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commissionRules.all });
    },
  });
};
