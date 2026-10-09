import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const estado = vi.hoisted(() => ({ role: 'agency_admin' as string, loading: false }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile: { role: estado.role }, loading: estado.loading }),
}));
const navegar = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navegar, replace: navegar }) }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

import { TenantAgentsPage } from './TenantAgentsPage';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE = {
  id: '22222222-2222-4222-8222-222222222222',
  nome: 'Aurora',
  publicada: { id: 'v1', versao: 1, origem: 'migration', restauradaDe: null, nota: null, publicadaEm: '2026-10-07T04:51:00Z', publicadaPor: null },
  rascunhoPendente: true,
  numeros: [{ id: 'n1', nome: 'Comercial', temAgenda: true }],
};

function responder(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
  estado.role = 'agency_admin';
  estado.loading = false;
});
afterEach(() => vi.unstubAllGlobals());

describe('TenantAgentsPage', () => {
  it('quem não é da agência vê acesso restrito e nada é pedido', () => {
    estado.role = 'clinic_admin';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<TenantAgentsPage tenantId={TENANT} />);
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lista os agentes com a versão publicada, o rascunho pendente e os números', async () => {
    const fetchMock = vi.fn(() => responder({ cliente: { id: TENANT, nome: 'Cenno Hub' }, agentes: [AGENTE] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<TenantAgentsPage tenantId={TENANT} />);

    expect(await screen.findByText('Aurora')).toBeInTheDocument();
    expect(screen.getByText('Versão 1 publicada em 07/10/2026 às 01:51 pela migração')).toBeInTheDocument();
    expect(screen.getByText('Rascunho com mudanças')).toBeInTheDocument();
    expect(screen.getByText('Números: Comercial')).toBeInTheDocument();
    expect(screen.getByText(/Cenno Hub/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Aurora/ })).toHaveAttribute('href', `/platform/tenants/${TENANT}/agents/${AGENTE.id}`);
    expect(fetchMock).toHaveBeenCalledWith(`/api/platform/tenants/${TENANT}/agents`, expect.objectContaining({ credentials: 'include' }));
  });

  it('sem agentes mostra o estado vazio', async () => {
    vi.stubGlobal('fetch', vi.fn(() => responder({ cliente: { id: TENANT, nome: 'Cenno Hub' }, agentes: [] })));
    render(<TenantAgentsPage tenantId={TENANT} />);
    expect(await screen.findByText(/Nenhum agente neste cliente ainda/)).toBeInTheDocument();
  });

  it('falha ao carregar mostra o erro', async () => {
    vi.stubGlobal('fetch', vi.fn(() => responder({ error: 'Cliente não encontrado.' }, 404)));
    render(<TenantAgentsPage tenantId={TENANT} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cliente não encontrado.');
  });
});

describe('TenantAgentsPage: Novo agente (bloco 2)', () => {
  it('o botão abre o diálogo; criado, vai para o editor do agente novo', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === `/api/platform/tenants/${TENANT}/agents` && init?.method === 'POST') return responder({ agenteId: 'novo' }, 201);
      if (url === '/api/platform/agency/agent-templates') return responder({ modelos: [] });
      return responder({ cliente: { id: TENANT, nome: 'Cenno Hub' }, agentes: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TenantAgentsPage tenantId={TENANT} />);
    expect(await screen.findByText(/Nenhum agente neste cliente ainda/)).toBeInTheDocument();
    expect(screen.queryByText(/fase 2/)).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /Novo agente/ })[0]);
    fireEvent.change(await screen.findByLabelText('Nome do agente'), { target: { value: 'Atendente' } });
    await screen.findByText('Nenhum modelo ainda. Crie em Modelos de agente.');
    fireEvent.click(screen.getByRole('button', { name: /Criar/ }));
    await waitFor(() => expect(navegar).toHaveBeenCalledWith(`/platform/tenants/${TENANT}/agents/novo`));
  });
});
