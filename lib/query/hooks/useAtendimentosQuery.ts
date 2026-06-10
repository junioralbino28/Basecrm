/**
 * TanStack Query hooks para Atendimentos - Supabase Edition
 *
 * Features:
 * - Chamadas reais ao Supabase
 * - Optimistic updates (insert + rollback) para feedback instantâneo
 * - Invalidação automática de cache
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { atendimentosService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import type { Atendimento } from '@/types';

// ============ QUERY HOOKS ============

/**
 * Busca todos os atendimentos do tenant. Aguarda auth/tenant prontos (RLS).
 */
export const useAtendimentos = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.atendimentos.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await atendimentosService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

// ============ MUTATION HOOKS ============

interface CreateAtendimentoParams {
  atendimento: Omit<Atendimento, 'id'>;
}

/**
 * Cria um atendimento com optimistic insert + rollback.
 */
export const useCreateAtendimento = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({ atendimento }: CreateAtendimentoParams) => {
      const { data, error } = await atendimentosService.create(atendimento, organizationId);
      if (error) throw error;
      return data!;
    },
    onMutate: async ({ atendimento: novo }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.atendimentos.all });
      const key = [...queryKeys.atendimentos.lists(), organizationId];
      const previous = queryClient.getQueryData<Atendimento[]>(key);

      const temp: Atendimento = {
        ...novo,
        id: `temp-${Date.now()}`,
      } as Atendimento;

      queryClient.setQueryData<Atendimento[]>(key, (old = []) => [temp, ...old]);
      return { previous, key, tempId: temp.id };
    },
    onSuccess: (data, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData<Atendimento[]>(context.key, (old = []) => {
        const withoutTemp = old.filter(a => a.id !== context.tempId);
        const exists = withoutTemp.some(a => a.id === data.id);
        return exists ? withoutTemp : [data, ...withoutTemp];
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.atendimentos.all });
    },
    onError: (_error, _params, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.atendimentos.all });
    },
  });
};

/**
 * Atualiza um atendimento com optimistic merge + rollback.
 */
export const useUpdateAtendimento = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Atendimento> }) => {
      const { error } = await atendimentosService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.atendimentos.all });
      const key = [...queryKeys.atendimentos.lists(), organizationId];
      const previous = queryClient.getQueryData<Atendimento[]>(key);
      queryClient.setQueryData<Atendimento[]>(key, (old = []) =>
        old.map(a => (a.id === id ? { ...a, ...updates } : a))
      );
      return { previous, key };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.atendimentos.all });
    },
  });
};

/**
 * Exclui um atendimento com optimistic remove + rollback.
 */
export const useDeleteAtendimento = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await atendimentosService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: queryKeys.atendimentos.all });
      const key = [...queryKeys.atendimentos.lists(), organizationId];
      const previous = queryClient.getQueryData<Atendimento[]>(key);
      queryClient.setQueryData<Atendimento[]>(key, (old = []) => old.filter(a => a.id !== id));
      return { previous, key };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.atendimentos.all });
    },
  });
};
