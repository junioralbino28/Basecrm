/**
 * TanStack Query hooks for Professionals - Supabase Edition
 *
 * Features:
 * - Real Supabase API calls
 * - Optimistic updates for instant UI feedback
 * - Automatic cache invalidation
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { professionalsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import type { Professional } from '@/types';

// ============ QUERY HOOKS ============

/**
 * Hook to fetch all professionals
 * Waits for auth/tenant to be ready before fetching to ensure RLS works correctly
 */
export const useProfessionals = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.professionals.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await professionalsService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

// ============ MUTATION HOOKS ============

interface CreateProfessionalParams {
  name: string;
  specialty?: string;
  active?: boolean;
}

/**
 * Hook to create a new professional
 * Requires organizationId (tenant) for RLS compliance
 */
export const useCreateProfessional = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (input: CreateProfessionalParams) => {
      const { data, error } = await professionalsService.create({
        ...input,
        organizationId,
      });
      if (error) throw error;
      return data!;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.professionals.all });
      const listKey = [...queryKeys.professionals.lists(), organizationId];
      const previous = queryClient.getQueryData<Professional[]>(listKey);

      const temp: Professional = {
        id: `temp-${Date.now()}`,
        organizationId: organizationId || undefined,
        name: input.name,
        specialty: input.specialty,
        active: input.active ?? true,
      };

      queryClient.setQueryData<Professional[]>(listKey, (old = []) => [temp, ...old]);
      return { previous, listKey, tempId: temp.id };
    },
    onSuccess: (data, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<Professional[]>(context.listKey, (old = []) => {
        const withoutTemp = old.filter((p) => p.id !== context.tempId);
        const exists = withoutTemp.some((p) => p.id === data.id);
        return exists ? withoutTemp : [data, ...withoutTemp];
      });
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.professionals.all });
    },
  });
};

/**
 * Hook to update a professional
 */
export const useUpdateProfessional = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<{ name: string; specialty?: string; active: boolean }> }) => {
      const { error } = await professionalsService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.professionals.all });
      const listKey = [...queryKeys.professionals.lists(), organizationId];
      const previous = queryClient.getQueryData<Professional[]>(listKey);
      queryClient.setQueryData<Professional[]>(listKey, (old = []) =>
        old.map((p) => (p.id === id ? { ...p, ...updates } : p))
      );
      return { previous, listKey };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.professionals.all });
    },
  });
};

/**
 * Hook to delete a professional
 */
export const useDeleteProfessional = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await professionalsService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.professionals.all });
      const listKey = [...queryKeys.professionals.lists(), organizationId];
      const previous = queryClient.getQueryData<Professional[]>(listKey);
      queryClient.setQueryData<Professional[]>(listKey, (old = []) =>
        old.filter((p) => p.id !== id)
      );
      return { previous, listKey };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.professionals.all });
    },
  });
};
