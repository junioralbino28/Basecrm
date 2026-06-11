/**
 * TanStack Query Hooks - Barrel Export
 *
 * All query and mutation hooks for FlowCRM entities
 * Now using Supabase as data source with Realtime support
 */

// Deals
export {
  useDeals,
  useDealsView,
  useDeal,
  useDealsByBoard,
  useCreateDeal,
  useUpdateDeal,
  useUpdateDealStatus,
  useDeleteDeal,
  useAddDealItem,
  useRemoveDealItem,
  useInvalidateDeals,
  usePrefetchDeal,
  type DealsFilters,
} from './useDealsQuery';

// Contacts
export {
  useContacts,
  useContactsPaginated,
  useContactStageCounts,
  useContact,
  useContactsByCompany,
  useLeadContacts,
  useCreateContact,
  useUpdateContact,
  useUpdateContactStage,
  useDeleteContact,
  useContactHasDeals,
  usePrefetchContact,
  type ContactsFilters,
} from './useContactsQuery';

// Companies
export {
  useCompanies,
  useCreateCompany,
  useUpdateCompany,
  useDeleteCompany,
} from './useContactsQuery';

// Activities
export {
  useActivities,
  useActivitiesByDeal,
  usePendingActivities,
  useTodayActivities,
  useCreateActivity,
  useUpdateActivity,
  useToggleActivity,
  useDeleteActivity,
  type ActivitiesFilters,
} from './useActivitiesQuery';

// Boards
export {
  useBoards,
  useBoard,
  useDefaultBoard,
  useCreateBoard,
  useUpdateBoard,
  useDeleteBoard,
  useAddBoardStage,
  useUpdateBoardStage,
  useDeleteBoardStage,
  useInvalidateBoards,
} from './useBoardsQuery';

// Unified Deal Movement
export {
  useMoveDeal,
  useMoveDealSimple,
} from './useMoveDeal';

// Professionals
export {
  useProfessionals,
  useCreateProfessional,
  useUpdateProfessional,
  useDeleteProfessional,
} from './useProfessionalsQuery';

// Lead Sources (N1 — origens editáveis)
export {
  useLeadSources,
  useCreateLeadSource,
  useUpdateLeadSource,
  useDeleteLeadSource,
} from './useLeadSourcesQuery';

// Products (catálogo de procedimentos)
export { useProducts } from './useProductsQuery';

// Appointments (read-only — cache de resiliência da agenda)
export {
  useAppointments,
  useAppointmentsByDateRange,
} from './useAppointmentsQuery';

// Atendimentos (registro clínico-financeiro)
export {
  useAtendimentos,
  useCreateAtendimento,
  useUpdateAtendimento,
  useDeleteAtendimento,
} from './useAtendimentosQuery';

// Tarefas & lembretes (N2)
export {
  useTasks,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
} from './useTasksQuery';

// Config por organização (N3 — nudge de tarefas)
export {
  useTaskNudgeInterval,
  useUpdateTaskNudgeInterval,
} from './useOrganizationSettingsQuery';

// Configs financeiras (só admin — RLS can_configure)
export {
  usePaymentMethodFees,
  useCreatePaymentMethodFee,
  useUpdatePaymentMethodFee,
  useDeletePaymentMethodFee,
} from './usePaymentMethodFeesQuery';
export {
  useCommissionRules,
  useCreateCommissionRule,
  useUpdateCommissionRule,
  useDeleteCommissionRule,
} from './useCommissionRulesQuery';
export {
  useFixedCosts,
  useCreateFixedCost,
  useUpdateFixedCost,
  useDeleteFixedCost,
} from './useFixedCostsQuery';

// Relatórios financeiros (F8 — read-only, RPCs blindados)
export {
  useRevenueReport,
  useCommissionReport,
  useNetResult,
} from './useFinanceReports';

// Pagamentos de comissão (F8/adendo — ação "pagar")
export { useCreateCommissionPayment } from './useCommissionPaymentsQuery';
