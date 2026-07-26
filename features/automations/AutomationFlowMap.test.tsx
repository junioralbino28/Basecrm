import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';
import { AutomationFlowMap } from './AutomationFlowMap';

const steps: AutomationBuilderStep[] = [
  {
    stepKey: 'raiz',
    stepType: 'wait_for_event',
    sortKey: 0,
    config: { timeout_amount: 1, timeout_unit: 'days' },
  },
  {
    stepKey: 'sim',
    stepType: 'send_message',
    sortKey: 1,
    config: { body_local: 'Vamos continuar', channel: 'whatsapp' },
  },
  {
    stepKey: 'nao',
    stepType: 'create_task',
    sortKey: 2,
    config: { title: 'Retomar manualmente' },
  },
];

const edges: AutomationBuilderEdge[] = [
  { fromStepKey: 'raiz', outcome: 'answered', toStepKey: 'sim', order: 0 },
  { fromStepKey: 'raiz', outcome: 'timeout', toStepKey: 'nao', order: 1 },
];

describe('AutomationFlowMap', () => {
  it('desenha cartões, curvas e condições da árvore calculada', () => {
    render(
      <AutomationFlowMap
        steps={steps}
        edges={edges}
        canEdit
        selectedStepKey={null}
        onStepActivate={vi.fn()}
        onAddAfter={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Mapa da automação' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Espera resposta/i })).toHaveAttribute(
      'data-depth',
      '0',
    );
    expect(screen.getByRole('button', {
      name: /^Envia · WhatsApp: Vamos continuar$/i,
    })).toHaveAttribute(
      'data-depth',
      '1',
    );
    expect(screen.getByText('respondeu')).toBeInTheDocument();
    expect(screen.getByText('não respondeu')).toBeInTheDocument();
    expect(document.querySelectorAll('path[data-edge-outcome]')).toHaveLength(2);
  });

  it('oferece adicionar apenas depois de folhas nesta fatia', () => {
    render(
      <AutomationFlowMap
        steps={steps}
        edges={edges}
        canEdit
        selectedStepKey={null}
        onStepActivate={vi.fn()}
        onAddAfter={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', {
      name: 'Adicionar passo após Até 1 dia',
    })).not.toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Adicionar passo após Vamos continuar',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Adicionar passo após Retomar manualmente',
    })).toBeInTheDocument();
  });

  it('mostra canal só em mensagem e prende a nota de falha ao cartão', () => {
    render(
      <AutomationFlowMap
        steps={steps}
        edges={edges}
        canEdit
        selectedStepKey={null}
        onStepActivate={vi.fn()}
        onAddAfter={vi.fn()}
      />,
    );
    const message = screen.getByRole('button', {
      name: /^Envia · WhatsApp: Vamos continuar$/i,
    });
    const wait = screen.getByRole('button', { name: /Espera resposta/i });

    expect(within(message).getByText('falha encerra')).toBeInTheDocument();
    expect(within(message).getByText(/WhatsApp/i)).toBeInTheDocument();
    expect(within(wait).queryByText(/WhatsApp/i)).not.toBeInTheDocument();
  });

  it('distingue clique curto no passo de arrasto iniciado sobre ele', () => {
    const onStepActivate = vi.fn();
    render(
      <AutomationFlowMap
        steps={steps}
        edges={edges}
        canEdit
        selectedStepKey={null}
        onStepActivate={onStepActivate}
        onAddAfter={vi.fn()}
      />,
    );
    const stage = screen.getByRole('region', { name: 'Mapa da automação' });
    const card = screen.getByRole('button', { name: /Espera resposta/i });

    fireEvent.pointerDown(card, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(stage, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    expect(onStepActivate).toHaveBeenCalledWith('raiz');

    onStepActivate.mockClear();
    fireEvent.pointerDown(card, {
      pointerId: 2,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(stage, {
      pointerId: 2,
      clientX: 120,
      clientY: 130,
    });
    fireEvent.pointerUp(stage, {
      pointerId: 2,
      clientX: 120,
      clientY: 130,
    });
    expect(onStepActivate).not.toHaveBeenCalled();
  });

  it('abre a edição no clique com o tremor natural da mão (não exige clique imóvel)', () => {
    const onStepActivate = vi.fn();
    render(
      <AutomationFlowMap
        steps={steps}
        edges={edges}
        canEdit
        selectedStepKey={null}
        onStepActivate={onStepActivate}
        onAddAfter={vi.fn()}
      />,
    );
    const stage = screen.getByRole('region', { name: 'Mapa da automação' });
    const card = screen.getByRole('button', { name: /Espera resposta/i });

    // Tremor de 10px (dx=6, dy=8) — passa do limiar de pan de 4px, mas continua
    // sendo um clique. Antes, isso caía como "movimento" e a doca não abria.
    fireEvent.pointerDown(card, { pointerId: 3, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 3, clientX: 106, clientY: 108 });
    fireEvent.pointerUp(stage, { pointerId: 3, clientX: 106, clientY: 108 });

    expect(onStepActivate).toHaveBeenCalledWith('raiz');
  });

  it('acende a linha mais próxima e pede a recostura ao soltar o passo', () => {
    const onMoveStep = vi.fn();
    const linearSteps: AutomationBuilderStep[] = [
      { ...steps[0], stepKey: 'root' },
      { ...steps[1], stepKey: 'moving' },
      { ...steps[2], stepKey: 'child' },
      { ...steps[2], stepKey: 'target', config: { title: 'Destino' } },
    ];
    const targetEdge: AutomationBuilderEdge = {
      fromStepKey: 'root',
      outcome: 'timeout',
      toStepKey: 'target',
      order: 1,
    };
    const linearEdges: AutomationBuilderEdge[] = [
      { fromStepKey: 'root', outcome: 'answered', toStepKey: 'moving', order: 0 },
      { fromStepKey: 'moving', outcome: 'success', toStepKey: 'child', order: 0 },
      targetEdge,
    ];
    render(
      <AutomationFlowMap
        steps={linearSteps}
        edges={linearEdges}
        canEdit
        selectedStepKey={null}
        onStepActivate={vi.fn()}
        onMoveStep={onMoveStep}
        onAddAfter={vi.fn()}
      />,
    );
    const stage = screen.getByRole('region', { name: 'Mapa da automação' });
    const card = screen.getByRole('button', { name: /Vamos continuar/i });

    fireEvent.pointerDown(card, {
      pointerId: 8,
      button: 0,
      clientX: 360,
      clientY: 70,
    });
    fireEvent.pointerMove(stage, {
      pointerId: 8,
      clientX: 282,
      clientY: 198,
    });

    expect(document.querySelector('path[data-drop-target="true"]')).toHaveAttribute(
      'data-edge-outcome',
      'timeout',
    );

    fireEvent.pointerUp(stage, {
      pointerId: 8,
      clientX: 282,
      clientY: 198,
    });
    expect(onMoveStep).toHaveBeenCalledWith('moving', targetEdge);
  });

  it('faz o cartão acompanhar o cursor enquanto arrasta', () => {
    // Sem isso a linha acende mas nada parece se mover — o Junior levou um tempo
    // para entender que o passo estava sendo arrastado (2026-07-22).
    const linearSteps: AutomationBuilderStep[] = [
      { ...steps[0], stepKey: 'root' },
      { ...steps[1], stepKey: 'moving' },
      { ...steps[2], stepKey: 'child' },
      { ...steps[2], stepKey: 'target', config: { title: 'Destino' } },
    ];
    const linearEdges: AutomationBuilderEdge[] = [
      { fromStepKey: 'root', outcome: 'answered', toStepKey: 'moving', order: 0 },
      { fromStepKey: 'moving', outcome: 'success', toStepKey: 'child', order: 0 },
      { fromStepKey: 'root', outcome: 'timeout', toStepKey: 'target', order: 1 },
    ];
    render(
      <AutomationFlowMap
        steps={linearSteps}
        edges={linearEdges}
        canEdit
        selectedStepKey={null}
        onStepActivate={vi.fn()}
        onMoveStep={vi.fn()}
        onAddAfter={vi.fn()}
      />,
    );
    const stage = screen.getByRole('region', { name: 'Mapa da automação' });
    const card = screen.getByRole('button', { name: /Vamos continuar/i });

    expect(card.style.transform).toBe('');

    fireEvent.pointerDown(card, { pointerId: 9, button: 0, clientX: 360, clientY: 70 });
    fireEvent.pointerMove(stage, { pointerId: 9, clientX: 300, clientY: 150 });

    expect(card.style.transform).toMatch(/^translate\(/);

    fireEvent.pointerUp(stage, { pointerId: 9, clientX: 300, clientY: 150 });
    expect(card.style.transform).toBe('');
  });

  it('avisa no palco assim que alguém tenta arrastar a raiz', () => {
    const onMoveStep = vi.fn();
    render(
      <AutomationFlowMap
        steps={steps}
        edges={edges}
        canEdit
        selectedStepKey={null}
        onStepActivate={vi.fn()}
        onMoveStep={onMoveStep}
        onAddAfter={vi.fn()}
      />,
    );
    const stage = screen.getByRole('region', { name: 'Mapa da automação' });
    const root = screen.getByRole('button', { name: /Espera resposta/i });

    fireEvent.pointerDown(root, { pointerId: 9, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 9, clientX: 120, clientY: 100 });

    expect(screen.getByRole('status')).toHaveTextContent(
      'O primeiro passo não pode mudar de lugar.',
    );
    expect(onMoveStep).not.toHaveBeenCalled();
  });

  it('mostra o botão de trocar direção e dispara o callback ao clicar', () => {
    const onToggleOrientation = vi.fn();
    render(
      <AutomationFlowMap
        steps={steps}
        edges={edges}
        canEdit
        selectedStepKey={null}
        orientation="vertical"
        onToggleOrientation={onToggleOrientation}
        onStepActivate={vi.fn()}
        onAddAfter={vi.fn()}
      />,
    );
    const toggle = screen.getByRole('button', {
      name: /Trocar direção do fluxo — ver na horizontal/i,
    });
    fireEvent.click(toggle);
    expect(onToggleOrientation).toHaveBeenCalledTimes(1);
  });

  it('esconde o botão de trocar direção quando não há callback', () => {
    render(
      <AutomationFlowMap
        steps={steps}
        edges={edges}
        canEdit
        selectedStepKey={null}
        onStepActivate={vi.fn()}
        onAddAfter={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /Trocar direção do fluxo/i }),
    ).not.toBeInTheDocument();
  });

  it('move somente pelo fundo e informa clique vazio', () => {
    const onBackgroundActivate = vi.fn();
    render(
      <AutomationFlowMap
        steps={steps}
        edges={edges}
        canEdit
        selectedStepKey={null}
        onStepActivate={vi.fn()}
        onBackgroundActivate={onBackgroundActivate}
        onAddAfter={vi.fn()}
      />,
    );
    const stage = screen.getByRole('region', { name: 'Mapa da automação' });
    const track = screen.getByTestId('automation-track');

    fireEvent.pointerDown(stage, {
      pointerId: 3,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(stage, {
      pointerId: 3,
      clientX: 35,
      clientY: 40,
    });
    fireEvent.pointerUp(stage, {
      pointerId: 3,
      clientX: 35,
      clientY: 40,
    });
    expect(track).toHaveStyle({ transform: 'translate(59px, 64px) scale(1)' });
    expect(onBackgroundActivate).not.toHaveBeenCalled();

    fireEvent.pointerDown(stage, {
      pointerId: 4,
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    fireEvent.pointerUp(stage, {
      pointerId: 4,
      clientX: 50,
      clientY: 50,
    });
    expect(onBackgroundActivate).toHaveBeenCalledTimes(1);
  });
});
