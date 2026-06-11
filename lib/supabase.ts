// Re-export client
export { supabase } from './supabase/client';

// Re-export all services
export { boardsService, boardStagesService } from './supabase/boards';
export { contactsService, companiesService } from './supabase/contacts';
export { dealsService } from './supabase/deals';
export { activitiesService } from './supabase/activities';
export { atendimentosService } from './supabase/atendimentos';
export { tasksService } from './supabase/tasks';
export { productsService } from './supabase/products';
export { professionalsService } from './supabase/professionals';
export { appointmentsService } from './supabase/appointments';
export { leadSourcesService } from './supabase/leadSources';
export { paymentMethodFeesService } from './supabase/paymentMethodFees';
export { commissionRulesService } from './supabase/commissionRules';
export { fixedCostsService } from './supabase/fixedCosts';
export { commissionPaymentsService } from './supabase/commissionPayments';
export { settingsService, lifecycleStagesService } from './supabase/settings';
export { reportsService } from './supabase/reports';
export { organizationSettingsService } from './supabase/organizationSettings';
export type { TaskNudgeInterval } from './supabase/organizationSettings';

// Re-export Realtime hooks
export { useRealtimeSync, useRealtimeSyncAll, useRealtimeSyncKanban } from './realtime';
