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
  'switch',
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
export type AutomationStaticEdgeOutcome = (typeof AUTOMATION_EDGE_OUTCOMES)[number];
export type AutomationEdgeOutcome =
  | AutomationStaticEdgeOutcome
  | `case:${string}`;

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
  schemaVersion: 3;
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
const CASE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CASE_OUTCOME_PATTERN =
  /^case:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SWITCH_CASES = 20;
const MAX_SWITCH_LABEL_LENGTH = 80;
const MAX_SWITCH_VALUE_LENGTH = 200;

export function isAutomationEdgeOutcome(
  value: string,
): value is AutomationEdgeOutcome {
  return (
    (AUTOMATION_EDGE_OUTCOMES as readonly string[]).includes(value)
    || CASE_OUTCOME_PATTERN.test(value)
  );
}

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

const TagTriggerConfigSchema = z.object({
  tag_id: UUID_SCHEMA,
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

const SwitchConfigSchema = z.object({
  field: z.enum([
    'deal.tag_ids',
    'contact.phone',
    'deal.stage_id',
    'deal.board_id',
  ]),
  cases: z.array(z.object({
    case_id: z.string().regex(CASE_ID_PATTERN),
    label: z.string().trim().min(1).max(MAX_SWITCH_LABEL_LENGTH),
    operator: z.enum([
      'equals',
      'not_equals',
      'contains',
      'not_contains',
      'exists',
    ]),
    value: z.string().trim().max(MAX_SWITCH_VALUE_LENGTH).nullable().optional(),
    order: z.number().int().min(0),
  }).strict()).min(1).max(MAX_SWITCH_CASES),
  fallback_label: z.string().trim().min(1).max(MAX_SWITCH_LABEL_LENGTH),
}).strict().superRefine((config, context) => {
  for (const [index, switchCase] of config.cases.entries()) {
    const path = ['cases', index] as (string | number)[];
    const allowedOperators = config.field === 'deal.tag_ids'
      ? new Set(['contains', 'not_contains'])
      : config.field === 'contact.phone'
        ? new Set(['equals', 'not_equals', 'contains', 'not_contains', 'exists'])
        : new Set(['equals', 'not_equals', 'exists']);

    if (!allowedOperators.has(switchCase.operator)) {
      context.addIssue({
        code: 'custom',
        message: `operador ${switchCase.operator} incompatível com ${config.field}`,
        path: [...path, 'operator'],
      });
    }

    if (switchCase.operator === 'exists') {
      if (switchCase.value !== undefined && switchCase.value !== null) {
        context.addIssue({
          code: 'custom',
          message: 'operador exists não aceita value',
          path: [...path, 'value'],
        });
      }
      continue;
    }

    if (!switchCase.value) {
      context.addIssue({
        code: 'custom',
        message: `operador ${switchCase.operator} exige value`,
        path: [...path, 'value'],
      });
      continue;
    }

    if (
      (
        config.field === 'deal.tag_ids'
        || config.field === 'deal.stage_id'
        || config.field === 'deal.board_id'
      )
      && !UUID_SCHEMA.safeParse(switchCase.value).success
    ) {
      context.addIssue({
        code: 'custom',
        message: `${config.field} exige value UUID`,
        path: [...path, 'value'],
      });
    }
  }
});

const KNOWN_VARIABLES = new Set([
  'contato.nome',
  'contato.primeiro_nome',
  'contato.telefone',
  'negocio.titulo',
  'negocio.valor',
  'responsavel.nome',
  'organizacao.nome',
]);

const ALLOWED_OUTCOMES: Record<AutomationStepType, ReadonlySet<string>> = {
  send_message: new Set(['success', 'failed']),
  delay: new Set(['success', 'failed']),
  wait_for_event: new Set(['answered', 'timeout', 'failed']),
  create_task: new Set(['success', 'failed']),
  move_stage: new Set(['success', 'failed']),
  move_pipeline: new Set(['success', 'failed']),
  condition: new Set(['true', 'false', 'otherwise']),
  switch: new Set(['otherwise']),
};

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

function parseSwitchConfig(step: AutomationDraftStep) {
  const parsed = SwitchConfigSchema.safeParse(step.config);
  if (!parsed.success) throw zodIssue(step, parsed.error);

  const caseIds = new Set<string>();
  const orders = new Set<number>();
  for (const switchCase of parsed.data.cases) {
    if (caseIds.has(switchCase.case_id)) {
      throw new AutomationCompileError([{
        code: 'switch_case_duplicate',
        message: `case_id duplicado no switch: ${switchCase.case_id}`,
        stepKey: step.stepKey,
      }]);
    }
    if (orders.has(switchCase.order)) {
      throw new AutomationCompileError([{
        code: 'switch_case_duplicate',
        message: `ordem de caso duplicada no switch: ${switchCase.order}`,
        stepKey: step.stepKey,
      }]);
    }
    caseIds.add(switchCase.case_id);
    orders.add(switchCase.order);
  }

  return {
    ...parsed.data,
    cases: [...parsed.data.cases].sort((left, right) =>
      left.order - right.order || left.case_id.localeCompare(right.case_id)
    ),
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
  if (step.stepType === 'switch') {
    const config = parseSwitchConfig(step);
    return {
      field: config.field,
      cases: config.cases.map((switchCase) => ({
        caseId: switchCase.case_id,
        label: switchCase.label,
        operator: switchCase.operator,
        value: switchCase.value ?? null,
        order: switchCase.order,
      })),
      fallbackLabel: config.fallback_label,
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
  const ordersByStep = new Map<string, Set<number>>();
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
    const isDynamicOutcome = edge.outcome.startsWith('case:');
    const isValidCaseOutcome = CASE_OUTCOME_PATTERN.test(edge.outcome);
    if (isDynamicOutcome && from.stepType !== 'switch') {
      issues.push({
        code: 'dynamic_outcome_not_allowed',
        message: `outcome dinâmico não permitido para ${from.stepType}`,
        stepKey: from.stepKey,
      });
    } else if (
      !ALLOWED_OUTCOMES[from.stepType].has(edge.outcome)
      && !(from.stepType === 'switch' && isValidCaseOutcome)
    ) {
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

    const usedOrders = ordersByStep.get(from.id) ?? new Set();
    if (usedOrders.has(edge.order)) {
      issues.push({
        code: 'duplicate_edge_order',
        message: `ordem de aresta ${edge.order} duplicada no mesmo passo`,
        stepKey: from.stepKey,
      });
    }
    usedOrders.add(edge.order);
    ordersByStep.set(from.id, usedOrders);

    indegree.set(to.id, (indegree.get(to.id) ?? 0) + 1);
    adjacency.get(from.id)?.push(to.id);
    compiledEdges.push({
      fromStepKey: from.stepKey,
      outcome: edge.outcome,
      toStepKey: to.stepKey,
      order: edge.order,
    });
  }

  for (const step of steps) {
    const parentCount = indegree.get(step.id) ?? 0;
    if (parentCount > 1) {
      issues.push({
        code: 'multiple_parents',
        message: `passo ${step.stepKey} possui ${parentCount} pais; o builder v1 exige pai único`,
        stepKey: step.stepKey,
      });
    }
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
    if (step.stepType === 'switch') {
      const config = parseSwitchConfig(step);
      const expectedCaseOutcomes = new Set(
        config.cases.map(({ case_id: caseId }) => `case:${caseId}`),
      );
      const actualCaseOutcomes = new Set<string>(
        [...outcomes].filter((outcome) => CASE_OUTCOME_PATTERN.test(outcome)),
      );
      if (
        expectedCaseOutcomes.size !== actualCaseOutcomes.size
        || [...expectedCaseOutcomes].some(
          (outcome) => !actualCaseOutcomes.has(outcome),
        )
      ) {
        issues.push({
          code: 'switch_case_edge_mismatch',
          message: 'casos do switch e arestas case:<id> não correspondem',
          stepKey: step.stepKey,
        });
      }
      if (!outcomes.has('otherwise')) {
        issues.push({
          code: 'switch_missing_otherwise',
          message: 'switch exige exatamente um outcome otherwise',
          stepKey: step.stepKey,
        });
      }
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
      || left.order - right.order
      || left.outcome.localeCompare(right.outcome)
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

  const triggerConfig = TagTriggerConfigSchema.safeParse(input.automation.triggerConfig);
  if (!triggerConfig.success) {
    throw new AutomationCompileError([{
      code: 'invalid_trigger_config',
      message: 'gatilho exige uma etiqueta em UUID',
    }]);
  }

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
    schemaVersion: 3,
    automationId: input.automation.id,
    organizationId: input.automation.organizationId,
    name: input.automation.name.trim(),
    deliveryMode: input.automation.deliveryMode,
    trigger: {
      type: input.automation.triggerType,
      config: { tagId: triggerConfig.data.tag_id },
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
