import { createStaticAdminClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/utils/slugify';
import type { BoardStage } from '@/types';
import { getEditionDefinition } from './editionRegistry';
import { generateProvisioningBoardDraft } from './aiPersonalization';
import type { EditionKey, TenantProvisioningInput, TenantProvisioningResult } from './types';

function normalizeSubdomain(input: string | undefined, companyName: string) {
  return slugify(input?.trim() || companyName).slice(0, 48) || 'tenant';
}

function buildBoardStages(
  stages: Array<{
    name: string;
    color: string;
    linkedLifecycleStage: string;
  }>
): BoardStage[] {
  return stages.map((stage) => ({
    id: crypto.randomUUID(),
    label: stage.name,
    color: stage.color,
    linkedLifecycleStage: stage.linkedLifecycleStage,
  }));
}

export async function runProvisioning(params: {
  operatorUserId: string;
  operatorOrganizationId: string;
  editionKey: EditionKey;
  input: TenantProvisioningInput;
}): Promise<TenantProvisioningResult> {
  const supabase = createStaticAdminClient();
  const edition = getEditionDefinition(params.editionKey);
  const now = new Date().toISOString();
  const provisioningMode = params.input.provisioningMode === 'empty' ? 'empty' : 'full';

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .insert({ name: params.input.companyName, created_at: now, updated_at: now })
    .select('id, name')
    .single();

  if (organizationError || !organization?.id) {
    throw new Error(organizationError?.message || 'Falha ao criar organization.');
  }

  const organizationId = organization.id as string;

  const rollback = async () => {
    await supabase.from('organizations').delete().eq('id', organizationId);
  };

  const { error: editionError } = await supabase.from('organization_editions').upsert({
    organization_id: organizationId,
    edition_key: edition.key,
    branding_config: {
      logoUrl: null,
      themeMode: edition.defaultBranding.themeMode,
      accentColor: edition.defaultBranding.accentColor,
      displayName: params.input.companyName,
    },
    enabled_modules: edition.enabledModules,
      metadata: {
        specialty: params.input.specialty,
        leadChannel: params.input.leadChannel,
        serviceModel: params.input.serviceModel,
        requestedSubdomain: normalizeSubdomain(params.input.subdomain, params.input.companyName),
        provisioningMode,
        agencyOrganizationId: params.operatorOrganizationId,
      },
      updated_at: now,
  });

  if (editionError) {
    await rollback();
    throw new Error(editionError.message);
  }

  const { data: provisioningRun, error: provisioningError } = await supabase
    .from('provisioning_runs')
    .insert({
      organization_id: organizationId,
      edition_key: edition.key,
      status: 'running',
      input_payload: params.input,
      created_by: params.operatorUserId,
      updated_at: now,
    })
    .select('id')
    .single();

  if (provisioningError || !provisioningRun?.id) {
    await rollback();
    throw new Error(provisioningError?.message || 'Falha ao criar provisioning run.');
  }

  const provisioningRunId = provisioningRun.id as string;

  try {
    if (provisioningMode === 'empty') {
      await supabase
        .from('provisioning_runs')
        .update({
          status: 'completed',
          result_payload: {
            emptyTenant: true,
            boardName: null,
            usedAI: false,
            fallbackUsed: false,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', provisioningRunId);

      return {
        organizationId,
        provisioningRunId,
        editionKey: edition.key,
        usedAI: false,
        fallbackUsed: false,
      };
    }

    const boardDraftResult = await generateProvisioningBoardDraft({
      operatorOrganizationId: params.operatorOrganizationId,
      input: params.input,
    });

    const boardKeyBase = slugify(`${params.input.specialty}-${params.input.companyName}`) || 'pipeline-clinica';

    const { data: board, error: boardError } = await supabase
      .from('boards')
      .insert({
        organization_id: organizationId,
        key: boardKeyBase,
        name: boardDraftResult.draft.name,
        description: boardDraftResult.draft.description || null,
        template: 'CUSTOM',
        linked_lifecycle_stage: 'LEAD',
        goal_description: boardDraftResult.draft.goal?.description || null,
        goal_kpi: boardDraftResult.draft.goal?.kpi || null,
        goal_target_value: boardDraftResult.draft.goal?.targetValue || null,
        goal_type: boardDraftResult.draft.goal?.type || null,
        agent_name: boardDraftResult.draft.agentPersona?.name || null,
        agent_role: boardDraftResult.draft.agentPersona?.role || null,
        agent_behavior: boardDraftResult.draft.agentPersona?.behavior || null,
        entry_trigger: boardDraftResult.draft.entryTrigger || null,
        automation_suggestions: boardDraftResult.draft.automationSuggestions,
        is_default: true,
        position: 0,
        created_at: now,
        updated_at: now,
      })
      .select('id, name')
      .single();

    if (boardError || !board?.id) {
      throw new Error(boardError?.message || 'Falha ao criar board inicial.');
    }

    const stages = buildBoardStages(boardDraftResult.draft.stages);
    const { error: stagesError } = await supabase.from('board_stages').insert(
      stages.map((stage, index) => ({
        organization_id: organizationId,
        board_id: board.id,
        name: stage.label,
        label: stage.label,
        color: stage.color,
        order: index,
        linked_lifecycle_stage: stage.linkedLifecycleStage || null,
      }))
    );

    if (stagesError) {
      throw new Error(stagesError.message);
    }

    await supabase
      .from('provisioning_runs')
      .update({
        status: 'completed',
        result_payload: {
          boardId: board.id,
          boardName: board.name,
          usedAI: boardDraftResult.usedAI,
          fallbackUsed: boardDraftResult.fallbackUsed,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', provisioningRunId);

    return {
      organizationId,
      provisioningRunId,
      editionKey: edition.key,
      boardId: board.id,
      boardName: board.name,
      usedAI: boardDraftResult.usedAI,
      fallbackUsed: boardDraftResult.fallbackUsed,
    };
  } catch (error) {
    await supabase
      .from('provisioning_runs')
      .update({
        status: 'failed',
        result_payload: {
          error: error instanceof Error ? error.message : 'Erro desconhecido.',
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', provisioningRunId);

    throw error;
  }
}
