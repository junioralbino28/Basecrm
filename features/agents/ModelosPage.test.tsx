import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const estado = vi.hoisted(() => ({ role: 'agency_admin' as string }));
const toast = vi.hoisted(() => vi.fn());
const navegar = vi.hoisted(() => vi.fn());
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: estado.role }, loading: false }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: toast, showToast: toast }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navegar, replace: navegar }) }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

import { ModelosPage } from './ModelosPage';
import { EditorDoModelo } from './EditorDoModelo';

/** Bloco 2 (PLAN-bloco-2.md, Task 6): a biblioteca de modelos e o editor do modelo. */
const ID = '22222222-2222-4222-8222-222222222222';
const MODELO = {
  id: ID,
  nome: 'Atendente de loja',
  descricao: 'Para lojas',
  revisao: 3,
  lacunas: ['[Nome da empresa]'],
  ambiguas: [],
  arquivado: false,
  atualizadoEm: '2026-10-09T13:00:00Z',
  atualizadoPor: 'Junior',
  agentesCriados: 2,
};

function responder(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
  estado.role = 'agency_admin';
  toast.mockReset();
  navegar.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('ModelosPage', () => {
  it('quem não é agência vê acesso restrito e nada é pedido', () => {
    estado.role = 'clinic_admin';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ModelosPage />);
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lista os modelos com lacunas, uso e autor; arquivados pede de novo com o filtro', async () => {
    const fetchMock = vi.fn(() => responder({ modelos: [MODELO] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ModelosPage />);
    expect(await screen.findByText('Atendente de loja')).toBeInTheDocument();
    expect(screen.getByText(/Lacunas: \[Nome da empresa\]/)).toBeInTheDocument();
    expect(screen.getByText(/usado em 2 agentes/)).toBeInTheDocument();
    expect(screen.getByText(/por Junior/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Atendente de loja/ })).toHaveAttribute('href', `/platform/agent-templates/${ID}`);
    expect(screen.getByRole('link', { name: /Novo modelo/ })).toHaveAttribute('href', '/platform/agent-templates/novo');
    fireEvent.click(screen.getByLabelText('Mostrar arquivados'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/api/platform/agency/agent-templates?arquivados=1', expect.objectContaining({ credentials: 'include' })),
    );
  });

  it('sem modelos mostra como começar', async () => {
    vi.stubGlobal('fetch', vi.fn(() => responder({ modelos: [] })));
    render(<ModelosPage />);
    expect(await screen.findByText(/Nenhum modelo ainda/)).toHaveTextContent('Salvar como modelo');
  });
});

describe('EditorDoModelo', () => {
  it('novo: mostra lacunas e ambíguas ao vivo, trava com variável desconhecida e cria pelo POST', async () => {
    const fetchMock = vi.fn(() => responder({ id: 'criado' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    render(<EditorDoModelo templateId="novo" />);
    const salvar = screen.getByRole('button', { name: /Criar modelo/ });
    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Loja' } });
    fireEvent.change(screen.getByLabelText('Texto do modelo'), { target: { value: 'Oi [Nome] {{naoExiste}} e [Nome](https://x)' } });
    expect(screen.getByText('[Nome]')).toBeInTheDocument();
    expect(screen.getByText(/não poderão ser respondidas: \[Nome\]/)).toBeInTheDocument();
    expect(screen.getByText(/não é uma das 12 variáveis/)).toBeInTheDocument();
    expect(salvar).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Texto do modelo'), { target: { value: 'Oi [Nome], da [Empresa].' } });
    expect(salvar).toBeEnabled();
    fireEvent.click(salvar);
    await waitFor(() => expect(navegar).toHaveBeenCalledWith('/platform/agent-templates/criado'));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/platform/agency/agent-templates');
    expect(JSON.parse(String(init.body))).toEqual({ nome: 'Loja', prompt: 'Oi [Nome], da [Empresa].' });
  });

  it('409 ao salvar: o texto digitado FICA, aparece a escolha, e "por cima" manda a revisão atual do servidor', async () => {
    const pedidos: Array<{ url: string; metodo: string; corpo: unknown }> = [];
    let leituras = 0;
    let puts = 0;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      if (metodo === 'GET') {
        leituras += 1;
        // A 1a leitura e a de quem abriu a tela; a 2a (depois do 409) traz o que a outra pessoa salvou.
        return leituras === 1
          ? responder({ ...MODELO, prompt: 'Oi [Nome da empresa]' })
          : responder({ ...MODELO, revisao: 4, prompt: 'Texto da outra pessoa' });
      }
      puts += 1;
      return puts === 1
        ? responder({ error: 'O modelo foi alterado por outra pessoa.', code: 'MODELO_MUDOU' }, 409)
        : responder({ id: ID, revisao: 5 });
    }));
    render(<EditorDoModelo templateId={ID} />);
    const texto = await screen.findByLabelText('Texto do modelo');
    fireEvent.change(texto, { target: { value: 'O meu texto novo' } });
    fireEvent.click(screen.getByRole('button', { name: /^Salvar$/ }));
    expect(await screen.findByText('O modelo foi alterado por outra pessoa. O seu texto continua aqui, sem salvar.')).toBeInTheDocument();
    await waitFor(() => expect(leituras).toBe(2));
    expect(screen.getByLabelText('Texto do modelo')).toHaveValue('O meu texto novo');
    expect(screen.getByRole('button', { name: /^Salvar$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Arquivar/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar o meu por cima' }));
    await waitFor(() => expect(puts).toBe(2));
    const enviados = pedidos.filter((p) => p.metodo === 'PUT').map((p) => (p.corpo as { revisaoEsperada: number; prompt: string }));
    expect(enviados.map((c) => [c.revisaoEsperada, c.prompt])).toEqual([[3, 'O meu texto novo'], [4, 'O meu texto novo']]);
  });

  it('409 ao salvar e "Descartar o meu": aí sim o texto vira o do servidor', async () => {
    let leituras = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        leituras += 1;
        return leituras === 1 ? responder({ ...MODELO, prompt: 'Oi' }) : responder({ ...MODELO, revisao: 4, prompt: 'Texto da outra pessoa' });
      }
      return responder({ error: 'O modelo foi alterado por outra pessoa.', code: 'MODELO_MUDOU' }, 409);
    }));
    render(<EditorDoModelo templateId={ID} />);
    fireEvent.change(await screen.findByLabelText('Texto do modelo'), { target: { value: 'O meu' } });
    fireEvent.click(screen.getByRole('button', { name: /^Salvar$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar o meu e ver o atual' }));
    expect(screen.getByLabelText('Texto do modelo')).toHaveValue('Texto da outra pessoa');
    expect(screen.queryByText(/O seu texto continua aqui/)).toBeNull();
  });

  it('com mudanças não salvas, Arquivar fica travado com o motivo e nada é enviado', async () => {
    const fetchMock = vi.fn(() => responder({ ...MODELO, prompt: 'Oi' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<EditorDoModelo templateId={ID} />);
    fireEvent.change(await screen.findByLabelText('Texto do modelo'), { target: { value: 'Oi, mudei' } });
    const arquivar = screen.getByRole('button', { name: /Arquivar/ });
    expect(arquivar).toBeDisabled();
    expect(arquivar).toHaveAttribute('title', 'Salve ou descarte as mudanças antes de arquivar.');
    fireEvent.click(arquivar);
    expect(fetchMock.mock.calls.every((c) => ((c as unknown as [string, RequestInit?])[1]?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('arquivado: campos travados e Restaurar manda arquivar=false com a revisão', async () => {
    const pedidos: Array<{ metodo: string; url: string; corpo: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      pedidos.push({ metodo, url, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      if (metodo === 'GET') return responder({ ...MODELO, arquivado: true, prompt: 'Oi' });
      return responder({ revisao: 4 });
    }));
    render(<EditorDoModelo templateId={ID} />);
    expect(await screen.findByText(/Este modelo está arquivado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Texto do modelo')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Salvar$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Restaurar/ }));
    await waitFor(() =>
      expect(pedidos.find((p) => p.metodo === 'POST')).toEqual({
        metodo: 'POST',
        url: `/api/platform/agency/agent-templates/${ID}/archive`,
        corpo: { arquivar: false, revisaoEsperada: 3 },
      }),
    );
  });
});
