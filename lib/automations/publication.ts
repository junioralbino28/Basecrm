import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AUTOMATION_EDGE_OUTCOMES,
  AUTOMATION_STEP_TYPES,
  AutomationCompileError,
  compileAutomationDefinition,
  type AutomationCompileIssue,
  type AutomationEdgeOutcome,
  type AutomationStepType,
} from './compiler';

type PublishResult = {
  id: string;
  version: number;
  definition_hash: string;
  published_at: string;
};

function fail(message: string): never {
  throw new Error(`Falha ao publicar automação: ${message}`);
}

function ensureStepType(value: string): AutomationStepType {
  if ((AUTOMATION_STEP_TYPES as readonly string[]).includes(value)) {
    return value as AutomationStepType;
  }
  throw new AutomationCompileError([{
    code: 'unknown_step_type',
    message: `tipo de passo desconhecido: ${value}`,
  }]);
}

function ensureOutcome(value: string): AutomationEdgeOutcome {
  if ((AUTOMATION_EDGE_OUTCOMES as readonly string[]).includes(value)) {
    return value as AutomationEdgeOutcome;
  }
  throw new AutomationCompileError([{
    code: 'unknown_edge_outcome',
    message: `outcome desconhecido: ${value}`,
  }]);
}

async function validateDestinationReferences(
  db: SupabaseClient,
  organizationId: string,
  steps: Array<{ step_type: string; step_key: string; config: Record<string, unknown> }>,
) {
  const destinations = steps.flatMap((step) => {
    if (step.step_type !== 'move_stage' && step.step_type !== 'move_pipeline') return [];
    return [{
      stepKey: step.step_key,
      boardId: String(step.config.board_id ?? ''),
      stageId: String(step.config.stage_id ?? ''),
    }];
  });
  if (!destinations.length) return;

  const boardIds = [...new Set(destinations.map((item) => item.boardId))];
  const stageIds = [...new Set(destinations.map((item) => item.stageId))];
  const [boards, stages] = await Promise.all([
    db
      .from('boards')
      .select('id')
      .eq('organization_id', organizationId)
      .in('id', boardIds),
    db
      .from('board_stages')
      .select('id, board_id')
      .eq('organization_id', organizationId)
      .in('id', stageIds),
  ]);
  if (boards.error) fail(boards.error.message);
  if (stages.error) fail(stages.error.message);

  const knownBoards = new Set((boards.data ?? []).map((row) => row.id));
  const knownStages = new Map(
    (stages.data ?? []).map((row) => [row.id, row.board_id])
  );
  const issues: AutomationCompileIssue[] = [];
  for (const destination of destinations) {
    if (
      !knownBoards.has(destination.boardId)
      || knownStages.get(destination.stageId) !== destination.boardId
    ) {
      issues.push({
        code: 'destination_not_found',
        message: 'destino de board/stage não existe no tenant',
        stepKey: destination.stepKey,
      });
    }
  }
  if (issues.length) throw new AutomationCompileError(issues);
}

export async function publishAutomationDraft(params: {
  db: SupabaseClient;
  automationId: string;
  actorId: string;
}): Promise<{
  version: PublishResult;
  definitionHash: string;
}> {
  const automationResult = await params.db
    .from('automations')
    .select(
      'id, organization_id, name, delivery_mode, trigger_type, trigger_config, draft_revision'
    )
    .eq('id', params.automationId)
    .single();
  if (automationResult.error || !automationResult.data) {
    fail(automationResult.error?.message ?? 'automação não encontrada');
  }
  const automation = automationResult.data;

  const [stepsResult, edgesResult, settingsResult] = await Promise.all([
    params.db
      .from('automation_steps')
      .select('id, step_key, step_type, config, sort_key')
      .eq('automation_id', automation.id)
      .eq('organization_id', automation.organization_id),
    params.db
      .from('automation_step_edges')
      .select('from_step_id, outcome, to_step_id, order')
      .eq('automation_id', automation.id)
      .eq('organization_id', automation.organization_id),
    params.db
      .from('organization_settings')
      .select(
        'automation_timezone, automation_quiet_hours_start, automation_quiet_hours_end, automation_day_delay_semantics'
      )
      .eq('organization_id', automation.organization_id)
      .single(),
  ]);
  if (stepsResult.error) fail(stepsResult.error.message);
  if (edgesResult.error) fail(edgesResult.error.message);
  if (settingsResult.error || !settingsResult.data) {
    fail(settingsResult.error?.message ?? 'agenda da organização ausente');
  }

  const rawSteps = (stepsResult.data ?? []) as Array<{
    id: string;
    step_key: string;
    step_type: string;
    config: Record<string, unknown>;
    sort_key: number;
  }>;
  await validateDestinationReferences(
    params.db,
    automation.organization_id,
    rawSteps,
  );

  const templateIds = [...new Set(rawSteps.flatMap((step) => {
    if (
      step.step_type !== 'send_message'
      || step.config.link_mode !== 'linked'
      || typeof step.config.template_id !== 'string'
    ) {
      return [];
    }
    return [step.config.template_id];
  }))];
  const templatesResult = templateIds.length
    ? await params.db
      .from('message_templates')
      .select('id, organization_id, revision, channel, body, media_asset_variant_id')
      .eq('organization_id', automation.organization_id)
      .in('id', templateIds)
    : { data: [], error: null };
  if (templatesResult.error) fail(templatesResult.error.message);

  const compiled = compileAutomationDefinition({
    automation: {
      id: automation.id,
      organizationId: automation.organization_id,
      name: automation.name,
      deliveryMode: automation.delivery_mode,
      triggerType: automation.trigger_type,
      triggerConfig: automation.trigger_config,
      draftRevision: Number(automation.draft_revision),
    },
    schedule: {
      timezone: settingsResult.data.automation_timezone,
      quietHoursStart: settingsResult.data.automation_quiet_hours_start,
      quietHoursEnd: settingsResult.data.automation_quiet_hours_end,
      dayDelaySemantics: settingsResult.data.automation_day_delay_semantics,
    },
    steps: rawSteps.map((step) => ({
      id: step.id,
      stepKey: step.step_key,
      stepType: ensureStepType(step.step_type),
      config: step.config,
      sortKey: step.sort_key,
    })),
    edges: (edgesResult.data ?? []).map((edge) => ({
      fromStepId: edge.from_step_id,
      outcome: ensureOutcome(edge.outcome),
      toStepId: edge.to_step_id,
      order: edge.order,
    })),
    templates: (templatesResult.data ?? []).map((template) => ({
      id: template.id,
      organizationId: template.organization_id,
      revision: template.revision,
      channel: template.channel,
      body: template.body,
      mediaAssetVariantId: template.media_asset_variant_id,
    })),
  });

  const published = await params.db
    .rpc('publish_automation_version', {
      p_automation_id: automation.id,
      p_expected_draft_revision: automation.draft_revision,
      p_definition_canonical: compiled.canonicalJson,
      p_definition_hash: compiled.definitionHash,
      p_created_by: params.actorId,
    })
    .single();
  if (published.error || !published.data) {
    fail(published.error?.message ?? 'RPC não retornou a versão');
  }

  return {
    version: published.data as PublishResult,
    definitionHash: compiled.definitionHash,
  };
}
