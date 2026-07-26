import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';

export const AUTOMATION_NODE_WIDTH = 186;
export const AUTOMATION_NODE_HEIGHT = 96;
// Respiro entre NÍVEIS (profundidade) e entre IRMÃOS (espalhamento). Cada eixo
// tem o seu porque a largura e a altura do card são diferentes: no horizontal o
// fluxo espalha na vertical (cards baixos, gap pequeno); no vertical o fluxo
// espalha na horizontal (cards largos, gap maior pra não colar as colunas).
export const AUTOMATION_LEVEL_GAP_H = 124;
export const AUTOMATION_LEVEL_GAP_V = 72;
export const AUTOMATION_SIBLING_GAP_H = 20;
export const AUTOMATION_SIBLING_GAP_V = 40;
const AUTOMATION_TREE_PADDING = 40;

/** Direção do fluxo no mapa. Vertical = desce; horizontal = anda pra direita. */
export type AutomationOrientation = 'vertical' | 'horizontal';

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
  midpointX: number;
  midpointY: number;
};

export type AutomationTreeLayout = {
  nodes: AutomationTreeNode[];
  edges: AutomationTreeEdge[];
  width: number;
  height: number;
};

// O algoritmo de árvore é o MESMO nos dois sentidos — só troca qual eixo carrega
// a profundidade (main) e qual carrega o espalhamento dos irmãos (cross). Esta
// projeção é a única coisa que sabe "vertical" ou "horizontal"; o resto opera em
// coordenadas abstratas e é espelhado de graça.
type AutomationAxis = {
  levelStep: number;
  crossSize: number;
  siblingGap: number;
  project: (main: number, cross: number) => { x: number; y: number };
};

function axisFor(orientation: AutomationOrientation): AutomationAxis {
  if (orientation === 'vertical') {
    return {
      levelStep: AUTOMATION_NODE_HEIGHT + AUTOMATION_LEVEL_GAP_V,
      crossSize: AUTOMATION_NODE_WIDTH,
      siblingGap: AUTOMATION_SIBLING_GAP_V,
      project: (main, cross) => ({ x: cross, y: main }),
    };
  }
  return {
    levelStep: AUTOMATION_NODE_WIDTH + AUTOMATION_LEVEL_GAP_H,
    crossSize: AUTOMATION_NODE_HEIGHT,
    siblingGap: AUTOMATION_SIBLING_GAP_H,
    project: (main, cross) => ({ x: main, y: cross }),
  };
}

// Geometria da aresta (ponto de saída/entrada, curva e âncora do rótulo) também
// espelhada por eixo: no horizontal a linha sai pela lateral direita e curva em
// X; no vertical sai por baixo e curva em Y.
function edgeGeometry(
  orientation: AutomationOrientation,
  source: AutomationTreeNode,
  target: AutomationTreeNode,
) {
  if (orientation === 'vertical') {
    const x1 = source.x + AUTOMATION_NODE_WIDTH / 2;
    const y1 = source.y + AUTOMATION_NODE_HEIGHT;
    const x2 = target.x + AUTOMATION_NODE_WIDTH / 2;
    const y2 = target.y;
    const controlY = (y1 + y2) / 2;
    const midpointX = (x1 + x2) / 2;
    return {
      path: `M${x1} ${y1} C${x1} ${controlY}, ${x2} ${controlY}, ${x2} ${y2}`,
      labelX: midpointX - 52,
      labelY: controlY,
      midpointX,
      midpointY: controlY,
    };
  }
  const x1 = source.x + AUTOMATION_NODE_WIDTH;
  const y1 = source.y + AUTOMATION_NODE_HEIGHT / 2;
  const x2 = target.x;
  const y2 = target.y + AUTOMATION_NODE_HEIGHT / 2;
  const controlX = (x1 + x2) / 2;
  return {
    path: `M${x1} ${y1} C${controlX} ${y1}, ${controlX} ${y2}, ${x2} ${y2}`,
    labelX: x1 + 8,
    labelY: (y1 + y2) / 2,
    midpointX: controlX,
    midpointY: (y1 + y2) / 2,
  };
}

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
  orientation: AutomationOrientation,
): AutomationTreeLayout {
  if (!inputSteps.length) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const axis = axisFor(orientation);
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

  const positions = new Map<string, { depth: number; cross: number; x: number; y: number }>();
  const visited = new Set<string>();
  const cursor = { cross: 0 };

  const measure = (stepKey: string, depth: number): number => {
    const existing = positions.get(stepKey);
    if (existing) return existing.cross;
    visited.add(stepKey);

    const children = (outgoing.get(stepKey) ?? [])
      .map((edge) => edge.toStepKey)
      .filter((childKey) => !visited.has(childKey));
    let cross: number;
    if (!children.length) {
      cross = cursor.cross;
      cursor.cross += axis.crossSize + axis.siblingGap;
    } else {
      const childCrosses = children.map((childKey) => measure(childKey, depth + 1));
      cross = (childCrosses[0] + childCrosses[childCrosses.length - 1]) / 2;
    }

    const main = depth * axis.levelStep;
    positions.set(stepKey, { depth, cross, ...axis.project(main, cross) });
    return cross;
  };

  const roots = orderedSteps.filter((step) => indegree.get(step.stepKey) === 0);
  for (const root of roots.length ? roots : orderedSteps.slice(0, 1)) {
    if (!visited.has(root.stepKey)) measure(root.stepKey, 0);
  }
  for (const step of orderedSteps) {
    if (!visited.has(step.stepKey)) measure(step.stepKey, 0);
  }

  const nodes = orderedSteps.map((step) => {
    const position = positions.get(step.stepKey) ?? { depth: 0, x: 0, y: 0 };
    return { step, depth: position.depth, x: position.x, y: position.y };
  });
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
      const geometry = edgeGeometry(orientation, source, target);
      return {
        ...edge,
        label: automationEdgeLabel(edge, source.step),
        ...geometry,
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
