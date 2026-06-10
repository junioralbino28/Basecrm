/**
 * TanStack Query hooks para Taxas de Meio de Pagamento - Supabase Edition
 *
 * Config financeira (gate do Adel): RLS can_configure em SELECT e mutação —
 * clinic_staff nem lê. Features:
 * - Chamadas reais ao Supabase
 * - Optimistic updates para feedback instantâneo
 * - Invalidação automática de cache
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { paymentMethodFeesService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import type { PaymentMethodFee, PaymentType } from '@/types';

// ============ QUERY HOOKS ============

/**
 * Busca todas as taxas de pagamento do tenant. Aguarda auth/tenant prontos (RLS).
 */
export const usePaymentMethodFees = () => {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useQuery({
    queryKey: [...queryKeys.paymentMethodFees.lists(), organizationId],
    queryFn: async () => {
      const { data, error } = await paymentMethodFeesService.getAll(organizationId);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !tenantLoading && !!user && !!organizationId,
    staleTime: 30 * 1000,
  });
};

// ============ MUTATION HOOKS ============

interface CreatePaymentMethodFeeParams {
  label: string;
  paymentType: PaymentType;
  cardBrand?: string;
  installments: number;
  feePercent: number;
}

/**
 * Cria uma taxa de pagamento com optimistic insert + rollback.
 */
export const useCreatePaymentMethodFee = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (input: CreatePaymentMethodFeeParams) => {
      const { data, error } = await paymentMethodFeesService.create({
        ...input,
        organizationId,
      });
      if (error) throw error;
      return data!;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.paymentMethodFees.all });
      const listKey = [...queryKeys.paymentMethodFees.lists(), organizationId];
      const previous = queryClient.getQueryData<PaymentMethodFee[]>(listKey);

      const temp: PaymentMethodFee = {
        id: `temp-${Date.now()}`,
        organizationId: organizationId || undefined,
        label: input.label,
        paymentType: input.paymentType,
        cardBrand: input.cardBrand,
        installments: input.installments,
        feePercent: input.feePercent,
      };

      queryClient.setQueryData<PaymentMethodFee[]>(listKey, (old = []) => [temp, ...old]);
      return { previous, listKey, tempId: temp.id };
    },
    onSuccess: (data, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<PaymentMethodFee[]>(context.listKey, (old = []) => {
        const withoutTemp = old.filter((f) => f.id !== context.tempId);
        const exists = withoutTemp.some((f) => f.id === data.id);
        return exists ? withoutTemp : [data, ...withoutTemp];
      });
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.paymentMethodFees.all });
    },
  });
};

/**
 * Atualiza uma taxa de pagamento (parcial — só campos editados).
 */
export const useUpdatePaymentMethodFee = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{ label: string; paymentType: PaymentType; cardBrand?: string; installments: number; feePercent: number }>;
    }) => {
      const { error } = await paymentMethodFeesService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.paymentMethodFees.all });
      const listKey = [...queryKeys.paymentMethodFees.lists(), organizationId];
      const previous = queryClient.getQueryData<PaymentMethodFee[]>(listKey);
      queryClient.setQueryData<PaymentMethodFee[]>(listKey, (old = []) =>
        old.map((f) => (f.id === id ? { ...f, ...updates } : f))
      );
      return { previous, listKey };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.paymentMethodFees.all });
    },
  });
};

/**
 * Exclui uma taxa de pagamento com optimistic remove + rollback.
 */
export const useDeletePaymentMethodFee = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await paymentMethodFeesService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.paymentMethodFees.all });
      const listKey = [...queryKeys.paymentMethodFees.lists(), organizationId];
      const previous = queryClient.getQueryData<PaymentMethodFee[]>(listKey);
      queryClient.setQueryData<PaymentMethodFee[]>(listKey, (old = []) =>
        old.filter((f) => f.id !== id)
      );
      return { previous, listKey };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.listKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.paymentMethodFees.all });
    },
  });
};
