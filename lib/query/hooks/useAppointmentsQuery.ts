/**
 * Hooks de leitura da agenda (cache de resiliência). Sem mutations: agendar/confirmar/cancelar
 * vão ao vivo via /api/agenda/* (server-side Clinicorp), não pelo cache local.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { appointmentsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';

export const useAppointments = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.appointments.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await appointmentsService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

export const useAppointmentsByDateRange = (fromIso: string, toIso: string) => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.appointments.list({ fromIso, toIso }), organizationId],
    queryFn: async () => {
      const { data, error } = await appointmentsService.getByDateRange(fromIso, toIso, organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId && !!fromIso && !!toIso,
    staleTime: 30 * 1000,
  });
};
