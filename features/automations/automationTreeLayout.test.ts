import { describe, expect, it } from 'vitest';
import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';
import {
  AUTOMATION_NODE_HEIGHT,
  AUTOMATION_NODE_WIDTH,
  layoutAutomationTree,
} from './automationTreeLayout';

function step(
  stepKey: string,
  stepType: AutomationBuilderStep['stepType'],
  sortKey: number,
  config: Record<string, unknown> = {},
): AutomationBuilderStep {
  return { stepKey, stepType, sortKey, config };
}

function edge(
  fromStepKey: string,
  outcome: AutomationBuilderEdge['outcome'],
  toStepKey: string,
  order: number,
): AutomationBuilderEdge {
  return { fromStepKey, outcome, toStepKey, order };
}

describe('layoutAutomationTree (horizontal)', () => {
  it('usa profundidade como coluna e centraliza cada pai entre os filhos', () => {
    const steps = [
      step('inicio', 'send_message', 0),
      step('espera', 'wait_for_event', 1),
      step('respondeu', 'create_task', 2),
      step('timeout', 'create_task', 3),
    ];
    const edges = [
      edge('inicio', 'success', 'espera', 0),
      edge('espera', 'answered', 'respondeu', 0),
      edge('espera', 'timeout', 'timeout', 1),
    ];

    const layout = layoutAutomationTree(steps, edges, 'horizontal');
    const byKey = new Map(layout.nodes.map((node) => [node.step.stepKey, node]));

    expect(byKey.get('inicio')).toMatchObject({ depth: 0, x: 0, y: 58 });
    expect(byKey.get('espera')).toMatchObject({ depth: 1, x: 310, y: 58 });
    expect(byKey.get('respondeu')).toMatchObject({ depth: 2, x: 620, y: 0 });
    expect(byKey.get('timeout')).toMatchObject({ depth: 2, x: 620, y: 116 });
    expect(layout.width).toBe(846);
    expect(layout.height).toBe(252);
  });

  it('gera curvas SVG e traduz o rótulo de cada condição', () => {
    const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const steps = [
      step('divide', 'switch', 0, {
        cases: [{
          case_id: caseId,
          label: 'Lentes',
          operator: 'contains',
          value: 'lentes',
          order: 0,
        }],
        fallback_label: 'Não identificado',
      }),
      step('caso', 'send_message', 1),
      step('fallback', 'create_task', 2),
    ];
    const edges = [
      edge('divide', `case:${caseId}`, 'caso', 0),
      edge('divide', 'otherwise', 'fallback', 1),
    ];

    const layout = layoutAutomationTree(steps, edges, 'horizontal');

    expect(layout.edges.map(({ label }) => label)).toEqual([
      'Lentes',
      'Não identificado',
    ]);
    expect(layout.edges[0].path).toMatch(/^M186 106 C248 106, 248 48, 310 48$/);
    expect(layout.edges[0]).toMatchObject({
      labelX: AUTOMATION_NODE_WIDTH + 8,
      labelY: 77,
      midpointX: 248,
      midpointY: 77,
    });
    expect(AUTOMATION_NODE_HEIGHT).toBe(96);
  });

  it('mantém resultado determinístico quando os arrays chegam fora de ordem', () => {
    const steps = [
      step('fim-b', 'create_task', 2),
      step('raiz', 'wait_for_event', 0),
      step('fim-a', 'create_task', 1),
    ];
    const edges = [
      edge('raiz', 'timeout', 'fim-b', 1),
      edge('raiz', 'answered', 'fim-a', 0),
    ];

    const first = layoutAutomationTree(steps, edges, 'horizontal');
    const second = layoutAutomationTree(
      [...steps].reverse(),
      [...edges].reverse(),
      'horizontal',
    );

    expect(second).toEqual(first);
  });
});

describe('layoutAutomationTree (vertical)', () => {
  it('usa profundidade como linha (desce) e espalha os irmãos na horizontal', () => {
    const steps = [
      step('inicio', 'send_message', 0),
      step('espera', 'wait_for_event', 1),
      step('respondeu', 'create_task', 2),
      step('timeout', 'create_task', 3),
    ];
    const edges = [
      edge('inicio', 'success', 'espera', 0),
      edge('espera', 'answered', 'respondeu', 0),
      edge('espera', 'timeout', 'timeout', 1),
    ];

    const layout = layoutAutomationTree(steps, edges, 'vertical');
    const byKey = new Map(layout.nodes.map((node) => [node.step.stepKey, node]));

    // Profundidade agora desce (y = depth * (96 + 72)); irmãos lado a lado
    // (x = 186 + 40); o pai fica centrado em x entre o primeiro e o último filho.
    expect(byKey.get('inicio')).toMatchObject({ depth: 0, x: 113, y: 0 });
    expect(byKey.get('espera')).toMatchObject({ depth: 1, x: 113, y: 168 });
    expect(byKey.get('respondeu')).toMatchObject({ depth: 2, x: 0, y: 336 });
    expect(byKey.get('timeout')).toMatchObject({ depth: 2, x: 226, y: 336 });
    expect(layout.width).toBe(452);
    expect(layout.height).toBe(472);
  });

  it('curva a aresta por baixo do card e ancora o rótulo no meio', () => {
    const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const steps = [
      step('divide', 'switch', 0, {
        cases: [{
          case_id: caseId,
          label: 'Lentes',
          operator: 'contains',
          value: 'lentes',
          order: 0,
        }],
        fallback_label: 'Não identificado',
      }),
      step('caso', 'send_message', 1),
      step('fallback', 'create_task', 2),
    ];
    const edges = [
      edge('divide', `case:${caseId}`, 'caso', 0),
      edge('divide', 'otherwise', 'fallback', 1),
    ];

    const layout = layoutAutomationTree(steps, edges, 'vertical');

    expect(layout.edges.map(({ label }) => label)).toEqual([
      'Lentes',
      'Não identificado',
    ]);
    // Sai por baixo do card de origem (y = 0 + 96) e curva em Y até o topo do alvo.
    expect(layout.edges[0].path).toMatch(/^M206 96 C206 132, 93 132, 93 168$/);
    expect(layout.edges[0]).toMatchObject({
      labelX: 97.5,
      labelY: 132,
      midpointX: 149.5,
      midpointY: 132,
    });
  });

  it('mantém resultado determinístico quando os arrays chegam fora de ordem', () => {
    const steps = [
      step('fim-b', 'create_task', 2),
      step('raiz', 'wait_for_event', 0),
      step('fim-a', 'create_task', 1),
    ];
    const edges = [
      edge('raiz', 'timeout', 'fim-b', 1),
      edge('raiz', 'answered', 'fim-a', 0),
    ];

    const first = layoutAutomationTree(steps, edges, 'vertical');
    const second = layoutAutomationTree(
      [...steps].reverse(),
      [...edges].reverse(),
      'vertical',
    );

    expect(second).toEqual(first);
  });
});
