import { describe, expect, it } from 'vitest';
import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';
import {
  addAutomationSwitchCase,
  moveAutomationSwitchCase,
  removeAutomationSwitchCase,
} from './automationSwitchDraft';

const CASE_A = '11111111-1111-4111-8111-111111111111';
const CASE_B = '22222222-2222-4222-8222-222222222222';

function switchGraph(caseCount = 2): {
  steps: AutomationBuilderStep[];
  edges: AutomationBuilderEdge[];
} {
  const cases = Array.from({ length: caseCount }, (_, index) => ({
    case_id: index === 0 ? CASE_A : index === 1 ? CASE_B : crypto.randomUUID(),
    label: `Caminho ${index + 1}`,
    operator: 'contains',
    value: String(index + 1),
    order: index,
  }));
  const leaves = cases.map((item, index): AutomationBuilderStep => ({
    stepKey: `folha-${index}`,
    stepType: 'create_task',
    sortKey: index + 1,
    config: { title: `Folha ${index + 1}` },
  }));
  const fallback: AutomationBuilderStep = {
    stepKey: 'fallback',
    stepType: 'create_task',
    sortKey: caseCount + 1,
    config: { title: 'Fallback' },
  };
  return {
    steps: [{
      stepKey: 'switch',
      stepType: 'switch',
      sortKey: 0,
      config: { field: 'contact.phone', cases, fallback_label: 'Outro caminho' },
    }, ...leaves, fallback],
    edges: [
      ...cases.map((item, index): AutomationBuilderEdge => ({
        fromStepKey: 'switch',
        outcome: `case:${item.case_id}`,
        toStepKey: `folha-${index}`,
        order: index,
      })),
      {
        fromStepKey: 'switch',
        outcome: 'otherwise',
        toStepKey: 'fallback',
        order: caseCount,
      },
    ],
  };
}

describe('edição estrutural de Divide caminho', () => {
  it('adiciona caso com ID estável, folha própria e fallback ainda por último', () => {
    const graph = switchGraph(1);
    const result = addAutomationSwitchCase({
      ...graph,
      switchStepKey: 'switch',
      createId: (() => {
        const ids = [CASE_B, '33333333-3333-4333-8333-333333333333'];
        return () => ids.shift()!;
      })(),
    });
    const changed = result.steps.find((step) => step.stepKey === 'switch')!;

    expect(changed.config.cases).toEqual([
      expect.objectContaining({ case_id: CASE_A, order: 0 }),
      expect.objectContaining({ case_id: CASE_B, label: 'Caminho 2', order: 1 }),
    ]);
    expect(result.steps).toContainEqual(expect.objectContaining({
      stepKey: '33333333-3333-4333-8333-333333333333',
      config: { title: 'Configurar Caminho 2' },
    }));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: `case:${CASE_B}`, order: 1 }),
      expect.objectContaining({ outcome: 'otherwise', order: 2 }),
    ]));
  });

  it('recusa o 21º caminho com mensagem clara em PT-BR', () => {
    const graph = switchGraph(20);

    expect(() => addAutomationSwitchCase({
      ...graph,
      switchStepKey: 'switch',
    })).toThrow('Limite de 20 caminhos atingido. Remova um caminho antes de adicionar outro.');
  });

  it('reordena casos e arestas sem trocar case_id nem destino', () => {
    const graph = switchGraph();
    const result = moveAutomationSwitchCase({
      ...graph,
      switchStepKey: 'switch',
      caseId: CASE_B,
      direction: 'up',
    });
    const changed = result.steps.find((step) => step.stepKey === 'switch')!;

    expect(changed.config.cases).toEqual([
      expect.objectContaining({ case_id: CASE_B, order: 0 }),
      expect.objectContaining({ case_id: CASE_A, order: 1 }),
    ]);
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: `case:${CASE_B}`, toStepKey: 'folha-1', order: 0 }),
      expect.objectContaining({ outcome: `case:${CASE_A}`, toStepKey: 'folha-0', order: 1 }),
      expect.objectContaining({ outcome: 'otherwise', order: 2 }),
    ]));
  });

  it('remove somente um caminho cuja etapa de entrada ainda é folha', () => {
    const graph = switchGraph();
    const result = removeAutomationSwitchCase({
      ...graph,
      switchStepKey: 'switch',
      caseId: CASE_A,
    });

    expect(result.steps.some((step) => step.stepKey === 'folha-0')).toBe(false);
    expect(result.edges.some((edge) => edge.outcome === `case:${CASE_A}`)).toBe(false);
    expect(result.edges).toContainEqual(expect.objectContaining({
      outcome: `case:${CASE_B}`,
      order: 0,
    }));
    expect(result.edges).toContainEqual(expect.objectContaining({
      outcome: 'otherwise',
      order: 1,
    }));
  });

  it('bloqueia remoção com subárvore e ensina como resolver', () => {
    const graph = switchGraph();
    graph.steps.push({
      stepKey: 'abaixo',
      stepType: 'create_task',
      sortKey: 4,
      config: { title: 'Abaixo' },
    });
    graph.edges.push({
      fromStepKey: 'folha-0',
      outcome: 'success',
      toStepKey: 'abaixo',
      order: 0,
    });

    expect(() => removeAutomationSwitchCase({
      ...graph,
      switchStepKey: 'switch',
      caseId: CASE_A,
    })).toThrow(
      'Este caminho tem passos abaixo. Mova ou remova esses passos antes de apagar o caminho.',
    );
  });
});
