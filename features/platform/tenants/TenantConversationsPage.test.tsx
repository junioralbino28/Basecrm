import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const RECEPTION = '22222222-2222-4222-8222-222222222222';
const COMMERCIAL = '33333333-3333-4333-8333-333333333333';

const threads = [
  thread('thread-reception', 'Paciente Recepção', RECEPTION),
  thread('thread-commercial', 'Paciente Comercial', COMMERCIAL),
  thread('thread-removed', 'Paciente Histórico', null),
];
const profile = { role: 'clinic_staff', first_name: 'Ana' };
const tenant = {
  id: TENANT,
  name: 'Clínica Teste',
  channel_connections: [
    { id: RECEPTION, name: 'Recepção', status: 'connected', config: {}, metadata: {} },
    { id: COMMERCIAL, name: 'Comercial', status: 'connected', config: {}, metadata: {} },
  ],
};
const access = {
  canAccessConversations: true,
  canReplyConversations: true,
  canAccessWhatsApp: false,
};
const reload = vi.fn();

function thread(id: string, contactName: string, channelConnectionId: string | null) {
  return {
    id,
    organization_id: TENANT,
    channel_connection_id: channelConnectionId,
    contact_id: null,
    deal_id: null,
    title: `WhatsApp - ${contactName}`,
    contact_name: contactName,
    contact_phone: '5511999990000',
    status: 'ai_active',
    assigned_user_id: null,
    last_message_at: '2026-07-16T12:00:00.000Z',
    created_at: '2026-07-16T12:00:00.000Z',
    updated_at: '2026-07-16T12:00:00.000Z',
    metadata: {},
    channel_connection: null,
    contact: null,
    deal: null,
    assignee: null,
    message_count: 1,
    unread_count: 0,
    last_message_preview: `Mensagem de ${contactName}`,
    last_message_direction: 'inbound',
    last_message_type: 'text',
    last_message_author: contactName,
    last_message_sent_at: '2026-07-16T12:00:00.000Z',
    needs_attention: false,
  };
}

vi.mock('@tanstack/react-query', () => ({
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const isMessages = queryKey.includes('messages');
      return isMessages
        ? { data: { messages: [] }, isLoading: false, error: null, refetch: vi.fn() }
        : {
            data: {
              threads,
              assignees: [],
              summary: {
                total: 3,
                ai_active: 3,
                human_queue: 0,
                human_active: 0,
                resolved: 0,
                closed: 0,
                unread: 0,
                unassigned: 3,
                needs_attention: 0,
              },
            },
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          };
    },
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
      removeQueries: vi.fn(),
    }),
}));
vi.mock('@/lib/query', () => ({
  queryKeys: {
    conversations: {
      list: () => ['conversations', 'list'],
      messages: (threadId: string) => ['conversations', threadId, 'messages'],
    },
    deals: { all: ['deals'] },
    contacts: { all: ['contacts'] },
  },
}));
vi.mock('./useTenantDetail', () => ({
  useTenantDetail: () => ({
    tenantId: TENANT,
    tenant,
    access,
    reload,
  }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile }),
}));
vi.mock('@/features/inbox/hooks/useQuickScripts', () => ({
  useQuickScripts: () => ({ scripts: [], isLoading: false }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
}));
vi.mock('@/components/ConfirmModal', () => ({ default: () => null }));

import { TenantConversationsPage } from './TenantConversationsPage';

describe('TenantConversationsPage — caixa unificada', () => {
  it('mostra todos os números, identifica a origem e filtra sem reutilizar o pareamento', () => {
    render(<TenantConversationsPage />);

    const selector = screen.getByRole('combobox', { name: 'Número do WhatsApp' });
    expect(selector).toHaveValue('all');
    expect(within(selector).getByRole('option', { name: 'Todos os números' })).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Recepção' })).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Comercial' })).toBeInTheDocument();
    expect(screen.getByText('Número removido')).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: COMMERCIAL } });

    expect(screen.getByRole('button', { name: /Paciente Comercial/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Paciente Recepção/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Paciente Histórico/ })).not.toBeInTheDocument();
  });
});
