/**
 * TanStack Query hooks para config por organização (N3 — nudge de tarefas).
 *
 * Espelho dos hooks de config financeira: leitura aguarda auth/tenant prontos
 * (RLS); a mutação invalida o cache. SELECT é liberado pro tenant inteiro
 * (a recepção precisa LER o intervalo pro pop-up); a mutação só passa pra quem
 * pode configurar a org (RLS can_configure) — a UI esconde, o banco barra.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { organizationSettingsService, type TaskNudgeInterval } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';

// ============ QUERY HOOKS ============

/**
 * Lê o intervalo do nudge de tarefas (null = desligado).
 */
export const useTaskNudgeInterval = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery<TaskNudgeInterval>({
    queryKey: [...queryKeys.organizationSettings.lists(), 'taskNudgeInterval', organizationId],
    queryFn: async () => {
      const { data, error } = await organizationSettingsService.getTaskNudgeInterval(organizationId);
      if (error) throw error;
      return data;
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 60 * 1000,
  });
};

// ============ MUTATION HOOKS ============

/**
 * Atualiza o intervalo do nudge (null desliga). Caller liga toast onError
 * (regra do provisionamento: toast em TODA mutation).
 */
export const useUpdateTaskNudgeInterval = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (minutes: TaskNudgeInterval) => {
      const { error } = await organizationSettingsService.updateTaskNudgeInterval(
        organizationId,
        minutes
      );
      if (error) throw error;
      return minutes;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizationSettings.all });
    },
  });
};
