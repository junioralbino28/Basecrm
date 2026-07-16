import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'clinic_admin',
  pathname: '/platform/tenants/11111111-1111-4111-8111-111111111111/whatsapp',
  reload: vi.fn(async () => undefined),
}));

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile: { role: state.role } }),
}));
vi.mock('./useTenantDetail', () => ({
  useTenantDetail: () => ({
    tenantId: TENANT,
    tenant: {
      id: TENANT,
      name: 'Clínica Teste',
      channel_connections: [{
        id: CONNECTION,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: 'Comercial Vitória',
        status: 'connected',
        config: {
          instanceName: 'comercial-vitoria-a1b2c3d4',
          apiUrl: 'https://evolution.example.com',
          sendMode: 'auto',
          aiEnabled: true,
        },
        metadata: { phoneNumber: '+55 11 99999-0000' },
        last_healthcheck_at: null,
        created_at: '2026-07-16T00:00:00.000Z',
        updated_at: '2026-07-16T00:00:00.000Z',
      }],
    },
    access: {
      canManageChannelConfig: true,
      canAccessWhatsApp: true,
      canAccessConversations: true,
      canReplyConversations: true,
    },
    loading: false,
    error: null,
    reload: state.reload,
  }),
}));
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label={title}><h2>{title}</h2>{children}</div> : null,
  ModalForm: (props: React.FormHTMLAttributes<HTMLFormElement>) => <form {...props} />,
}));
vi.mock('@/components/ConfirmModal', () => ({
  default: ({ isOpen, title, message, confirmText, onConfirm, onClose }: {
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    onConfirm: () => void;
    onClose: () => void;
  }) => isOpen ? (
    <div role="alertdialog" aria-label={title}>
      <div>{message}</div>
      <button type="button" onClick={() => { onConfirm(); onClose(); }}>{confirmText}</button>
    </div>
  ) : null,
}));

import { TenantChannelsPage } from './TenantChannelsPage';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'clinic_admin';
  state.pathname = `/platform/tenants/${TENANT}/whatsapp`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TenantChannelsPage — multi-numero', () => {
  it('mostra cadastro simples e lista operacional para admin da clinica, sem infraestrutura tecnica', () => {
    render(<TenantChannelsPage />);

    expect(screen.getByText('Comercial Vitória')).toBeInTheDocument();
    expect(screen.getByText('+55 11 99999-0000')).toBeInTheDocument();
    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reparear' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument();
    expect(screen.queryByText(/Instance:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/API URL:/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar número' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar número' });
    expect(within(dialog).getByLabelText('Nome de identificação')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Número')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Instance name/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/API URL/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Token/i)).not.toBeInTheDocument();
  });

  it('faz POST simples, chama connect e mostra o QR no proprio modal', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/tenants/${TENANT}/channels`) && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          channel: { id: '33333333-3333-4333-8333-333333333333' },
        }, 201);
      }
      if (url.endsWith('/channels/33333333-3333-4333-8333-333333333333/connect')) {
        return jsonResponse({
          ok: true,
          pairing: {
            qrBase64: 'data:image/png;base64,QR_MODAL',
            pairingCode: 'PAIR-MODAL',
          },
          webhook: { configured: true, warning: null },
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TenantChannelsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar número' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar número' });
    fireEvent.change(within(dialog).getByLabelText('Nome de identificação'), {
      target: { value: 'IA – Julia' },
    });
    fireEvent.change(within(dialog).getByLabelText('Número'), {
      target: { value: '+55 11 98888-0000' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gerar QR code' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const createInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(createInit.body))).toEqual({
      provider: 'evolution',
      channel_type: 'whatsapp',
      name: 'IA – Julia',
      metadata: { phoneNumber: '+55 11 98888-0000' },
    });
    expect(within(dialog).getByRole('img', { name: 'QR code do WhatsApp' })).toHaveAttribute(
      'src',
      'data:image/png;base64,QR_MODAL',
    );
    expect(within(dialog).getByText('PAIR-MODAL')).toBeInTheDocument();
  });

  it('confirma e chama DELETE para excluir o numero', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ ok: true, deleted: { id: CONNECTION } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<TenantChannelsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Excluir número' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Excluir número' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/platform/tenants/${TENANT}/channels/${CONNECTION}`,
      expect.objectContaining({ method: 'DELETE' }),
    ));
    expect(state.reload).toHaveBeenCalled();
  });

  it('preserva campos avancados recolhidos para agency admin na rota tecnica', () => {
    state.role = 'agency_admin';
    state.pathname = `/platform/tenants/${TENANT}/channels`;
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      defaults: { apiUrl: 'https://evolution.example.com', hasApiKey: true, apiKeyLast4: '1234' },
    })));

    render(<TenantChannelsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar número' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar número' });
    expect(within(dialog).getByText('Avançado')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/API URL/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Instance name/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Token/i)).toBeInTheDocument();
  });
});
