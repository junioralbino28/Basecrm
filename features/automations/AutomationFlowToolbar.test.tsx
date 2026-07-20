import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AutomationWorkspaceItem } from '@/lib/automations/workspace';
import { AutomationFlowToolbar } from './AutomationFlowToolbar';

function automation(
  id: string,
  name: string,
  tag: string,
): AutomationWorkspaceItem {
  return {
    id,
    name,
    lifecycleStatus: 'draft',
    deliveryMode: 'simulation',
    triggerConfig: { tag },
    draftRevision: 1,
    publishedVersionId: null,
    updatedAt: '2026-07-20T00:00:00.000Z',
    steps: [],
    edges: [],
  };
}

describe('AutomationFlowToolbar', () => {
  it('seleciona a automação no topo e mostra etiqueta legada sem campo livre', () => {
    const onSelect = vi.fn();
    const automations = [
      automation('a', 'Facetas — follow-up', 'lentes'),
      automation('b', 'Ortodontia', 'ortodontia'),
    ];
    render(
      <AutomationFlowToolbar
        automations={automations}
        selected={automations[0]}
        onSelect={onSelect}
        actions={<button type="button">Salvar</button>}
      />,
    );

    fireEvent.change(screen.getByLabelText('Automação'), {
      target: { value: 'b' },
    });
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(screen.getByText('lentes')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /tag|etiqueta/i })).not.toBeInTheDocument();
  });

  it('expõe uma fronteira substituível quando a entidade ainda não existe', () => {
    const selected = automation('a', 'Fluxo novo', '');
    render(
      <AutomationFlowToolbar
        automations={[selected]}
        selected={selected}
        onSelect={vi.fn()}
        actions={null}
      />,
    );

    expect(screen.getByTestId('service-tag-trigger-boundary')).toHaveAttribute(
      'data-trigger-contract',
      'service-tag-entity-v3',
    );
    expect(screen.getByText(/gatilho de serviço ainda não selecionado/i))
      .toBeInTheDocument();
  });
});
