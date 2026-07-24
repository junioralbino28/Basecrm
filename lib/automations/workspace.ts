import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AutomationBuilderDraft,
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from './builder';

export type AutomationWorkspaceItem = AutomationBuilderDraft & {
  id: string;
  lifecycleStatus: 'draft' | 'published' | 'paused' | 'archived';
  deliveryMode: 'simulation' | 'test' | 'live';
  draftRevision: number;
  publishedVersionId: string | null;
  updatedAt: string;
};

export async function loadAutomationWorkspace(
  db: SupabaseClient,
  organizationId: string,
) {
  const [automations, steps, edges, templates, targets, settings, boards, boardStages] = await Promise.all([
    db
      .from('automations')
      .select(
        'id, name, lifecycle_status, delivery_mode, trigger_config, draft_revision, published_version_id, updated_at',
      )
      .eq('organization_id', organizationId)
      .neq('lifecycle_status', 'archived')
      .order('updated_at', { ascending: false }),
    db
      .from('automation_steps')
      .select('id, automation_id, step_key, step_type, config, sort_key')
      .eq('organization_id', organizationId)
      .order('sort_key', { ascending: true }),
    db
      .from('automation_step_edges')
      .select('automation_id, from_step_id, outcome, to_step_id, order')
      .eq('organization_id', organizationId)
      .order('order', { ascending: true }),
    db
      .from('message_templates')
      .select('id, name, channel, body, revision, updated_at')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false }),
    db
      .from('conversation_threads')
      .select(
        'id, title, contact_name, contact_phone, deal_id, contact_id, channel_connection_id',
      )
      .eq('organization_id', organizationId)
      .not('deal_id', 'is', null)
      .not('contact_id', 'is', null)
      .not('channel_connection_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(50),
    db
      .from('organization_settings')
      .select('automation_live_enabled')
      .eq('organization_id', organizationId)
      .single(),
    // Pro "Dividir caminho": comparar funil/etapa exige UUID — a UI mostra
    // nomes e envia o id, em vez de deixar o usuário digitar texto livre.
    db
      .from('boards')
      .select('id, name')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true }),
    db
      .from('board_stages')
      .select('id, board_id, name, label')
      .eq('organization_id', organizationId)
      .order('order', { ascending: true }),
  ]);

  for (const result of [automations, steps, edges, templates, targets, settings, boards, boardStages]) {
    if (result.error) throw new Error(result.error.message);
  }

  const stepKeyById = new Map(
    (steps.data ?? []).map((step) => [step.id, step.step_key]),
  );
  const items: AutomationWorkspaceItem[] = (automations.data ?? []).map((automation) => ({
    id: automation.id,
    name: automation.name,
    lifecycleStatus: automation.lifecycle_status,
    deliveryMode: automation.delivery_mode,
    triggerConfig: automation.trigger_config as Record<string, unknown>,
    draftRevision: Number(automation.draft_revision),
    publishedVersionId: automation.published_version_id,
    updatedAt: automation.updated_at,
    steps: (steps.data ?? [])
      .filter((step) => step.automation_id === automation.id)
      .map((step) => ({
        stepKey: step.step_key,
        stepType: step.step_type,
        config: step.config as Record<string, unknown>,
        sortKey: step.sort_key,
      })) as AutomationBuilderStep[],
    edges: (edges.data ?? [])
      .filter((edge) => edge.automation_id === automation.id)
      .flatMap((edge) => {
        const fromStepKey = stepKeyById.get(edge.from_step_id);
        const toStepKey = stepKeyById.get(edge.to_step_id);
        if (!fromStepKey || !toStepKey) return [];
        return [{
          fromStepKey,
          outcome: edge.outcome,
          toStepKey,
          order: edge.order,
        }];
      }) as AutomationBuilderEdge[],
  }));

  return {
    automations: items,
    templates: (templates.data ?? []).map((template) => ({
      id: template.id,
      name: template.name,
      channel: template.channel,
      body: template.body,
      revision: template.revision,
      updatedAt: template.updated_at,
    })),
    testTargets: (targets.data ?? []).map((target) => ({
      threadId: target.id,
      label: target.contact_name || target.title || target.contact_phone || 'Conversa sem nome',
      detail: target.contact_phone || target.title || '',
    })),
    boards: (boards.data ?? []).map((board) => ({
      id: board.id as string,
      name: board.name as string,
      stages: (boardStages.data ?? [])
        .filter((stage) => stage.board_id === board.id)
        .map((stage) => ({
          id: stage.id as string,
          label: (stage.label || stage.name || 'Etapa') as string,
        })),
    })),
    safeMode: {
      liveEnabled: settings.data?.automation_live_enabled === true,
    },
  };
}
