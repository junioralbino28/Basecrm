import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
