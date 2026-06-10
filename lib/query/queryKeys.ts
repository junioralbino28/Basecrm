import { createQueryKeys, createExtendedQueryKeys } from './createQueryKeys';
import { PaginationState, ContactsServerFilters } from '@/types';

/**
 * Query keys centralizadas para gerenciamento de cache.
 * 
 * Usar estas keys garante consistência na invalidação e prefetch.
 * Pattern: `queryKeys.entity.action(params)`
 * 
 * @example
 * ```typescript
 * // Invalidar todos os deals
 * queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
 * 
 * // Invalidar deals de um board específico
 * queryClient.invalidateQueries({ 
 *   queryKey: queryKeys.deals.list({ boardId: 'xxx' }) 
 * });
 * ```
 */
export const queryKeys = {
    // Standard entity keys (using factory)
    deals: createQueryKeys('deals'),

    // Contacts with custom extension for paginated queries and stage counts
    contacts: createExtendedQueryKeys('contacts', base => ({
        paginated: (pagination: PaginationState, filters?: ContactsServerFilters) =>
            [...base.all, 'paginated', pagination, filters] as const,
        stageCounts: () => [...base.all, 'stageCounts'] as const,
    })),

    companies: createQueryKeys('companies'),
    boards: createQueryKeys('boards'),
    professionals: createQueryKeys('professionals'),
    leadSources: createQueryKeys('leadSources'),
    conversations: createExtendedQueryKeys('conversations', base => ({
        messages: (threadId: string) => [...base.detail(threadId), 'messages'] as const,
    })),

    // Activities with custom extension for byDeal
    activities: createExtendedQueryKeys('activities', base => ({
        byDeal: (dealId: string) => [...base.all, 'deal', dealId] as const,
    })),

    atendimentos: createQueryKeys('atendimentos'),

    // Tarefas & lembretes (N2)
    tasks: createQueryKeys('tasks'),

    // Config por organização (N3 — nudge; select access, mutate can_configure)
    organizationSettings: createQueryKeys('organizationSettings'),

    // Configs financeiras (só admin — RLS can_configure)
    paymentMethodFees: createQueryKeys('paymentMethodFees'),
    commissionRules: createQueryKeys('commissionRules'),
    fixedCosts: createQueryKeys('fixedCosts'),

    // Pagamentos de comissão (ação "pagar" — F8/adendo)
    commissionPayments: createQueryKeys('commissionPayments'),

    // Dashboard (non-standard structure)
    dashboard: {
        stats: ['dashboard', 'stats'] as const,
        funnel: ['dashboard', 'funnel'] as const,
        timeline: ['dashboard', 'timeline'] as const,
        // Relatórios financeiros (F8) — roots p/ invalidação por prefixo
        revenueRoot: ['dashboard', 'revenue'] as const,
        revenue: (start: string, end: string) =>
            ['dashboard', 'revenue', start, end] as const,
        commissionRoot: ['dashboard', 'commission'] as const,
        commission: (start: string, end: string) =>
            ['dashboard', 'commission', start, end] as const,
        netResultRoot: ['dashboard', 'netResult'] as const,
        netResult: (start: string, end: string) =>
            ['dashboard', 'netResult', start, end] as const,
    },
};

export function getDealsViewQueryKey(organizationId?: string | null) {
    return organizationId
        ? ([...queryKeys.deals.lists(), 'view', organizationId] as const)
        : DEALS_VIEW_KEY;
}

/**
 * Constante para a query key da view de deals (DealView[]).
 * Esta é a ÚNICA fonte de verdade para deals no Kanban e outras UIs.
 * Todos os pontos de escrita (mutations, Realtime, otimismo) devem usar esta key.
 * 
 * @example
 * ```typescript
 * // Leitura
 * const { data } = useQuery({ queryKey: DEALS_VIEW_KEY, ... });
 * 
 * // Escrita
 * queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, ...);
 * ```
 */
export const DEALS_VIEW_KEY = [...queryKeys.deals.lists(), 'view'] as const;
