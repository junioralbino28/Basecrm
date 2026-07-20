import React from 'react';
import { render, screen } from '@testing-library/react';
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
});
