import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';

export const AUTOMATION_NODE_WIDTH = 186;
export const AUTOMATION_NODE_HEIGHT = 96;
export const AUTOMATION_COLUMN_GAP = 124;
export const AUTOMATION_ROW_GAP = 20;
const AUTOMATION_TREE_PADDING = 40;

export type AutomationTreeNode = {
  step: AutomationBuilderStep;
  depth: number;
  x: number;
  y: number;
};

export type AutomationTreeEdge = AutomationBuilderEdge & {
  label: string;
  path: string;
  labelX: number;
  labelY: number;
};

export type AutomationTreeLayout = {
  nodes: AutomationTreeNode[];
  edges: AutomationTreeEdge[];
  width: number;
  height: number;
};

function compareSteps(left: AutomationBuilderStep, right: AutomationBuilderStep) {
  return left.sortKey - right.sortKey || left.stepKey.localeCompare(right.stepKey);
}

function compareEdges(
  stepsByKey: Map<string, AutomationBuilderStep>,
  left: AutomationBuilderEdge,
  right: AutomationBuilderEdge,
) {
  const leftTarget = stepsByKey.get(left.toStepKey);
  const rightTarget = stepsByKey.get(right.toStepKey);
  return left.order - right.order
    || (leftTarget?.sortKey ?? 0) - (rightTarget?.sortKey ?? 0)
    || left.outcome.localeCompare(right.outcome)
    || left.toStepKey.localeCompare(right.toStepKey);
}

function switchCaseLabel(step: AutomationBuilderStep, caseId: string) {
  const cases = Array.isArray(step.config.cases) ? step.config.cases : [];
  for (const value of cases) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as Record<string, unknown>;
    if (candidate.case_id === caseId && typeof candidate.label === 'string') {
      return candidate.label.trim();
    }
  }
  return '';
}

export function automationEdgeLabel(
  edge: AutomationBuilderEdge,
  source: AutomationBuilderStep,
) {
  if (edge.outcome === 'success') return '';
  if (edge.outcome === 'answered') return 'respondeu';
  if (edge.outcome === 'timeout') return 'não respondeu';
  if (edge.outcome === 'failed') return 'falhou';
  if (edge.outcome === 'true') return 'sim';
  if (edge.outcome === 'false') return 'não';
  if (edge.outcome === 'otherwise') {
    return typeof source.config.fallback_label === 'string'
      ? source.config.fallback_label.trim()
      : 'outro caminho';
  }
  if (edge.outcome.startsWith('case:')) {
    return switchCaseLabel(source, edge.outcome.slice('case:'.length)) || 'caminho';
  }
  return edge.outcome;
}

export function layoutAutomationTree(
  inputSteps: AutomationBuilderStep[],
  inputEdges: AutomationBuilderEdge[],
): AutomationTreeLayout {
  if (!inputSteps.length) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const orderedSteps = [...inputSteps].sort(compareSteps);
  const stepsByKey = new Map(orderedSteps.map((step) => [step.stepKey, step]));
  const outgoing = new Map<string, AutomationBuilderEdge[]>();
  const indegree = new Map(orderedSteps.map((step) => [step.stepKey, 0]));

  for (const edge of inputEdges) {
    if (!stepsByKey.has(edge.fromStepKey) || !stepsByKey.has(edge.toStepKey)) continue;
    outgoing.set(edge.fromStepKey, [...(outgoing.get(edge.fromStepKey) ?? []), edge]);
    indegree.set(edge.toStepKey, (indegree.get(edge.toStepKey) ?? 0) + 1);
  }
  for (const [stepKey, edges] of outgoing) {
    outgoing.set(stepKey, [...edges].sort((left, right) =>
      compareEdges(stepsByKey, left, right)
    ));
  }

  const positions = new Map<string, Omit<AutomationTreeNode, 'step'>>();
  const visited = new Set<string>();
  const cursor = { y: 0 };

  const measure = (stepKey: string, depth: number): number => {
    const existing = positions.get(stepKey);
    if (existing) return existing.y;
    visited.add(stepKey);

    const children = (outgoing.get(stepKey) ?? [])
      .map((edge) => edge.toStepKey)
      .filter((childKey) => !visited.has(childKey));
    let y: number;
    if (!children.length) {
      y = cursor.y;
      cursor.y += AUTOMATION_NODE_HEIGHT + AUTOMATION_ROW_GAP;
    } else {
      const childYs = children.map((childKey) => measure(childKey, depth + 1));
      y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }

    positions.set(stepKey, {
      depth,
      x: depth * (AUTOMATION_NODE_WIDTH + AUTOMATION_COLUMN_GAP),
      y,
    });
    return y;
  };

  const roots = orderedSteps.filter((step) => indegree.get(step.stepKey) === 0);
  for (const root of roots.length ? roots : orderedSteps.slice(0, 1)) {
    if (!visited.has(root.stepKey)) measure(root.stepKey, 0);
  }
  for (const step of orderedSteps) {
    if (!visited.has(step.stepKey)) measure(step.stepKey, 0);
  }

  const nodes = orderedSteps.map((step) => ({
    step,
    ...(positions.get(step.stepKey) ?? { depth: 0, x: 0, y: 0 }),
  }));
  const nodesByKey = new Map(nodes.map((node) => [node.step.stepKey, node]));
  const edges = inputEdges
    .filter((edge) => nodesByKey.has(edge.fromStepKey) && nodesByKey.has(edge.toStepKey))
    .sort((left, right) => {
      const leftSource = nodesByKey.get(left.fromStepKey);
      const rightSource = nodesByKey.get(right.fromStepKey);
      return (leftSource?.x ?? 0) - (rightSource?.x ?? 0)
        || (leftSource?.y ?? 0) - (rightSource?.y ?? 0)
        || compareEdges(stepsByKey, left, right);
    })
    .map((edge): AutomationTreeEdge => {
      const source = nodesByKey.get(edge.fromStepKey)!;
      const target = nodesByKey.get(edge.toStepKey)!;
      const x1 = source.x + AUTOMATION_NODE_WIDTH;
      const y1 = source.y + AUTOMATION_NODE_HEIGHT / 2;
      const x2 = target.x;
      const y2 = target.y + AUTOMATION_NODE_HEIGHT / 2;
      const controlX = (x1 + x2) / 2;
      return {
        ...edge,
        label: automationEdgeLabel(edge, source.step),
        path: `M${x1} ${y1} C${controlX} ${y1}, ${controlX} ${y2}, ${x2} ${y2}`,
        labelX: x1 + 8,
        labelY: (y1 + y2) / 2,
      };
    });

  return {
    nodes,
    edges,
    width: Math.max(...nodes.map((node) => node.x)) + AUTOMATION_NODE_WIDTH
      + AUTOMATION_TREE_PADDING,
    height: Math.max(...nodes.map((node) => node.y)) + AUTOMATION_NODE_HEIGHT
      + AUTOMATION_TREE_PADDING,
  };
}
