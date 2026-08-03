/**
 * TanStack Query hooks para pagamentos de comissão (F8/adendo — "Paga/A pagar").
 *
 * A ação "pagar" da tela Profissionais registra um commission_payment do
 * período; a RLS (can_configure_organization) garante que só admin muta.
 * Invalida o relatório de comissão (dashboard.commissionRoot) pra recalcular
 * "Paga"/"A pagar" na hora.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { commissionPaymentsService } from '@/lib/supabase';
import { useTenant } from '@/context/TenantContext';

interface CreateCommissionPaymentParams {
  professionalId: string;
  amount: number;
  /** Período de competência 'YYYY-MM' (CHECK no banco). */
  period: string;
  /** Quando o dinheiro saiu. Omitido = agora (DEFAULT do banco). */
  paidAt?: string;
}

/**
 * Registra um pagamento de comissão (paid_at = now() pelo DEFAULT do banco).
 */
export const useCreateCommissionPayment = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (params: CreateCommissionPaymentParams) => {
      const { data, error } = await commissionPaymentsService.create({
        professionalId: params.professionalId,
        amount: params.amount,
        period: params.period,
        paidAt: params.paidAt,
        organizationId,
      });
      if (error) throw error;
      return data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commissionPayments.all });
      // "Paga"/"A pagar" derivam do relatório de comissão — recalcular.
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.commissionRoot });
    },
  });
};

/**
 * Pagamentos de um mês — o desfazer precisa saber qual foi o último de cada
 * pessoa. `period` vazio desliga a busca (range multi-mês não paga nem desfaz).
 */
export const useCommissionPaymentsByPeriod = (period: string) => {
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.commissionPayments.lists(), organizationId, period],
    enabled: Boolean(period),
    queryFn: async () => {
      if (!organizationId) throw new Error('Organização ativa não definida.');
      const { data, error } = await commissionPaymentsService.listByPeriod(period, organizationId);
      if (error) throw error;
      return data;
    },
    staleTime: 30 * 1000,
  });
};

/** Apaga um pagamento lançado por engano (o "desfazer" da tela). */
export const useDeleteCommissionPayment = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error('Organização ativa não definida.');
      const { error } = await commissionPaymentsService.delete(id, organizationId);
      if (error) throw error;
      return id;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commissionPayments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.commissionRoot });
    },
  });
};

/** Corrige a data de um pagamento já lançado (só `paid_at`, nunca a competência). */
export const useUpdateCommissionPaymentDate = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({ id, paidAt }: { id: string; paidAt: string }) => {
      if (!organizationId) throw new Error('Organização ativa não definida.');
      const { error } = await commissionPaymentsService.updatePaidAt(id, paidAt, organizationId);
      if (error) throw error;
      return id;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commissionPayments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.commissionRoot });
    },
  });
};
