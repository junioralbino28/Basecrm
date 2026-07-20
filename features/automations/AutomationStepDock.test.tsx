import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AutomationBuilderStep } from '@/lib/automations/builder';
import { AutomationStepDock } from './AutomationStepDock';

const sendStep: AutomationBuilderStep = {
  stepKey: 'mensagem',
  stepType: 'send_message',
  sortKey: 0,
  config: {
    body_local: 'Olá, tudo bem?',
    channel: 'whatsapp',
    link_mode: 'copied',
    message_kind: 'text',
  },
};

const delayStep: AutomationBuilderStep = {
  stepKey: 'espera',
  stepType: 'delay',
  sortKey: 1,
  config: { amount: 1, unit: 'days' },
};

function renderDock(
  step: AutomationBuilderStep | null,
  overrides: Partial<React.ComponentProps<typeof AutomationStepDock>> = {},
) {
  const props: React.ComponentProps<typeof AutomationStepDock> = {
    step,
    canEdit: true,
    templates: [],
    templateName: '',
    templateBody: '',
    templateBusy: false,
    onConfig: vi.fn(),
    onClose: vi.fn(),
    onApplyTemplate: vi.fn(),
    onTemplateNameChange: vi.fn(),
    onTemplateBodyChange: vi.fn(),
    onCreateTemplate: vi.fn(),
    ...overrides,
  };
  return { ...render(<AutomationStepDock {...props} />), props };
}

describe('AutomationStepDock', () => {
  it('fica escondida sem seleção e abre alta para mensagem com biblioteca inline', () => {
    const { rerender, props } = renderDock(null);
    expect(screen.queryByRole('region', { name: 'Edição do passo' })).not.toBeInTheDocument();

    rerender(<AutomationStepDock {...props} step={sendStep} />);

    expect(screen.getByRole('region', { name: 'Edição do passo' })).toHaveAttribute(
      'data-dock-size',
      'tall',
    );
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Olá, tudo bem?');
    expect(screen.getByRole('heading', { name: 'Biblioteca de mensagens' })).toBeInTheDocument();
  });

  it('abre baixa para espera e não mostra biblioteca', () => {
    renderDock(delayStep);

    expect(screen.getByRole('region', { name: 'Edição do passo' })).toHaveAttribute(
      'data-dock-size',
      'compact',
    );
    expect(screen.getByLabelText('Quantidade')).toHaveValue(1);
    expect(screen.queryByRole('heading', { name: 'Biblioteca de mensagens' }))
      .not.toBeInTheDocument();
  });

  it('fecha por botão e Esc', () => {
    const onClose = vi.fn();
    renderDock(sendStep, { onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Fechar edição' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('aplica mensagem salva no modo escolhido', () => {
    const onApplyTemplate = vi.fn();
    renderDock(sendStep, {
      onApplyTemplate,
      templates: [{
        id: 'template-1',
        name: 'Abertura',
        channel: 'whatsapp',
        body: 'Mensagem da biblioteca',
        revision: 1,
        updatedAt: '2026-07-20T00:00:00.000Z',
      }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copiar Abertura' }));
    expect(onApplyTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'template-1' }),
      'copied',
    );
  });

  it('orienta a primeira mensagem e explica por que salvar está desabilitado', () => {
    renderDock(sendStep);

    expect(screen.getByText(/salve a primeira mensagem abaixo/i)).toBeInTheDocument();
    expect(screen.getByText('Falta dar um nome e escrever a mensagem.'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });
});
