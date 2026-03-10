import { generateObject } from 'ai';
import { getModel, type AIProvider } from '@/lib/ai/config';
import { BoardStructureOutputSchema, BoardStrategyOutputSchema } from '@/lib/ai/tasks/schemas';
import { getResolvedPrompt } from '@/lib/ai/prompts/server';
import { renderPromptTemplate } from '@/lib/ai/prompts/render';
import { createStaticAdminClient } from '@/lib/supabase/server';
import type { ProvisioningBoardDraft, TenantProvisioningInput } from './types';

const FALLBACK_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-orange-500',
  'bg-rose-500',
  'bg-indigo-500',
] as const;

function normalizeColor(color: string | undefined, index: number) {
  if (color && FALLBACK_COLORS.includes(color as typeof FALLBACK_COLORS[number])) return color;
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export async function generateProvisioningBoardDraft(params: {
  operatorOrganizationId: string;
  input: TenantProvisioningInput;
}): Promise<{ draft: ProvisioningBoardDraft; usedAI: boolean; fallbackUsed: boolean }> {
  const fallbackDescription = `${params.input.specialty} | ${params.input.primaryGoal} | ${params.input.serviceModel}`;
  const fallbackDraft: ProvisioningBoardDraft = {
    name: `Pipeline ${params.input.specialty}`,
    description: `Funil inicial para ${params.input.companyName}. Contexto: ${fallbackDescription}`,
    stages: [
      {
        name: 'Novo lead',
        description: 'Lead recebido e aguardando primeiro contato.',
        color: 'bg-blue-500',
        linkedLifecycleStage: 'LEAD',
      },
      {
        name: 'Em qualificacao',
        description: 'Lead em conversa para entender objetivo e interesse.',
        color: 'bg-amber-500',
        linkedLifecycleStage: 'MQL',
      },
      {
        name: 'Pronto para agendar',
        description: 'Lead demonstrou interesse real e deve ser conduzido ao agendamento.',
        color: 'bg-orange-500',
        linkedLifecycleStage: 'PROSPECT',
      },
      {
        name: 'Atendimento agendado',
        description: 'Consulta, avaliacao ou procedimento inicial agendado.',
        color: 'bg-emerald-500',
        linkedLifecycleStage: 'PROSPECT',
      },
      {
        name: 'Cliente',
        description: 'Paciente convertido e em atendimento ativo.',
        color: 'bg-indigo-500',
        linkedLifecycleStage: 'CUSTOMER',
      },
    ],
    automationSuggestions: [
      'Criar atividade automatica quando um lead ficar parado em qualificacao.',
      'Notificar a equipe quando um agendamento for confirmado.',
    ],
    goal: {
      description: 'Converter leads qualificados em agendamentos',
      kpi: 'Taxa de agendamento',
      targetValue: '25',
      type: 'percentage',
    },
    agentPersona: {
      name: 'Clara',
      role: 'Assistente de relacionamento',
      behavior: 'Organizada, cordial e focada em avancar leads para o proximo passo.',
    },
    entryTrigger: 'Leads recebidos pelo canal principal da clinica.',
  };

  const supabase = createStaticAdminClient();
  const { data: orgSettings, error: orgError } = await supabase
    .from('organization_settings')
    .select('ai_enabled, ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('organization_id', params.operatorOrganizationId)
    .single();

  const aiEnabled = typeof orgSettings?.ai_enabled === 'boolean' ? orgSettings.ai_enabled : true;
  const provider: AIProvider = (orgSettings?.ai_provider ?? 'google') as AIProvider;
  const apiKey =
    provider === 'google'
      ? orgSettings?.ai_google_key
      : provider === 'openai'
        ? orgSettings?.ai_openai_key
        : orgSettings?.ai_anthropic_key;

  if (orgError || !aiEnabled || !apiKey) {
    return { draft: fallbackDraft, usedAI: false, fallbackUsed: true };
  }

  try {
    const model = getModel(provider, apiKey, orgSettings?.ai_model || '');
    const resolvedStructurePrompt = await getResolvedPrompt(
      supabase as any,
      params.operatorOrganizationId,
      'task_boards_generate_structure'
    );

    const description = [
      `Empresa: ${params.input.companyName}`,
      `Especialidade: ${params.input.specialty}`,
      `Objetivo principal: ${params.input.primaryGoal}`,
      `Modelo de atendimento: ${params.input.serviceModel}`,
      `Canal principal de leads: ${params.input.leadChannel}`,
      params.input.notes ? `Observacoes: ${params.input.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const structurePrompt = renderPromptTemplate(resolvedStructurePrompt?.content || '', {
      description,
      lifecycleJson: JSON.stringify([
        { id: 'LEAD', name: 'Lead' },
        { id: 'MQL', name: 'MQL' },
        { id: 'PROSPECT', name: 'Oportunidade' },
        { id: 'CUSTOMER', name: 'Cliente' },
        { id: 'OTHER', name: 'Outros' },
      ]),
    });

    const structure = await generateObject({
      model,
      maxRetries: 2,
      schema: BoardStructureOutputSchema,
      prompt: structurePrompt,
    });

    const resolvedStrategyPrompt = await getResolvedPrompt(
      supabase as any,
      params.operatorOrganizationId,
      'task_boards_generate_strategy'
    );

    const strategyPrompt = renderPromptTemplate(resolvedStrategyPrompt?.content || '', {
      boardName: structure.object.boardName,
    });

    const strategy = await generateObject({
      model,
      maxRetries: 2,
      schema: BoardStrategyOutputSchema,
      prompt: strategyPrompt,
    });

    return {
      draft: {
        name: structure.object.boardName,
        description: structure.object.description,
        stages: structure.object.stages.map((stage, index) => ({
          ...stage,
          color: normalizeColor(stage.color, index),
        })),
        automationSuggestions: structure.object.automationSuggestions,
        goal: {
          ...strategy.object.goal,
          type: 'number',
        },
        agentPersona: strategy.object.agentPersona,
        entryTrigger: strategy.object.entryTrigger,
      },
      usedAI: true,
      fallbackUsed: false,
    };
  } catch {
    return { draft: fallbackDraft, usedAI: false, fallbackUsed: true };
  }
}
