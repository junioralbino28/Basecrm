import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationBuilderPage } from './AutomationBuilderPage';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AUTOMATION_ID = '22222222-2222-4222-8222-222222222222';
const STEP_ID = '33333333-3333-4333-8333-333333333333';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AutomationBuilderPage — percurso manual', () => {
  it('mantém gatilho e passos na mesma tela e explicita caminhos infelizes', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/automations') && (!init?.method || init.method === 'GET')) {
        return jsonResponse({
          automations: [],
          templates: [],
          testTargets: [],
          safeMode: { liveEnabled: false },
        });
      }
      if (url.endsWith('/automations') && init?.method === 'POST') {
        return jsonResponse({
          automation: {
            id: AUTOMATION_ID,
            name: 'Boas-vindas',
            lifecycleStatus: 'draft',
            deliveryMode: 'simulation',
            triggerConfig: { tag: '' },
            steps: [{
              stepKey: STEP_ID,
              stepType: 'send_message',
              sortKey: 0,
              config: {
                link_mode: 'copied',
                body_local: '',
                message_kind: 'text',
                channel: 'whatsapp',
              },
            }],
            edges: [],
          },
        }, 201);
      }
      throw new Error(`fetch inesperado: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AutomationBuilderPage
        tenantId={TENANT_ID}
        tenantName="Conta demonstração"
        canEdit
        canOperate
      />,
    );

    await screen.findByText('Nenhuma automação criada');
    fireEvent.click(screen.getByRole('button', { name: 'Nova automação' }));
    const createDialog = screen.getByRole('dialog', { name: 'Nova automação' });
    fireEvent.change(within(createDialog).getByLabelText('Nome da automação'), {
      target: { value: 'Boas-vindas' },
    });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Criar automação' }));

    expect(await screen.findByLabelText('Automação')).toHaveValue(AUTOMATION_ID);
    expect(screen.getByTestId('service-tag-trigger-boundary')).toHaveAttribute(
      'data-trigger-contract',
      'service-tag-entity-v3',
    );
    expect(screen.queryByLabelText('Nome da tag')).not.toBeInTheDocument();
    const map = screen.getByRole('region', { name: 'Mapa da automação' });
    const messageStep = screen.getByRole('button', {
      name: /Envia · WhatsApp: Mensagem sem conteúdo/i,
    });
    expect(messageStep).toHaveAttribute('data-depth', '0');
    expect(screen.queryByRole('region', { name: 'Edição do passo' })).not.toBeInTheDocument();

    fireEvent.pointerDown(messageStep, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(map, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    expect(screen.getByRole('region', { name: 'Edição do passo' })).toHaveAttribute(
      'data-dock-size',
      'tall',
    );
    expect(screen.getByLabelText('Mensagem')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Edição do passo' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {
      name: 'Adicionar passo após Mensagem sem conteúdo',
    }));
    const actionDialog = screen.getByRole('dialog', { name: 'Adicionar ação' });
    fireEvent.change(within(actionDialog).getByLabelText('Buscar ação'), {
      target: { value: 'resposta' },
    });
    fireEvent.click(within(actionDialog).getByRole('button', { name: /Aguardar resposta/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Espera resposta/i })).toBeInTheDocument();
    });
    expect(screen.getByText('respondeu')).toBeInTheDocument();
    expect(screen.getByText('não respondeu')).toBeInTheDocument();
  });
});
