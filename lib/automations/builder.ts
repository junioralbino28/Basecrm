import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AutomationEdgeOutcome,
  AutomationStepType,
} from './compiler';
import { dispatchAutomationSimulation } from '@/lib/conversations/dispatchConversationOutbound';

export type AutomationBuilderStep = {
  stepKey: string;
  stepType: AutomationStepType;
  config: Record<string, unknown>;
  sortKey: number;
};

export type AutomationBuilderEdge = {
  fromStepKey: string;
  outcome: AutomationEdgeOutcome;
  toStepKey: string;
  order: number;
};

export type AutomationBuilderDraft = {
  id: string | null;
  draftRevision?: number;
  name: string;
  triggerConfig: Record<string, unknown>;
  steps: AutomationBuilderStep[];
  edges: AutomationBuilderEdge[];
};

export async function saveAutomationDraft(params: {
  db: SupabaseClient;
  organizationId: string;
  actorId: string;
  draft: AutomationBuilderDraft;
}): Promise<{
  automationId: string;
  draftRevision: number;
  deliveryMode: 'simulation';
}> {
  const saved = await params.db.rpc('save_automation_draft', {
    p_organization_id: params.organizationId,
    p_automation_id: params.draft.id,
    p_expected_draft_revision: params.draft.draftRevision ?? null,
    p_name: params.draft.name,
    p_trigger_config: params.draft.triggerConfig,
    p_steps: params.draft.steps,
    p_edges: params.draft.edges,
    p_actor_id: params.actorId,
  });
  if (saved.error || !saved.data) {
    throw new Error(saved.error?.message ?? 'Draft não foi salvo.');
  }

  const result = saved.data as {
    automationId?: string;
    draftRevision?: number;
    deliveryMode?: string;
  };
  if (!result.automationId || result.deliveryMode !== 'simulation') {
    throw new Error('Draft salvo sem confirmação do modo seguro.');
  }
  return {
    automationId: result.automationId,
    draftRevision: Number(result.draftRevision),
    deliveryMode: 'simulation',
  };
}

export async function runAutomationSimulationTest(params: {
  db: SupabaseClient;
  organizationId: string;
  automationId: string;
  threadId: string;
}): Promise<{
  enrollmentId: string;
  jobId: string;
  messageId: string;
  threadId: string;
  deliveryStatus: 'simulated';
}> {
  const [automation, settings, thread] = await Promise.all([
    params.db
      .from('automations')
      .select('id, organization_id, lifecycle_status, delivery_mode')
      .eq('id', params.automationId)
      .eq('organization_id', params.organizationId)
      .single(),
    params.db
      .from('organization_settings')
      .select('automation_live_enabled')
      .eq('organization_id', params.organizationId)
      .single(),
    params.db
      .from('conversation_threads')
      .select('id, organization_id, deal_id, contact_id, channel_connection_id')
      .eq('id', params.threadId)
      .eq('organization_id', params.organizationId)
      .single(),
  ]);
  if (automation.error || !automation.data) {
    throw new Error(automation.error?.message ?? 'Automação não encontrada.');
  }
  if (
    automation.data.lifecycle_status !== 'published'
    || automation.data.delivery_mode !== 'simulation'
  ) {
    throw new Error('O teste exige automação publicada em modo simulação.');
  }
  if (settings.error || !settings.data) {
    throw new Error(settings.error?.message ?? 'Safe mode não pôde ser verificado.');
  }
  if (settings.data.automation_live_enabled !== false) {
    throw new Error('Teste bloqueado: envio real está habilitado.');
  }
  if (
    thread.error
    || !thread.data?.deal_id
    || !thread.data.contact_id
    || !thread.data.channel_connection_id
  ) {
    throw new Error(
      thread.error?.message
      ?? 'Conversa de teste precisa de oportunidade, contato e canal.',
    );
  }

  const enrollment = await params.db.rpc('create_automation_enrollment', {
    p_automation_id: params.automationId,
    p_deal_id: thread.data.deal_id,
    p_contact_id: thread.data.contact_id,
    p_thread_id: thread.data.id,
    p_channel_connection_id: thread.data.channel_connection_id,
  });
  if (enrollment.error || !enrollment.data?.id) {
    throw new Error(enrollment.error?.message ?? 'Inscrição de teste não foi criada.');
  }

  const materialized = await params.db.rpc('materialize_automation_jobs', {
    p_batch_limit: 50,
  });
  if (materialized.error) throw new Error(materialized.error.message);

  const job = await params.db
    .from('automation_jobs')
    .select('id')
    .eq('enrollment_id', enrollment.data.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();
  if (job.error || !job.data) {
    throw new Error(job.error?.message ?? 'Primeiro job de teste não foi criado.');
  }

  const dispatched = await dispatchAutomationSimulation({
    db: params.db,
    jobId: job.data.id,
  });
  if (dispatched.status !== 'simulated') {
    throw new Error('A execução de teste saiu do modo simulação.');
  }

  return {
    enrollmentId: enrollment.data.id,
    jobId: job.data.id,
    messageId: dispatched.messageId,
    threadId: thread.data.id,
    deliveryStatus: 'simulated',
  };
}
