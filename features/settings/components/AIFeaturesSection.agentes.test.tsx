import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'agency_admin' } }) }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ aiFeatureFlags: {}, setAIFeatureFlag: vi.fn() }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: toast, showToast: toast }) }));

import { AIFeaturesSection } from './AIFeaturesSection';

const ORG = '11111111-1111-4111-8111-111111111111';
const CHAVE = 'task_conversations_whatsapp_auto_reply';

function responder(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
}

function abrirAtendimentoWhatsApp(fetchMock: ReturnType<typeof vi.fn>) {
  render(<AIFeaturesSection />);
  // "Atendimento WhatsApp" é a 7ª linha de FEATURES (AIFeaturesSection.tsx); a URL pedida confirma a linha.
  fireEvent.click(screen.getAllByRole('button', { name: 'Editar prompt' })[6]);
  expect(fetchMock).toHaveBeenCalledWith(`/api/settings/ai-prompts/${CHAVE}`, expect.anything());
}

beforeEach(() => toast.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('Central de I.A — números da chave com agente', () => {
  it('todos com agente: aviso com link no lugar do editor, sem Salvar nem Reset', async () => {
    const fetchMock = vi.fn(() => responder({
      key: CHAVE, active: null, versions: [],
      agentes: { organizationId: ORG, numerosDaChave: 1, numerosComAgente: 1, agentes: [{ id: 'a1', nome: 'Julia' }] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    abrirAtendimentoWhatsApp(fetchMock);

    expect(await screen.findByText(/O número que usa este prompt responde por um agente da Central de Agentes/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Editar Julia na Central de Agentes' })).toHaveAttribute('href', `/platform/tenants/${ORG}/agents/a1`);
    expect(screen.queryByPlaceholderText('Cole ou edite o prompt aqui...')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset/ })).toBeNull();
  });

  it('só alguns com agente: avisa que a edição vale para os outros e mantém o editor', async () => {
    const fetchMock = vi.fn(() => responder({
      key: CHAVE, active: null, versions: [],
      agentes: { organizationId: ORG, numerosDaChave: 3, numerosComAgente: 1, agentes: [{ id: 'a1', nome: 'Julia' }] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    abrirAtendimentoWhatsApp(fetchMock);

    expect(await screen.findByText('1 de 3 números que usam este prompt respondem por um agente. Esta edição vale só para os outros 2.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Cole ou edite o prompt aqui...')).toBeInTheDocument();
  });

  it('nenhum com agente: o editor de sempre, sem aviso', async () => {
    const fetchMock = vi.fn(() => responder({
      key: CHAVE, active: null, versions: [],
      agentes: { organizationId: ORG, numerosDaChave: 2, numerosComAgente: 0, agentes: [] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    abrirAtendimentoWhatsApp(fetchMock);

    expect(await screen.findByPlaceholderText('Cole ou edite o prompt aqui...')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a contagem falhou: avisa e fecha o editor', async () => {
    const fetchMock = vi.fn(() => responder({ error: 'Não foi possível conferir agora.' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    abrirAtendimentoWhatsApp(fetchMock);

    await waitFor(() => expect(toast).toHaveBeenCalledWith('Não foi possível conferir agora.', 'error'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
