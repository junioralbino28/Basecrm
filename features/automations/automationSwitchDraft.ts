import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';

export const MAX_AUTOMATION_SWITCH_CASES = 20;
export const SWITCH_CASE_LIMIT_MESSAGE =
  'Limite de 20 caminhos atingido. Remova um caminho antes de adicionar outro.';
export const SWITCH_SUBTREE_REMOVE_MESSAGE =
  'Este caminho tem passos abaixo. Mova ou remova esses passos antes de apagar o caminho.';

export type AutomationSwitchCase = {
  case_id: string;
  label: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists';
  value?: string | null;
  order: number;
};

type SwitchGraphParams = {
  switchStepKey: string;
  steps: AutomationBuilderStep[];
  edges: AutomationBuilderEdge[];
};

function switchStepFrom(params: SwitchGraphParams) {
  const step = params.steps.find((candidate) => (
    candidate.stepKey === params.switchStepKey && candidate.stepType === 'switch'
  ));
  if (!step) throw new Error('O passo Divide caminho não existe mais no rascunho.');
  return step;
}

export function automationSwitchCases(step: AutomationBuilderStep): AutomationSwitchCase[] {
  if (!Array.isArray(step.config.cases)) return [];
  return step.config.cases
    .filter((value): value is AutomationSwitchCase => Boolean(
      value
      && typeof value === 'object'
      && typeof (value as AutomationSwitchCase).case_id === 'string',
    ))
    .map((value) => ({ ...value }))
    .sort((left, right) => left.order - right.order || left.case_id.localeCompare(right.case_id));
}

function withCases(
  params: SwitchGraphParams,
  cases: AutomationSwitchCase[],
  { removeStepKey, appendStep }: {
    removeStepKey?: string;
    appendStep?: AutomationBuilderStep;
  } = {},
) {
  const orderedCases = cases.map((item, order) => ({ ...item, order }));
  const orderByOutcome = new Map(
    orderedCases.map((item) => [`case:${item.case_id}`, item.order]),
  );
  const steps = params.steps
    .filter((step) => step.stepKey !== removeStepKey)
    .map((step) => step.stepKey === params.switchStepKey
      ? { ...step, config: { ...step.config, cases: orderedCases } }
      : { ...step, config: { ...step.config } });
  if (appendStep) steps.push(appendStep);

  return {
    steps,
    edges: params.edges
      .filter((edge) => edge.toStepKey !== removeStepKey)
      .map((edge) => {
        if (edge.fromStepKey !== params.switchStepKey) return { ...edge };
        if (edge.outcome === 'otherwise') return { ...edge, order: orderedCases.length };
        const order = orderByOutcome.get(edge.outcome);
        return order === undefined ? { ...edge } : { ...edge, order };
      }),
  };
}

export function addAutomationSwitchCase({
  createId = () => globalThis.crypto.randomUUID(),
  ...params
}: SwitchGraphParams & { createId?: () => string }) {
  const switchStep = switchStepFrom(params);
  const cases = automationSwitchCases(switchStep);
  if (cases.length >= MAX_AUTOMATION_SWITCH_CASES) {
    throw new Error(SWITCH_CASE_LIMIT_MESSAGE);
  }

  const caseId = createId();
  const placeholderKey = createId();
  const nextOrder = cases.length;
  const nextCase: AutomationSwitchCase = {
    case_id: caseId,
    label: `Caminho ${nextOrder + 1}`,
    operator: 'contains',
    value: '',
    order: nextOrder,
  };
  const result = withCases(params, [...cases, nextCase], {
    appendStep: {
      stepKey: placeholderKey,
      stepType: 'create_task',
      sortKey: Math.max(0, ...params.steps.map((step) => step.sortKey)) + 1,
      config: { title: `Configurar Caminho ${nextOrder + 1}` },
    },
  });
  result.edges.push({
    fromStepKey: params.switchStepKey,
    outcome: `case:${caseId}`,
    toStepKey: placeholderKey,
    order: nextOrder,
  });
  result.edges = result.edges.map((edge) => (
    edge.fromStepKey === params.switchStepKey && edge.outcome === 'otherwise'
      ? { ...edge, order: nextOrder + 1 }
      : edge
  ));
  return result;
}

export function moveAutomationSwitchCase({
  caseId,
  direction,
  ...params
}: SwitchGraphParams & { caseId: string; direction: 'up' | 'down' }) {
  const cases = automationSwitchCases(switchStepFrom(params));
  const index = cases.findIndex((item) => item.case_id === caseId);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= cases.length) {
    return withCases(params, cases);
  }
  [cases[index], cases[targetIndex]] = [cases[targetIndex], cases[index]];
  return withCases(params, cases);
}

export function removeAutomationSwitchCase({
  caseId,
  ...params
}: SwitchGraphParams & { caseId: string }) {
  const cases = automationSwitchCases(switchStepFrom(params));
  if (cases.length <= 1) {
    throw new Error('Uma divisão precisa manter pelo menos um caminho além do caminho final.');
  }
  const edge = params.edges.find((candidate) => (
    candidate.fromStepKey === params.switchStepKey
    && candidate.outcome === `case:${caseId}`
  ));
  if (!edge) throw new Error('O caminho não existe mais no rascunho.');
  if (params.edges.some((candidate) => candidate.fromStepKey === edge.toStepKey)) {
    throw new Error(SWITCH_SUBTREE_REMOVE_MESSAGE);
  }

  return withCases(
    {
      ...params,
      edges: params.edges.filter((candidate) => candidate !== edge),
    },
    cases.filter((item) => item.case_id !== caseId),
    { removeStepKey: edge.toStepKey },
  );
}
