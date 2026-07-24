import { describe, expect, it } from 'vitest';
import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';
import {
  eligibleAutomationMoveTargets,
  getAutomationMoveBlock,
  getAutomationRemoveBlock,
  moveAutomationStep,
  removeAutomationStep,
} from './automationGraphMove';

function step(
  stepKey: string,
  stepType: AutomationBuilderStep['stepType'] = 'send_message',
): AutomationBuilderStep {
  return {
    stepKey,
    stepType,
    sortKey: stepKey.charCodeAt(0),
    config: stepType === 'switch'
      ? {
          field: 'contact.phone',
          cases: [{
            case_id: '11111111-1111-4111-8111-111111111111',
            label: 'Tem telefone',
            operator: 'contains',
            value: '11',
            order: 0,
          }],
          fallback_label: 'Outro caminho',
        }
      : {},
  };
}

function edge(
  fromStepKey: string,
  toStepKey: string,
  outcome: AutomationBuilderEdge['outcome'] = 'success',
  order = 0,
): AutomationBuilderEdge {
  return { fromStepKey, toStepKey, outcome, order };
}

describe('movimentação pura do grafo da automação', () => {
  it('bloqueia a raiz com a orientação aprovada', () => {
    const steps = [step('a'), step('b')];
    const edges = [edge('a', 'b')];

    expect(getAutomationMoveBlock('a', steps, edges)).toBe(
      'O primeiro passo não pode mudar de lugar.',
    );
  });

  it('bloqueia um passo que divide caminhos', () => {
    const steps = [step('a'), step('b'), step('c'), step('d')];
    const edges = [edge('a', 'b'), edge('b', 'c', 'answered'), edge('b', 'd', 'timeout', 1)];

    expect(getAutomationMoveBlock('b', steps, edges)).toBe(
      'Um passo que divide caminhos não pode ser movido — moveria a árvore inteira junto.',
    );
  });

  it('exclui a aresta de entrada, a saída e toda a subárvore do passo', () => {
    const steps = ['a', 'b', 'c', 'd', 'e'].map((key) => step(key));
    const incoming = edge('a', 'b');
    const own = edge('b', 'c');
    const subtree = edge('c', 'd');
    const valid = edge('a', 'e', 'failed', 1);
    const edges = [incoming, own, subtree, valid];

    expect(eligibleAutomationMoveTargets('b', steps, edges)).toEqual([valid]);
  });

  it('extrai um passo linear e o reinsere no meio da aresta escolhida', () => {
    const steps = ['a', 'b', 'c', 'x', 'y'].map((key) => step(key));
    const edges = [
      edge('a', 'b'),
      edge('b', 'c'),
      edge('x', 'y'),
    ];

    const moved = moveAutomationStep({
      stepKey: 'b',
      targetEdge: edges[2],
      steps,
      edges,
    });

    expect(moved.steps).toEqual(steps);
    expect(moved.edges).toEqual(expect.arrayContaining([
      edge('a', 'c'),
      edge('x', 'b'),
      edge('b', 'y'),
    ]));
    expect(moved.edges).toHaveLength(3);
    expect(edges).toEqual([edge('a', 'b'), edge('b', 'c'), edge('x', 'y')]);
  });

  it('ao mover uma folha de caminho do switch preserva a aresta com placeholder', () => {
    const caseId = '11111111-1111-4111-8111-111111111111';
    const steps = [
      step('a'),
      step('s', 'switch'),
      step('n'),
      step('x'),
      step('y'),
    ];
    const switchEdge = edge('s', 'n', `case:${caseId}`);
    const target = edge('x', 'y');
    const edges = [edge('a', 's'), switchEdge, target];

    const moved = moveAutomationStep({
      stepKey: 'n',
      targetEdge: target,
      steps,
      edges,
      createStepKey: () => 'placeholder',
    });

    expect(moved.steps).toContainEqual({
      stepKey: 'placeholder',
      stepType: 'create_task',
      sortKey: expect.any(Number),
      config: { title: 'Configurar este caminho' },
    });
    expect(moved.edges).toEqual(expect.arrayContaining([
      edge('s', 'placeholder', `case:${caseId}`),
      edge('x', 'n'),
      edge('n', 'y'),
    ]));
    expect(moved.edges).not.toContainEqual(switchEdge);
  });

  it('não apaga nenhum caminho ao mover a folha de outra bifurcação', () => {
    const steps = [
      step('r', 'wait_for_event'),
      step('n'),
      step('o'),
      step('x'),
      step('y'),
    ];
    const answered = edge('r', 'n', 'answered');
    const target = edge('x', 'y');
    const edges = [answered, edge('r', 'o', 'timeout', 1), target];

    const moved = moveAutomationStep({
      stepKey: 'n',
      targetEdge: target,
      steps,
      edges,
      createStepKey: () => 'placeholder-respondeu',
    });

    expect(moved.edges).toContainEqual(edge(
      'r',
      'placeholder-respondeu',
      'answered',
    ));
    expect(moved.steps).toContainEqual(expect.objectContaining({
      stepKey: 'placeholder-respondeu',
    }));
  });

  it('ao mover uma folha linear remove somente sua antiga aresta de entrada', () => {
    const steps = ['a', 'n', 'x', 'y'].map((key) => step(key));
    const edges = [edge('a', 'n'), edge('x', 'y')];

    const moved = moveAutomationStep({
      stepKey: 'n',
      targetEdge: edges[1],
      steps,
      edges,
    });

    expect(moved.steps).toEqual(steps);
    expect(moved.edges).toEqual([edge('x', 'n'), edge('n', 'y')]);
  });
});

describe('exclusão pura do grafo da automação', () => {
  it('remove um passo do meio e religa o anterior no sucessor', () => {
    const steps = ['a', 'b', 'c'].map((key) => step(key));
    const edges = [edge('a', 'b'), edge('b', 'c')];

    const result = removeAutomationStep({ stepKey: 'b', steps, edges });

    expect(result.steps.map((s) => s.stepKey)).toEqual(['a', 'c']);
    expect(result.edges).toEqual([edge('a', 'c')]);
  });

  it('remove o último passo de uma linha reta encerrando o caminho no anterior', () => {
    const steps = ['a', 'b'].map((key) => step(key));
    const edges = [edge('a', 'b')];

    const result = removeAutomationStep({ stepKey: 'b', steps, edges });

    expect(result.steps.map((s) => s.stepKey)).toEqual(['a']);
    expect(result.edges).toEqual([]);
  });

  it('permite remover o primeiro passo — o sucessor vira a nova entrada', () => {
    const steps = ['a', 'b'].map((key) => step(key));
    const edges = [edge('a', 'b')];

    const result = removeAutomationStep({ stepKey: 'a', steps, edges });

    expect(result.steps.map((s) => s.stepKey)).toEqual(['b']);
    expect(result.edges).toEqual([]);
  });

  it('bloqueia excluir um passo que divide caminhos', () => {
    const steps = ['a', 'b', 'c', 'd'].map((key) => step(key));
    const edges = [edge('a', 'b'), edge('b', 'c', 'answered'), edge('b', 'd', 'timeout', 1)];

    expect(getAutomationRemoveBlock('b', steps, edges)).toBe(
      'Um passo que divide caminhos não pode ser excluído — exclua ou mova antes os passos dos caminhos dele.',
    );
    expect(() => removeAutomationStep({ stepKey: 'b', steps, edges })).toThrow();
  });

  it('bloqueia excluir o único passo de um caminho ramificado', () => {
    const steps = ['a', 'b', 'c'].map((key) => step(key));
    const edges = [edge('a', 'b', 'answered'), edge('a', 'c', 'timeout', 1)];

    expect(getAutomationRemoveBlock('b', steps, edges)).toBe(
      'Este é o único passo deste caminho — cada caminho precisa de pelo menos um. Edite este passo ou remova o caminho no passo que divide.',
    );
  });

  it('bloqueia excluir o último passo da automação', () => {
    const steps = [step('a')];

    expect(getAutomationRemoveBlock('a', steps, [])).toBe(
      'A automação precisa de pelo menos um passo.',
    );
  });
});
