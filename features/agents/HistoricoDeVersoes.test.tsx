import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: toast, showToast: toast }) }));

import { HistoricoDeVersoes } from './HistoricoDeVersoes';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE_ID = '22222222-2222-4222-8222-222222222222';
const BASE = `/api/platform/tenants/${TENANT}/agents/${AGENTE_ID}`;
const VERSOES = [
  { id: 'v2', versao: 2, origem: 'publish', restauradaDe: null, nota: 'abertura nova', publicadaEm: '2026-10-07T15:00:00Z', publicadaPor: 'Junior' },
  { id: 'v1', versao: 1, origem: 'migration', restauradaDe: null, nota: null, publicadaEm: '2026-10-07T04:51:00Z', publicadaPor: null },
];
const COMPLETA = {
  1: { ...VERSOES[1], prompt: 'Oi\nlinha velha\nfim', ajustes: {}, modelo: null },
  2: { ...VERSOES[0], prompt: 'Oi\nlinha nova\nfim', ajustes: {}, modelo: null },
};

function responder(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
}

function fetchFalso(
  restaurar: () => Promise<Response>,
  extra: Record<string, () => Promise<Response>> = {},
) {
  return vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${String(url)}`;
    if (extra[chave]) return extra[chave]();
    if (chave === `GET ${BASE}/versions`) return responder({ versoes: VERSOES, temMais: false });
    if (chave === `GET ${BASE}/versions/1`) return responder({ versao: COMPLETA[1] });
    if (chave === `GET ${BASE}/versions/2`) return responder({ versao: COMPLETA[2] });
    if (chave === `POST ${BASE}/restore`) return restaurar();
    throw new Error(`fetch inesperado: ${chave}`);
  });
}

beforeEach(() => toast.mockClear());
afterEach(() => vi.unstubAllGlobals());

function montar(onMudou = vi.fn()) {
  render(<HistoricoDeVersoes tenantId={TENANT} agentId={AGENTE_ID} versaoPublicada={2} revisao={3} onMudou={onMudou} />);
  return onMudou;
}

describe('HistoricoDeVersoes', () => {
  it('lista as versões com autor, data e nota, e marca a publicada', async () => {
    vi.stubGlobal('fetch', fetchFalso(() => responder({})));
    montar();
    expect(await screen.findByText('Versão 2 publicada em 07/10/2026 às 12:00 por Junior')).toBeInTheDocument();
    expect(screen.getByText('Nota: abertura nova')).toBeInTheDocument();
    expect(screen.getByText('Versão 1 publicada em 07/10/2026 às 01:51 pela migração')).toBeInTheDocument();
    expect(screen.getByText('Publicada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restaurar a versão 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restaurar a versão 2' })).toBeNull();
  });

  it('compara duas versões linha a linha e diz que ajustes e modelo são iguais', async () => {
    vi.stubGlobal('fetch', fetchFalso(() => responder({})));
    montar();
    await screen.findByText(/Versão 2 publicada/);
    fireEvent.click(screen.getByLabelText('Comparar a versão 1'));
    fireEvent.click(screen.getByLabelText('Comparar a versão 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Comparar a versão 1 com a 2' }));

    expect(await screen.findByText('linha velha')).toHaveAttribute('data-tipo', 'removida');
    expect(screen.getByText('linha nova')).toHaveAttribute('data-tipo', 'adicionada');
    expect(screen.getByText('Ajustes e modelo iguais nas duas versões.')).toBeInTheDocument();
  });

  it('histórico longo: "Carregar versões anteriores" traz a página seguinte, e a versão antiga fica comparável e restaurável', async () => {
    const fetchMock = fetchFalso(() => responder({}), {
      [`GET ${BASE}/versions`]: () => responder({ versoes: [VERSOES[0]], temMais: true }),
      [`GET ${BASE}/versions?antesDe=2`]: () => responder({ versoes: [VERSOES[1]], temMais: false }),
    });
    vi.stubGlobal('fetch', fetchMock);
    montar();
    await screen.findByText(/Versão 2 publicada/);
    expect(screen.queryByRole('button', { name: 'Restaurar a versão 1' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Carregar versões anteriores' }));
    expect(await screen.findByRole('button', { name: 'Restaurar a versão 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Comparar a versão 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar versões anteriores' })).toBeNull();
  });

  it('texto grande demais para destacar: as duas versões aparecem lado a lado, inteiras', async () => {
    const linhas = (marca: string) => Array.from({ length: 2100 }, (_, i) => `${marca} ${i}`).join('\n');
    vi.stubGlobal('fetch', fetchFalso(() => responder({}), {
      [`GET ${BASE}/versions/1`]: () => responder({ versao: { ...COMPLETA[1], prompt: linhas('velha') } }),
      [`GET ${BASE}/versions/2`]: () => responder({ versao: { ...COMPLETA[2], prompt: linhas('nova') } }),
    }));
    montar();
    await screen.findByText(/Versão 2 publicada/);
    fireEvent.click(screen.getByLabelText('Comparar a versão 1'));
    fireEvent.click(screen.getByLabelText('Comparar a versão 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Comparar a versão 1 com a 2' }));

    expect(await screen.findByText(/grande demais para destacar linha a linha/)).toBeInTheDocument();
    expect(screen.getByLabelText('Texto da versão 1').textContent).toContain('velha 2099');
    expect(screen.getByLabelText('Texto da versão 2').textContent).toContain('nova 2099');
  });

  it('restaurar pede confirmação e manda a versão escolhida, a publicada e a revisão que a tela mostrou', async () => {
    const fetchMock = fetchFalso(() => responder({ versao: 3, versaoId: 'v3', revisao: 4 }));
    vi.stubGlobal('fetch', fetchMock);
    const onMudou = montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar a versão 1' }));

    expect(screen.getByText('Restaurar a versão 1?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));

    await waitFor(() => expect(onMudou).toHaveBeenCalled());
    const chamada = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/restore'));
    expect(JSON.parse(String(chamada?.[1]?.body))).toEqual({ versao: 1, versaoEsperada: 2, revisao: 3 });
    expect(toast).toHaveBeenCalledWith(
      'Versão 1 restaurada como versão 3. As respostas que começarem a partir de agora já saem com ela.',
      'success',
    );
  });

  it('enquanto a restauração não responde, nenhuma outra pode ser pedida (um POST só)', async () => {
    let soltar: (r: Response) => void = () => undefined;
    const pendente = new Promise<Response>((ok) => {
      soltar = ok;
    });
    const fetchMock = fetchFalso(() => pendente);
    vi.stubGlobal('fetch', fetchMock);
    const onMudou = montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar a versão 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));

    const botao = await screen.findByRole('button', { name: 'Restaurar a versão 1' });
    await waitFor(() => expect(botao).toBeDisabled());
    fireEvent.click(botao);
    expect(screen.queryByText('Restaurar a versão 1?')).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/restore'))).toHaveLength(1);

    soltar(new Response(JSON.stringify({ versao: 3, versaoId: 'v3', revisao: 4 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
  });

  it('restaurar quando outra versão foi publicada no meio (409): avisa e recarrega', async () => {
    vi.stubGlobal('fetch', fetchFalso(() => responder({ error: 'Outra versão foi publicada.', code: 'VERSAO_PUBLICADA_MUDOU' }, 409)));
    const onMudou = montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar a versão 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Outra versão foi publicada.', 'error'));
    expect(onMudou).toHaveBeenCalled();
  });
});
