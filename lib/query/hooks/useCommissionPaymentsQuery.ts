/**
 * TanStack Query hooks para pagamentos de comissão (F8/adendo — "Paga/A pagar").
 *
 * A ação "pagar" da tela Profissionais registra um commission_payment do
 * período; a RLS (can_configure_organization) garante que só admin muta.
 * Invalida o relatório de comissão (dashboard.commissionRoot) pra recalcular
 * "Paga"/"A pagar" na hora.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { commissionPaymentsService } from '@/lib/supabase';
import { useTenant } from '@/context/TenantContext';

interface CreateCommissionPaymentParams {
  professionalId: string;
  amount: number;
  /** Período de competência 'YYYY-MM' (CHECK no banco). */
  period: string;
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
