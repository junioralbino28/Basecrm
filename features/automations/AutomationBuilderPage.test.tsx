import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// C2C: o gatilho agora usa permissão (tags.manage) e catálogo de etiquetas.
vi.mock('@/lib/auth/useHasPermission', () => ({
  useHasPermission: () => true,
}));
vi.mock('@/lib/supabase/dealTags', () => ({
  dealTagsService: {
    getCatalog: vi.fn().mockResolvedValue({ categories: [], tags: [], error: null }),
    createTag: vi.fn(),
  },
}));

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
      if (url.endsWith(`/automations/${AUTOMATION_ID}`) && init?.method === 'PATCH') {
        const saved = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          automation: {
            id: AUTOMATION_ID,
            lifecycleStatus: 'draft',
            deliveryMode: 'simulation',
            draftRevision: 1,
            ...saved,
          },
        });
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

    fireEvent.click(screen.getByRole('button', {
      name: 'Adicionar passo após Retomar conversa após resposta',
    }));
    const divideDialog = screen.getByRole('dialog', { name: 'Adicionar ação' });
    fireEvent.change(within(divideDialog).getByLabelText('Buscar ação'), {
      target: { value: 'dividir' },
    });
    fireEvent.click(within(divideDialog).getByRole('button', { name: /Dividir caminho/i }));

    expect(await screen.findByText(/o primeiro caminho compatível vence/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Campo de comparação')).toHaveValue('contact.phone');
    expect(screen.getByLabelText('Nome do caminho 1')).toHaveValue('Caminho 1');
    expect(screen.getByLabelText('Nome do caminho final')).toHaveValue(
      'Para quem não se encaixa',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar caminho' }));
    expect(screen.getByLabelText('Nome do caminho 2')).toHaveValue('Caminho 2');

    fireEvent.change(screen.getByLabelText('Valor do caminho 1'), {
      target: { value: '11' },
    });
    fireEvent.change(screen.getByLabelText('Valor do caminho 2'), {
      target: { value: '21' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Rascunho salvo.')).toBeInTheDocument();

    const saveCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input).endsWith(`/automations/${AUTOMATION_ID}`)
      && init?.method === 'PATCH'
    ));
    const savedBody = JSON.parse(String(saveCall?.[1]?.body));
    const savedSwitch = savedBody.steps.find(
      (step: { stepType: string }) => step.stepType === 'switch',
    );
    const caseIds = savedSwitch.config.cases.map(
      (item: { case_id: string }) => item.case_id,
    );
    expect(new Set(caseIds).size).toBe(2);
    expect(caseIds).toEqual([
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    ]);
    expect(savedBody.edges
      .filter((edge: { fromStepKey: string }) => edge.fromStepKey === savedSwitch.stepKey)
      .map((edge: { outcome: string }) => edge.outcome)
      .sort()).toEqual([
        `case:${caseIds[0]}`,
        `case:${caseIds[1]}`,
        'otherwise',
      ].sort());
  });
});

describe('AutomationBuilderPage — salvamento automático', () => {
  const existing = {
    id: AUTOMATION_ID,
    name: 'Boas-vindas',
    lifecycleStatus: 'draft',
    deliveryMode: 'simulation',
    draftRevision: 1,
    triggerConfig: { tag_id: null },
    steps: [{
      stepKey: STEP_ID,
      stepType: 'send_message',
      sortKey: 0,
      config: {
        link_mode: 'copied',
        body_local: 'Oi',
        message_kind: 'text',
        channel: 'whatsapp',
      },
    }],
    edges: [],
  };

  function stubWorkspace(onPatch: (body: Record<string, unknown>) => void) {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/automations') && (!init?.method || init.method === 'GET')) {
        return jsonResponse({
          automations: [existing],
          templates: [],
          testTargets: [],
          safeMode: { liveEnabled: false },
        });
      }
      if (url.endsWith(`/automations/${AUTOMATION_ID}`) && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        onPatch(body);
        return jsonResponse({
          automation: { ...existing, ...body, draftRevision: 2 },
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('não salva nada só por abrir a automação', async () => {
    const patches: Record<string, unknown>[] = [];
    stubWorkspace((body) => patches.push(body));

    render(
      <AutomationBuilderPage
        tenantId={TENANT_ID}
        tenantName="Conta demonstração"
        canEdit
        canOperate
      />,
    );

    expect(await screen.findByLabelText('Automação')).toHaveValue(AUTOMATION_ID);
    // Passa do tempo do autosave sem nenhuma edição: nada pode ter sido gravado.
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    expect(patches).toHaveLength(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('grava sozinho depois da edição e mostra o selo Salvo', async () => {
    const patches: Record<string, unknown>[] = [];
    stubWorkspace((body) => patches.push(body));

    render(
      <AutomationBuilderPage
        tenantId={TENANT_ID}
        tenantName="Conta demonstração"
        canEdit
        canOperate
      />,
    );

    expect(await screen.findByLabelText('Automação')).toHaveValue(AUTOMATION_ID);
    const map = screen.getByRole('region', { name: 'Mapa da automação' });
    const messageStep = screen.getByRole('button', {
      name: /Envia · WhatsApp: Oi/i,
    });
    fireEvent.pointerDown(messageStep, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(map, { pointerId: 1, clientX: 10, clientY: 10 });

    fireEvent.change(screen.getByLabelText('Mensagem'), {
      target: { value: 'Oi, tudo bem?' },
    });

    // Enquanto não passa o tempo, avisa que ainda não guardou.
    expect(await screen.findByText('Alterações não salvas')).toBeInTheDocument();

    await waitFor(
      () => expect(patches).toHaveLength(1),
      { timeout: 4_000 },
    );
    expect((patches[0].steps as { config: { body_local: string } }[])[0].config.body_local)
      .toBe('Oi, tudo bem?');
    expect(await screen.findByText('Salvo')).toBeInTheDocument();
  }, 10_000);
});
