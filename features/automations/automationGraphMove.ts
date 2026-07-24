import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';

const ROOT_MOVE_MESSAGE = 'O primeiro passo não pode mudar de lugar.';
const BRANCH_MOVE_MESSAGE =
  'Um passo que divide caminhos não pode ser movido — moveria a árvore inteira junto.';

function sameEdge(left: AutomationBuilderEdge, right: AutomationBuilderEdge) {
  return left.fromStepKey === right.fromStepKey
    && left.toStepKey === right.toStepKey
    && left.outcome === right.outcome
    && left.order === right.order;
}

function descendantsOf(stepKey: string, edges: AutomationBuilderEdge[]) {
  const descendants = new Set<string>();
  const pending = edges
    .filter((edge) => edge.fromStepKey === stepKey)
    .map((edge) => edge.toStepKey);

  while (pending.length) {
    const candidate = pending.pop()!;
    if (descendants.has(candidate)) continue;
    descendants.add(candidate);
    for (const edge of edges) {
      if (edge.fromStepKey === candidate) pending.push(edge.toStepKey);
    }
  }

  return descendants;
}

export function getAutomationMoveBlock(
  stepKey: string,
  steps: AutomationBuilderStep[],
  edges: AutomationBuilderEdge[],
): string | null {
  if (!steps.some((step) => step.stepKey === stepKey)) {
    return 'Este passo não existe mais no rascunho.';
  }

  const incoming = edges.filter((edge) => edge.toStepKey === stepKey);
  if (incoming.length === 0) return ROOT_MOVE_MESSAGE;

  const outgoing = edges.filter((edge) => edge.fromStepKey === stepKey);
  if (outgoing.length > 1) return BRANCH_MOVE_MESSAGE;

  return null;
}

export function eligibleAutomationMoveTargets(
  stepKey: string,
  steps: AutomationBuilderStep[],
  edges: AutomationBuilderEdge[],
): AutomationBuilderEdge[] {
  if (getAutomationMoveBlock(stepKey, steps, edges)) return [];
  const descendants = descendantsOf(stepKey, edges);

  return edges.filter((edge) => (
    edge.fromStepKey !== stepKey
    && edge.toStepKey !== stepKey
    && !descendants.has(edge.toStepKey)
  ));
}

const BRANCH_REMOVE_MESSAGE =
  'Um passo que divide caminhos não pode ser excluído — exclua ou mova antes os passos dos caminhos dele.';
const LAST_STEP_MESSAGE = 'A automação precisa de pelo menos um passo.';
const LAST_OF_BRANCH_MESSAGE =
  'Este é o único passo deste caminho — cada caminho precisa de pelo menos um. Edite este passo ou remova o caminho no passo que divide.';

export function getAutomationRemoveBlock(
  stepKey: string,
  steps: AutomationBuilderStep[],
  edges: AutomationBuilderEdge[],
): string | null {
  if (!steps.some((step) => step.stepKey === stepKey)) {
    return 'Este passo não existe mais no rascunho.';
  }
  if (steps.length === 1) return LAST_STEP_MESSAGE;

  const outgoing = edges.filter((edge) => edge.fromStepKey === stepKey);
  if (outgoing.length > 1) return BRANCH_REMOVE_MESSAGE;

  // Sem sucessor E pai com 2+ saídas = único passo de um caminho ramificado;
  // excluir deixaria o caminho pendurado (o publish recusaria depois, pior UX).
  if (outgoing.length === 0) {
    const incoming = edges.filter((edge) => edge.toStepKey === stepKey);
    for (const edge of incoming) {
      const parentBranchCount = edges.filter(
        (candidate) => candidate.fromStepKey === edge.fromStepKey,
      ).length;
      if (parentBranchCount > 1) return LAST_OF_BRANCH_MESSAGE;
    }
  }

  return null;
}

export function removeAutomationStep({
  stepKey,
  steps,
  edges,
}: {
  stepKey: string;
  steps: AutomationBuilderStep[];
  edges: AutomationBuilderEdge[];
}): { steps: AutomationBuilderStep[]; edges: AutomationBuilderEdge[] } {
  const blocked = getAutomationRemoveBlock(stepKey, steps, edges);
  if (blocked) throw new Error(blocked);

  const outgoing = edges.find((edge) => edge.fromStepKey === stepKey) ?? null;
  const nextEdges: AutomationBuilderEdge[] = [];
  for (const edge of edges) {
    if (edge.fromStepKey === stepKey) continue;
    if (edge.toStepKey === stepKey) {
      // Religa quem apontava pro passo excluído no sucessor dele; num fim de
      // linha (sem sucessor), o caminho passa a terminar no passo anterior.
      if (outgoing) nextEdges.push({ ...edge, toStepKey: outgoing.toStepKey });
      continue;
    }
    nextEdges.push({ ...edge });
  }

  const nextSteps = steps
    .filter((step) => step.stepKey !== stepKey)
    .map((step, index) => ({ ...step, sortKey: index, config: { ...step.config } }));

  return { steps: nextSteps, edges: nextEdges };
}

export function moveAutomationStep({
  stepKey,
  targetEdge,
  steps,
  edges,
  createStepKey = () => globalThis.crypto.randomUUID(),
}: {
  stepKey: string;
  targetEdge: AutomationBuilderEdge;
  steps: AutomationBuilderStep[];
  edges: AutomationBuilderEdge[];
  createStepKey?: () => string;
}): { steps: AutomationBuilderStep[]; edges: AutomationBuilderEdge[] } {
  const blocked = getAutomationMoveBlock(stepKey, steps, edges);
  if (blocked) throw new Error(blocked);

  const eligibleTarget = eligibleAutomationMoveTargets(stepKey, steps, edges)
    .find((edge) => sameEdge(edge, targetEdge));
  if (!eligibleTarget) {
    throw new Error('Escolha uma linha fora da própria subárvore deste passo.');
  }

  const incoming = edges.find((edge) => edge.toStepKey === stepKey)!;
  const outgoing = edges.find((edge) => edge.fromStepKey === stepKey) ?? null;
  const parent = steps.find((step) => step.stepKey === incoming.fromStepKey);
  const parentBranchCount = edges.filter((edge) => (
    edge.fromStepKey === incoming.fromStepKey
  )).length;
  const nextSteps = steps.map((step) => ({ ...step, config: { ...step.config } }));
  let replacementForIncoming: string | null = outgoing?.toStepKey ?? null;

  if (
    !replacementForIncoming
    && parent
    && (parent.stepType === 'switch' || parentBranchCount > 1)
  ) {
    const placeholderKey = createStepKey();
    replacementForIncoming = placeholderKey;
    nextSteps.push({
      stepKey: placeholderKey,
      stepType: 'create_task',
      sortKey: Math.max(0, ...steps.map((step) => step.sortKey)) + 1,
      config: { title: 'Configurar este caminho' },
    });
  }

  const nextEdges: AutomationBuilderEdge[] = [];
  for (const edge of edges) {
    if (outgoing && sameEdge(edge, outgoing)) continue;

    if (sameEdge(edge, incoming)) {
      if (replacementForIncoming) {
        nextEdges.push({ ...edge, toStepKey: replacementForIncoming });
      }
      continue;
    }

    if (sameEdge(edge, eligibleTarget)) {
      nextEdges.push({ ...edge, toStepKey: stepKey });
      continue;
    }

    nextEdges.push({ ...edge });
  }

  nextEdges.push(outgoing
    ? { ...outgoing, toStepKey: eligibleTarget.toStepKey }
    : {
        fromStepKey: stepKey,
        outcome: 'success',
        toStepKey: eligibleTarget.toStepKey,
        order: 0,
      });

  return { steps: nextSteps, edges: nextEdges };
}
