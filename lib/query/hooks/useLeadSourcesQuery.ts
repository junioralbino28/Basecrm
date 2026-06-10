/**
 * TanStack Query hooks for Lead Sources (N1 — origens editáveis)
 *
 * Espelho de useProfessionalsQuery:
 * - Real Supabase API calls
 * - Optimistic updates for instant UI feedback
 * - Automatic cache invalidation
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { leadSourcesService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import type { LeadSource } from '@/types';

// ============ QUERY HOOKS ============

/**
 * Hook to fetch all lead sources
 * Waits for auth/tenant to be ready before fetching to ensure RLS works correctly
 */
export const useLeadSources = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.leadSources.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await leadSourcesService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

// ============ MUTATION HOOKS ============

interface CreateLeadSourceParams {
  name: string;
  active?: boolean;
}

/**
 * Hook to create a new lead source
 * Requires organizationId (tenant) for RLS compliance
 */
export const useCreateLeadSource = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (input: CreateLeadSourceParams) => {
      const { data, error } = await leadSourcesService.create({
        ...input,
        organizationId,
      });
      if (error) throw error;
      return data!;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.leadSources.all });
      const listKey = [...queryKeys.leadSources.lists(), organizationId];
      const previous = queryClient.getQueryData<LeadSource[]>(listKey);

      const temp: LeadSource = {
        id: `temp-${Date.now()}`,
        organizationId: organizationId || undefined,
        name: input.name,
        active: input.active ?? true,
      };

      queryClient.setQueryData<LeadSource[]>(listKey, (old = []) => [temp, ...old]);
      return { previous, listKey, tempId: temp.id };
    },
    onSuccess: (data, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<LeadSource[]>(context.listKey, (old = []) => {
        const withoutTemp = old.filter((s) => s.id !== context.tempId);
        const exists = withoutTemp.some((s) => s.id === data.id);
        return exists ? withoutTemp : [data, ...withoutTemp];
      });
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.leadSources.all });
    },
  });
};

/**
 * Hook to update a lead source
 */
export const useUpdateLeadSource = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<{ name: string; active: boolean }> }) => {
      const { error } = await leadSourcesService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.leadSources.all });
      const listKey = [...queryKeys.leadSources.lists(), organizationId];
      const previous = queryClient.getQueryData<LeadSource[]>(listKey);
      queryClient.setQueryData<LeadSource[]>(listKey, (old = []) =>
        old.map((s) => (s.id === id ? { ...s, ...updates } : s))
      );
      return { previous, listKey };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.leadSources.all });
    },
  });
};

/**
 * Hook to delete a lead source
 */
export const useDeleteLeadSource = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await leadSourcesService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.leadSources.all });
      const listKey = [...queryKeys.leadSources.lists(), organizationId];
      const previous = queryClient.getQueryData<LeadSource[]>(listKey);
      queryClient.setQueryData<LeadSource[]>(listKey, (old = []) =>
        old.filter((s) => s.id !== id)
      );
      return { previous, listKey };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.leadSources.all });
    },
  });
};
