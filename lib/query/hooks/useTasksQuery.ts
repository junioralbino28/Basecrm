/**
 * TanStack Query hooks para Tarefas & Lembretes (N2) - Supabase Edition
 *
 * Espelho de useAtendimentosQuery:
 * - Chamadas reais ao Supabase
 * - Optimistic updates (insert + rollback) para feedback instantâneo
 * - Invalidação automática de cache
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { tasksService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import type { Task } from '@/types';

// ============ QUERY HOOKS ============

/**
 * Busca todas as tarefas do tenant. Aguarda auth/tenant prontos (RLS).
 */
export const useTasks = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.tasks.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await tasksService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

// ============ MUTATION HOOKS ============

interface CreateTaskParams {
  task: Omit<Task, 'id'>;
}

/**
 * Cria uma tarefa com optimistic insert + rollback.
 */
export const useCreateTask = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({ task }: CreateTaskParams) => {
      const { data, error } = await tasksService.create(task, organizationId);
      if (error) throw error;
      return data!;
    },
    onMutate: async ({ task: nova }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks.all });
      const key = [...queryKeys.tasks.lists(), organizationId];
      const previous = queryClient.getQueryData<Task[]>(key);

      const temp: Task = {
        ...nova,
        id: `temp-${Date.now()}`,
      } as Task;

      queryClient.setQueryData<Task[]>(key, (old = []) => [temp, ...old]);
      return { previous, key, tempId: temp.id };
    },
    onSuccess: (data, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData<Task[]>(context.key, (old = []) => {
        const withoutTemp = old.filter(t => t.id !== context.tempId);
        const exists = withoutTemp.some(t => t.id === data.id);
        return exists ? withoutTemp : [data, ...withoutTemp];
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
    onError: (_error, _params, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
};

/**
 * Atualiza uma tarefa com optimistic merge + rollback.
 * Concluir = updates { status: 'done' } (service carimba completed_at);
 * reabrir = { status: 'open' } (service limpa o carimbo).
 */
export const useUpdateTask = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Task> }) => {
      const { error } = await tasksService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks.all });
      const key = [...queryKeys.tasks.lists(), organizationId];
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (old = []) =>
        old.map(t => (t.id === id ? { ...t, ...updates } : t))
      );
      return { previous, key };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
};

/**
 * Exclui uma tarefa com optimistic remove + rollback.
 */
export const useDeleteTask = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tasksService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks.all });
      const key = [...queryKeys.tasks.lists(), organizationId];
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (old = []) => old.filter(t => t.id !== id));
      return { previous, key };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
};
