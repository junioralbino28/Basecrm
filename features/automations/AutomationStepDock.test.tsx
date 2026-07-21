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

const switchStep: AutomationBuilderStep = {
  stepKey: 'divide',
  stepType: 'switch',
  sortKey: 2,
  config: {
    field: 'contact.phone',
    cases: [
      {
        case_id: '11111111-1111-4111-8111-111111111111',
        label: 'Tem DDD 11',
        operator: 'contains',
        value: '11',
        order: 0,
      },
      {
        case_id: '22222222-2222-4222-8222-222222222222',
        label: 'Tem DDD 21',
        operator: 'contains',
        value: '21',
        order: 1,
      },
    ],
    fallback_label: 'Outro DDD',
  },
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
    moveTargets: [],
    moveBlockedMessage: null,
    onMove: vi.fn(),
    onAddSwitchCase: vi.fn(() => null),
    onRemoveSwitchCase: vi.fn(() => null),
    onMoveSwitchCase: vi.fn(() => null),
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

  it('oferece o mesmo mover-passo por teclado usando uma linha elegível', () => {
    const onMove = vi.fn();
    const target = {
      fromStepKey: 'inicio',
      outcome: 'success' as const,
      toStepKey: 'fim',
      order: 0,
    };
    renderDock(delayStep, {
      moveTargets: [{ edge: target, label: 'Entre Boas-vindas e Encerramento' }],
      onMove,
    });

    fireEvent.change(screen.getByLabelText('Mover passo para'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mover passo' }));

    expect(onMove).toHaveBeenCalledWith(target);
  });

  it('explica por que o passo selecionado não pode ser movido', () => {
    renderDock(delayStep, {
      moveBlockedMessage: 'O primeiro passo não pode mudar de lugar.',
    });

    expect(screen.getByText('O primeiro passo não pode mudar de lugar.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Mover passo para')).not.toBeInTheDocument();
  });

  it('edita caminhos em ordem visível sem trocar o case_id', () => {
    const onConfig = vi.fn();
    const onMoveSwitchCase = vi.fn(() => null);
    renderDock(switchStep, { onConfig, onMoveSwitchCase });

    expect(screen.getByText(/o primeiro caminho compatível vence/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nome do caminho 1'), {
      target: { value: 'São Paulo' },
    });
    expect(onConfig).toHaveBeenCalledWith(expect.objectContaining({
      cases: [
        expect.objectContaining({
          case_id: '11111111-1111-4111-8111-111111111111',
          label: 'São Paulo',
        }),
        expect.objectContaining({ case_id: '22222222-2222-4222-8222-222222222222' }),
      ],
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Mover caminho 2 para cima' }));
    expect(onMoveSwitchCase).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'up',
    );
    expect(screen.getByLabelText('Nome do caminho final')).toHaveValue('Outro DDD');
  });

  it('mostra na doca a orientação ao bloquear remoção com subárvore', () => {
    renderDock(switchStep, {
      onRemoveSwitchCase: vi.fn(() => (
        'Este caminho tem passos abaixo. Mova ou remova esses passos antes de apagar o caminho.'
      )),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remover caminho 1' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Este caminho tem passos abaixo. Mova ou remova esses passos antes de apagar o caminho.',
    );
  });

  it('mantém etiquetas na fronteira substituível da C2, sem texto livre', () => {
    renderDock({
      ...switchStep,
      config: { ...switchStep.config, field: 'deal.tags' },
    });

    expect(screen.getByTestId('service-tag-switch-boundary')).toHaveAttribute(
      'data-switch-contract',
      'service-tag-entity-v3',
    );
    expect(screen.getByLabelText('Regra do caminho 1')).toHaveValue('contains');
    expect(screen.queryByLabelText('Valor do caminho 1')).not.toBeInTheDocument();
  });

  it('explica o teto de 20 caminhos em português claro', () => {
    const firstCase = (switchStep.config.cases as Array<Record<string, unknown>>)[0];
    renderDock({
      ...switchStep,
      config: {
        ...switchStep.config,
        cases: Array.from({ length: 20 }, (_, index) => ({
          ...firstCase,
          case_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          label: `Caminho ${index + 1}`,
          order: index,
        })),
      },
    });

    expect(screen.getByText(
      'Limite de 20 caminhos atingido. Remova um caminho antes de adicionar outro.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar caminho' })).toBeDisabled();
  });
});
