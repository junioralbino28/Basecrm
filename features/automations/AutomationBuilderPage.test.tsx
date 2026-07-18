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

    expect(await screen.findByRole('heading', { name: 'Boas-vindas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gatilho' })).toBeInTheDocument();
    expect(screen.getByText('Passo 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Mensagem do passo 1')).toBeInTheDocument();
    expect(screen.getByText(/Se o envio falhar/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar passo após 1' }));
    const actionDialog = screen.getByRole('dialog', { name: 'Adicionar ação' });
    fireEvent.change(within(actionDialog).getByLabelText('Buscar ação'), {
      target: { value: 'resposta' },
    });
    fireEvent.click(within(actionDialog).getByRole('button', { name: /Aguardar resposta/i }));

    await waitFor(() => {
      expect(screen.getByText('Passo 2')).toBeInTheDocument();
    });
    expect(screen.getByText(/Se respondeu/)).toBeInTheDocument();
    expect(screen.getByText(/Se não respondeu/)).toBeInTheDocument();
  });
});
