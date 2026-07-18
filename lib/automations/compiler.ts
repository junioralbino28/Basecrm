import { createHash } from 'node:crypto';
import { z } from 'zod';

export const AUTOMATION_STEP_TYPES = [
  'send_message',
  'delay',
  'wait_for_event',
  'create_task',
  'move_stage',
  'move_pipeline',
  'condition',
] as const;

export const AUTOMATION_EDGE_OUTCOMES = [
  'success',
  'answered',
  'timeout',
  'failed',
  'true',
  'false',
  'otherwise',
] as const;

export type AutomationStepType = (typeof AUTOMATION_STEP_TYPES)[number];
export type AutomationEdgeOutcome = (typeof AUTOMATION_EDGE_OUTCOMES)[number];

export type AutomationDraftStep = {
  id: string;
  stepKey: string;
  stepType: AutomationStepType;
  config: Record<string, unknown>;
  sortKey: number;
};

export type AutomationDraftEdge = {
  fromStepId: string;
  outcome: AutomationEdgeOutcome;
  toStepId: string;
  order: number;
};

export type AutomationTemplateSnapshotSource = {
  id: string;
  organizationId: string;
  revision: number;
  channel: 'whatsapp';
  body: string;
  mediaAssetVariantId: string | null;
};

export type AutomationCompileInput = {
  automation: {
    id: string;
    organizationId: string;
    name: string;
    deliveryMode: 'simulation' | 'test' | 'live';
    triggerType: 'tag_added';
    triggerConfig: Record<string, unknown>;
    draftRevision: number;
  };
  schedule: {
    timezone: string;
    quietHoursStart: string;
    quietHoursEnd: string;
    dayDelaySemantics: 'next_local_day';
  };
  steps: AutomationDraftStep[];
  edges: AutomationDraftEdge[];
  templates: AutomationTemplateSnapshotSource[];
};

export type AutomationCompileIssue = {
  code: string;
  message: string;
  stepKey?: string;
};

export class AutomationCompileError extends Error {
  readonly issues: AutomationCompileIssue[];

  constructor(issues: AutomationCompileIssue[]) {
    super(issues.map((issue) => issue.message).join('; '));
    this.name = 'AutomationCompileError';
    this.issues = issues;
  }
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type CompiledStep = {
  stepKey: string;
  type: AutomationStepType;
  uiOrder: number;
  config: Record<string, JsonValue>;
};

type CompiledEdge = {
  fromStepKey: string;
  outcome: AutomationEdgeOutcome;
  toStepKey: string;
  order: number;
};

export type CompiledAutomationDefinition = {
  schemaVersion: 1;
  automationId: string;
  organizationId: string;
  name: string;
  deliveryMode: 'simulation' | 'test' | 'live';
  trigger: {
    type: 'tag_added';
    config: Record<string, JsonValue>;
  };
  schedule: {
    timezone: string;
    quietHoursStart: string;
    quietHoursEnd: string;
    dayDelaySemantics: 'next_local_day';
  };
  entryStepKey: string;
  steps: CompiledStep[];
  edges: CompiledEdge[];
};

const UUID_SCHEMA = z.string().uuid();
const TIME_SCHEMA = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const MESSAGE_KINDS = ['text', 'image', 'video', 'audio', 'link'] as const;

const SendMessageConfigSchema = z.object({
  link_mode: z.enum(['copied', 'linked']).default('copied'),
  template_id: UUID_SCHEMA.optional(),
  body_local: z.string().optional(),
  message_kind: z.enum(MESSAGE_KINDS).default('text'),
  channel: z.literal('whatsapp').default('whatsapp'),
  media_asset_variant_id: UUID_SCHEMA.nullish(),
}).strict();

const DelayConfigSchema = z.object({
  amount: z.number().int().min(1).max(365),
  unit: z.enum(['minutes', 'hours', 'days']),
}).strict();

const WaitForEventConfigSchema = z.object({
  timeout_amount: z.number().int().min(1).max(365),
  timeout_unit: z.enum(['minutes', 'hours', 'days']),
}).strict();

const CreateTaskConfigSchema = z.object({
  title: z.string().trim().min(1).max(240),
  due_in_minutes: z.number().int().min(0).max(525_600).optional(),
}).strict();

const MoveConfigSchema = z.object({
  board_id: UUID_SCHEMA,
  stage_id: UUID_SCHEMA,
}).strict();

const ConditionConfigSchema = z.object({
  field: z.enum([
    'contact.tags',
    'contact.phone',
    'deal.stage_id',
    'deal.board_id',
  ]),
  operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'exists']),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
}).strict();

const KNOWN_VARIABLES = new Set([
  'contato.nome',
  'contato.primeiro_nome',
  'contato.telefone',
  'negocio.titulo',
  'negocio.valor',
  'responsavel.nome',
  'organizacao.nome',
]);

const ALLOWED_OUTCOMES: Record<AutomationStepType, ReadonlySet<AutomationEdgeOutcome>> = {
  send_message: new Set(['success', 'failed']),
  delay: new Set(['success', 'failed']),
  wait_for_event: new Set(['answered', 'timeout', 'failed']),
  create_task: new Set(['success', 'failed']),
  move_stage: new Set(['success', 'failed']),
  move_pipeline: new Set(['success', 'failed']),
  condition: new Set(['true', 'false', 'otherwise']),
};

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function assertJsonObject(
  value: Record<string, unknown>,
  label: string,
): Record<string, JsonValue> {
  if (!isJsonValue(value)) {
    throw new AutomationCompileError([{
      code: 'invalid_json',
      message: `${label} precisa conter apenas JSON serializável`,
    }]);
  }
  return value as Record<string, JsonValue>;
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

function validateTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function extractVariables(body: string, stepKey: string): string[] {
  const variables = new Set<string>();
  const tokenPattern =
    /\{\{\s*([a-z][a-z0-9_.]*)\s*\|\s*default:\s*"((?:[^"\\]|\\.)*)"\s*\}\}/g;

  const unmatched = body.replace(tokenPattern, (_match, token: string, fallback: string) => {
    if (!KNOWN_VARIABLES.has(token)) {
      throw new AutomationCompileError([{
        code: 'unknown_variable',
        message: `variável desconhecida: ${token}`,
        stepKey,
      }]);
    }
    if (fallback.length === 0) {
      throw new AutomationCompileError([{
        code: 'missing_variable_fallback',
        message: `fallback obrigatório para ${token}`,
        stepKey,
      }]);
    }
    variables.add(token);
    return '';
  });

  if (unmatched.includes('{{') || unmatched.includes('}}')) {
    throw new AutomationCompileError([{
      code: 'invalid_variable_syntax',
      message: 'fallback obrigatório em toda variável',
      stepKey,
    }]);
  }

  return [...variables].sort();
}

function zodIssue(
  step: AutomationDraftStep,
  error: z.ZodError,
): AutomationCompileError {
  return new AutomationCompileError([{
    code: 'invalid_step_config',
    message: `config inválida em ${step.stepType}: ${error.issues
      .map((issue) => `${issue.path.join('.') || 'config'} ${issue.message}`)
      .join(', ')}`,
    stepKey: step.stepKey,
  }]);
}

function compileSendMessage(
  step: AutomationDraftStep,
  templates: Map<string, AutomationTemplateSnapshotSource>,
  organizationId: string,
): Record<string, JsonValue> {
  const parsed = SendMessageConfigSchema.safeParse(step.config);
  if (!parsed.success) throw zodIssue(step, parsed.error);
  const config = parsed.data;

  const template = config.template_id ? templates.get(config.template_id) : undefined;
  if (config.link_mode === 'linked' && !template) {
    throw new AutomationCompileError([{
      code: 'template_not_found',
      message: `template linked não encontrado: ${config.template_id ?? 'ausente'}`,
      stepKey: step.stepKey,
    }]);
  }
  if (template && template.organizationId !== organizationId) {
    throw new AutomationCompileError([{
      code: 'cross_tenant_template',
      message: 'template linked pertence a outro tenant',
      stepKey: step.stepKey,
    }]);
  }

  const body = config.link_mode === 'linked'
    ? template?.body ?? ''
    : config.body_local ?? '';
  const mediaAssetVariantId = config.media_asset_variant_id
    ?? (config.link_mode === 'linked' ? template?.mediaAssetVariantId : null)
    ?? null;

  if (config.message_kind === 'audio') {
    if (body.trim()) {
      throw new AutomationCompileError([{
        code: 'audio_with_caption',
        message: 'passo de áudio não aceita texto ou legenda',
        stepKey: step.stepKey,
      }]);
    }
    if (!mediaAssetVariantId) {
      throw new AutomationCompileError([{
        code: 'audio_without_media',
        message: 'passo de áudio exige uma variante de mídia',
        stepKey: step.stepKey,
      }]);
    }
  } else if (!body.trim()) {
    throw new AutomationCompileError([{
      code: 'empty_message',
      message: `mensagem ${config.message_kind} exige conteúdo`,
      stepKey: step.stepKey,
    }]);
  }

  if (
    ['image', 'video'].includes(config.message_kind)
    && !mediaAssetVariantId
  ) {
    throw new AutomationCompileError([{
      code: 'media_missing',
      message: `mensagem ${config.message_kind} exige uma variante de mídia`,
      stepKey: step.stepKey,
    }]);
  }

  return {
    body,
    channel: config.channel,
    linkMode: config.link_mode,
    mediaAssetVariantId,
    messageKind: config.message_kind,
    templateId: config.link_mode === 'linked' ? template?.id ?? null : null,
    templateRevision: config.link_mode === 'linked' ? template?.revision ?? null : null,
    variables: extractVariables(body, step.stepKey),
  };
}

function compileStepConfig(
  step: AutomationDraftStep,
  templates: Map<string, AutomationTemplateSnapshotSource>,
  organizationId: string,
): Record<string, JsonValue> {
  if (step.stepType === 'send_message') {
    return compileSendMessage(step, templates, organizationId);
  }

  if (step.stepType === 'delay') {
    const parsed = DelayConfigSchema.safeParse(step.config);
    if (!parsed.success) throw zodIssue(step, parsed.error);
    return {
      amount: parsed.data.amount,
      unit: parsed.data.unit,
      daySemantics: parsed.data.unit === 'days' ? 'next_local_day' : null,
    };
  }
  if (step.stepType === 'wait_for_event') {
    const parsed = WaitForEventConfigSchema.safeParse(step.config);
    if (!parsed.success) throw zodIssue(step, parsed.error);
    return {
      timeoutAmount: parsed.data.timeout_amount,
      timeoutUnit: parsed.data.timeout_unit,
      daySemantics: parsed.data.timeout_unit === 'days' ? 'next_local_day' : null,
    };
  }
  if (step.stepType === 'create_task') {
    const parsed = CreateTaskConfigSchema.safeParse(step.config);
    if (!parsed.success) throw zodIssue(step, parsed.error);
    return {
      title: parsed.data.title,
      dueInMinutes: parsed.data.due_in_minutes ?? null,
    };
  }
  if (step.stepType === 'move_stage' || step.stepType === 'move_pipeline') {
    const parsed = MoveConfigSchema.safeParse(step.config);
    if (!parsed.success) throw zodIssue(step, parsed.error);
    return {
      boardId: parsed.data.board_id,
      stageId: parsed.data.stage_id,
    };
  }
  const parsed = ConditionConfigSchema.safeParse(step.config);
  if (!parsed.success) throw zodIssue(step, parsed.error);
  return {
    field: parsed.data.field,
    operator: parsed.data.operator,
    value: parsed.data.value ?? null,
  };
}

function validateGraph(
  steps: AutomationDraftStep[],
  edges: AutomationDraftEdge[],
): {
  entryStepKey: string;
  compiledEdges: CompiledEdge[];
} {
  const issues: AutomationCompileIssue[] = [];
  if (steps.length === 0) {
    throw new AutomationCompileError([{
      code: 'empty_flow',
      message: 'fluxo precisa ter ao menos um passo',
    }]);
  }

  const byId = new Map<string, AutomationDraftStep>();
  const stepKeys = new Set<string>();
  for (const step of steps) {
    if (byId.has(step.id)) {
      issues.push({ code: 'duplicate_step_id', message: `step id duplicado: ${step.id}` });
    }
    if (stepKeys.has(step.stepKey)) {
      issues.push({
        code: 'duplicate_step_key',
        message: `stepKey duplicado: ${step.stepKey}`,
        stepKey: step.stepKey,
      });
    }
    byId.set(step.id, step);
    stepKeys.add(step.stepKey);
  }

  const indegree = new Map(steps.map((step) => [step.id, 0]));
  const adjacency = new Map(steps.map((step) => [step.id, [] as string[]]));
  const outcomesByStep = new Map<string, Set<AutomationEdgeOutcome>>();
  const compiledEdges: CompiledEdge[] = [];

  for (const edge of edges) {
    const from = byId.get(edge.fromStepId);
    const to = byId.get(edge.toStepId);
    if (!from || !to) {
      issues.push({
        code: 'edge_target_missing',
        message: 'aresta aponta para passo inexistente',
        stepKey: from?.stepKey,
      });
      continue;
    }
    if (!ALLOWED_OUTCOMES[from.stepType].has(edge.outcome)) {
      issues.push({
        code: 'invalid_outcome',
        message: `outcome ${edge.outcome} inválido para ${from.stepType}`,
        stepKey: from.stepKey,
      });
    }

    const used = outcomesByStep.get(from.id) ?? new Set();
    if (used.has(edge.outcome)) {
      issues.push({
        code: 'duplicate_outcome',
        message: `outcome ${edge.outcome} duplicado no mesmo passo`,
        stepKey: from.stepKey,
      });
    }
    used.add(edge.outcome);
    outcomesByStep.set(from.id, used);
    indegree.set(to.id, (indegree.get(to.id) ?? 0) + 1);
    adjacency.get(from.id)?.push(to.id);
    compiledEdges.push({
      fromStepKey: from.stepKey,
      outcome: edge.outcome,
      toStepKey: to.stepKey,
      order: edge.order,
    });
  }

  const entries = steps.filter((step) => indegree.get(step.id) === 0);
  if (entries.length !== 1) {
    issues.push({
      code: 'invalid_entry_count',
      message: `fluxo exige exatamente uma entrada; recebeu ${entries.length}`,
    });
  }

  const visited = new Set<string>();
  if (entries[0]) {
    const queue = [entries[0].id];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...(adjacency.get(current) ?? []));
    }
  }
  for (const step of steps) {
    if (!visited.has(step.id)) {
      issues.push({
        code: 'orphan_step',
        message: `passo órfão: ${step.stepKey}`,
        stepKey: step.stepKey,
      });
    }
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (stepId: string) => {
    if (state.get(stepId) === 'visiting') {
      issues.push({
        code: 'cycle',
        message: `ciclo não permitido no passo ${byId.get(stepId)?.stepKey ?? stepId}`,
        stepKey: byId.get(stepId)?.stepKey,
      });
      return;
    }
    if (state.get(stepId) === 'done') return;
    state.set(stepId, 'visiting');
    for (const target of adjacency.get(stepId) ?? []) visit(target);
    state.set(stepId, 'done');
  };
  for (const step of steps) visit(step.id);

  for (const step of steps) {
    const outcomes = outcomesByStep.get(step.id) ?? new Set();
    if (
      step.stepType === 'wait_for_event'
      && (!outcomes.has('answered') || !outcomes.has('timeout'))
    ) {
      issues.push({
        code: 'wait_paths_missing',
        message: 'wait_for_event exige os outcomes answered e timeout',
        stepKey: step.stepKey,
      });
    }
    if (
      step.stepType === 'condition'
      && (!outcomes.has('true') || (!outcomes.has('false') && !outcomes.has('otherwise')))
    ) {
      issues.push({
        code: 'condition_paths_missing',
        message: 'condition exige true e false/otherwise',
        stepKey: step.stepKey,
      });
    }
  }

  if (![...adjacency.values()].some((targets) => targets.length === 0)) {
    issues.push({ code: 'terminal_missing', message: 'fluxo não possui caminho terminal' });
  }

  if (issues.length) throw new AutomationCompileError(issues);
  return {
    entryStepKey: entries[0].stepKey,
    compiledEdges: compiledEdges.sort((left, right) =>
      left.fromStepKey.localeCompare(right.fromStepKey)
      || left.outcome.localeCompare(right.outcome)
      || left.order - right.order
      || left.toStepKey.localeCompare(right.toStepKey)
    ),
  };
}

export function compileAutomationDefinition(input: AutomationCompileInput): {
  definition: CompiledAutomationDefinition;
  canonicalJson: string;
  definitionHash: string;
} {
  const inputIssues: AutomationCompileIssue[] = [];
  if (!UUID_SCHEMA.safeParse(input.automation.id).success) {
    inputIssues.push({ code: 'invalid_automation_id', message: 'automationId inválido' });
  }
  if (!UUID_SCHEMA.safeParse(input.automation.organizationId).success) {
    inputIssues.push({ code: 'invalid_organization_id', message: 'organizationId inválido' });
  }
  if (!input.automation.name.trim()) {
    inputIssues.push({ code: 'empty_name', message: 'nome da automação é obrigatório' });
  }
  if (!Number.isSafeInteger(input.automation.draftRevision) || input.automation.draftRevision < 1) {
    inputIssues.push({ code: 'invalid_revision', message: 'draftRevision inválida' });
  }
  if (!validateTimezone(input.schedule.timezone)) {
    inputIssues.push({ code: 'invalid_timezone', message: 'timezone inválida' });
  }
  if (
    !TIME_SCHEMA.safeParse(input.schedule.quietHoursStart).success
    || !TIME_SCHEMA.safeParse(input.schedule.quietHoursEnd).success
    || input.schedule.quietHoursStart === input.schedule.quietHoursEnd
  ) {
    inputIssues.push({ code: 'invalid_quiet_hours', message: 'quiet hours inválidas' });
  }
  if (inputIssues.length) throw new AutomationCompileError(inputIssues);

  const templates = new Map<string, AutomationTemplateSnapshotSource>();
  for (const template of input.templates) {
    if (templates.has(template.id)) {
      throw new AutomationCompileError([{
        code: 'duplicate_template',
        message: `template duplicado: ${template.id}`,
      }]);
    }
    templates.set(template.id, template);
  }

  const { entryStepKey, compiledEdges } = validateGraph(input.steps, input.edges);
  const steps: CompiledStep[] = input.steps.map((step) => ({
    stepKey: step.stepKey,
    type: step.stepType,
    uiOrder: step.sortKey,
    config: compileStepConfig(step, templates, input.automation.organizationId),
  })).sort((left, right) => left.stepKey.localeCompare(right.stepKey));

  const definition: CompiledAutomationDefinition = {
    schemaVersion: 1,
    automationId: input.automation.id,
    organizationId: input.automation.organizationId,
    name: input.automation.name.trim(),
    deliveryMode: input.automation.deliveryMode,
    trigger: {
      type: input.automation.triggerType,
      config: assertJsonObject(input.automation.triggerConfig, 'triggerConfig'),
    },
    schedule: {
      timezone: input.schedule.timezone,
      quietHoursStart: input.schedule.quietHoursStart,
      quietHoursEnd: input.schedule.quietHoursEnd,
      dayDelaySemantics: input.schedule.dayDelaySemantics,
    },
    entryStepKey,
    steps,
    edges: compiledEdges,
  };
  const serialized = canonicalJson(definition as unknown as JsonValue);
  return {
    definition,
    canonicalJson: serialized,
    definitionHash: createHash('sha256').update(serialized).digest('hex'),
  };
}
