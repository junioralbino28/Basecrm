import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Espião compartilhado de TODAS as mutations da página (uma só basta pra
// afirmar o payload de mark_as_read do auto-marcar-lida).
const mutateSpy = vi.hoisted(() => vi.fn());
const refetchInboxSpy = vi.hoisted(() => vi.fn());
const searchParamsState = vi.hoisted(() => ({ query: '' }));

const TENANT = '11111111-1111-4111-8111-111111111111';
const RECEPTION = '22222222-2222-4222-8222-222222222222';
const COMMERCIAL = '33333333-3333-4333-8333-333333333333';

const threads: ReturnType<typeof thread>[] = [];
function resetThreads(overrides?: { firstUnread?: number }) {
  threads.length = 0;
  const primeiro = thread('thread-reception', 'Paciente Recepção', RECEPTION);
  primeiro.unread_count = overrides?.firstUnread ?? 0;
  threads.push(
    primeiro,
    thread('thread-commercial', 'Paciente Comercial', COMMERCIAL),
    thread('thread-removed', 'Paciente Histórico', null),
  );
}
resetThreads();
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

// Handoff de reunião marcada, no formato que a rota grava em `metadata.lastHandoff`.
const MEETING_HANDOFF = {
  type: 'meeting_confirmed',
  eventId: '44444444-4444-4444-8444-444444444444',
  summary: 'Quer revisar anúncios e o atendimento comercial.',
  reason: 'Pediu uma reunião.',
  requestedAt: '2026-07-16T12:00:00.000Z',
  requestedScheduleAt: '2026-07-20T17:00:00.000Z',
  requestedScheduleText: 'segunda às 14h',
  scheduleStatus: 'confirmed',
  scheduleUpdatedAt: '2026-07-16T12:30:00.000Z',
  scheduleUpdatedBy: '55555555-5555-4555-8555-555555555555',
  contactName: 'Paciente Recepção',
  contactPhone: '5511999990000',
};

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
              assignees: [{ id: 'user-1', display_name: 'Ana Souza', email: null, avatar_url: null }],
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
            isFetching: false,
            error: null,
            refetch: refetchInboxSpy,
          };
    },
    useMutation: () => ({
      mutate: (vars: unknown, opts?: { onSettled?: () => void }) => {
        mutateSpy(vars);
        opts?.onSettled?.();
      },
      isPending: false,
    }),
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
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchParamsState.query),
}));
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
}));
vi.mock('@/components/ConfirmModal', () => ({ default: () => null }));
// O painel de funil/etiquetas/origem tem teste proprio (ConversationDealPanel.test.tsx) e
// depende do contexto de organizacao; aqui so provamos que a tela o monta com o tenant e o
// negocio CERTOS — o comportamento dele e assunto do teste dele.
vi.mock('./conversations/ConversationDealPanel', () => ({
  ConversationDealPanel: (p: { organizationId: string; dealId: string | null }) => (
    <div data-testid="painel-negocio" data-org={p.organizationId} data-deal={p.dealId ?? 'sem-negocio'} />
  ),
}));

import { TenantConversationsPage } from './TenantConversationsPage';

beforeEach(() => {
  mutateSpy.mockClear();
  searchParamsState.query = '';
  resetThreads();
});

describe('TenantConversationsPage — caixa unificada', () => {
  it('abrir conversa com não-lidas MARCA como lida sozinha (regra do Junior 28/07)', async () => {
    // Antes só existia o botão manual "Marcar lida" — a bolinha do menu ficava
    // parada mesmo com a conversa escancarada na tela.
    resetThreads({ firstUnread: 2 });
    render(<TenantConversationsPage />);

    await waitFor(() => {
      expect(mutateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-reception',
          body: { mark_as_read: true },
        }),
      );
    });
  });

  it('conversa aberta SEM não-lidas não dispara marcação nenhuma', () => {
    render(<TenantConversationsPage />);
    expect(mutateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: { mark_as_read: true } }),
    );
  });

  it('abre diretamente a conversa indicada pelo alerta de handoff', async () => {
    searchParamsState.query = 'thread=thread-commercial';
    threads[1].unread_count = 1;

    render(<TenantConversationsPage />);

    await waitFor(() => {
      expect(mutateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-commercial',
          body: { mark_as_read: true },
        }),
      );
    });
  });

  it('a qualificacao NAO ocupa a area das mensagens: so aparece ao clicar (Junior, 23/09)', () => {
    // Ele reprovou o painel fixo: "colocou no pior lugar possivel, faz a conversa ficar com
    // uma janela minuscula". O painel passou a abrir por cima, pelo topo a direita.
    threads[0].deal_id = 'deal-da-conversa';
    render(<TenantConversationsPage />);

    expect(screen.queryByTestId('painel-negocio')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Funil e etiquetas/ }));
    const painel = screen.getByTestId('painel-negocio');
    expect(painel).toHaveAttribute('data-org', TENANT);
    expect(painel).toHaveAttribute('data-deal', 'deal-da-conversa');
  });

  it('clicar de novo fecha, devolvendo a tela inteira para a conversa', () => {
    render(<TenantConversationsPage />);
    const botao = screen.getByRole('button', { name: /Funil e etiquetas/ });

    fireEvent.click(botao);
    expect(screen.getByTestId('painel-negocio')).toBeInTheDocument();
    fireEvent.click(botao);
    expect(screen.queryByTestId('painel-negocio')).not.toBeInTheDocument();
  });

  it('a barra do cabecalho tem as quatro acoes como icone, cada uma com nome acessivel', () => {
    // Escolha do Junior (24/09, opcao B): as tres de toda conversa a um toque, o resto no menu.
    render(<TenantConversationsPage />);

    for (const nome of [/Funil e etiquetas/, /Responsável/, /Marcar como lida/, /Mais ações/]) {
      expect(screen.getByRole('button', { name: nome })).toBeInTheDocument();
    }
    // Um botao so de icone sem nome acessivel e invisivel para leitor de tela.
    expect(screen.getByRole('button', { name: /Mais ações/ }).textContent).toBe('');
  });

  it('o icone de pessoa abre o responsavel, e escolher alguem grava e fecha', () => {
    render(<TenantConversationsPage />);

    expect(screen.queryByLabelText('Responsável')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Responsável/ }));

    const select = screen.getByLabelText('Responsável') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'user-1' } });

    expect(mutateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ body: { assigned_user_id: 'user-1' } }),
    );
    expect(screen.queryByLabelText('Responsável')).not.toBeInTheDocument();
  });

  it('os tres pontinhos da LISTA abrem um menu — antes o botao nao fazia nada', () => {
    // O Junior clicou nele em 24/09 e nada acontecia: existia desde o espelho visual do
    // WhatsApp, sem onClick. Um botao morto faz a pessoa achar que errou o toque.
    render(<TenantConversationsPage />);

    refetchInboxSpy.mockClear();
    const botao = screen.getByRole('button', { name: /Mais opções da lista/ });
    expect(botao).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(botao);

    expect(botao).toHaveAttribute('aria-expanded', 'true');
    // Sem filtro ligado o item de limpar existe, mas desabilitado e dizendo o porque.
    expect(screen.getByRole('button', { name: /Sem filtros ativos/ })).toBeDisabled();

    // E "Atualizar lista" recarrega DE VERDADE — so estar na tela nao prova nada.
    fireEvent.click(screen.getByRole('button', { name: /Atualizar lista/ }));
    expect(refetchInboxSpy).toHaveBeenCalledTimes(1);
    expect(botao).toHaveAttribute('aria-expanded', 'false');
  });

  it('com filtro ligado, o menu da lista oferece limpar todos de uma vez', () => {
    render(<TenantConversationsPage />);

    fireEvent.click(screen.getByRole('button', { name: /Não lidas/ }));
    fireEvent.click(screen.getByRole('button', { name: /Mais opções da lista/ }));

    const limpar = screen.getByRole('button', { name: /Limpar filtros/ });
    expect(limpar).toBeEnabled();
    fireEvent.click(limpar);

    // Voltou ao estado sem filtro: o proprio item passa a dizer que nao ha o que limpar.
    fireEvent.click(screen.getByRole('button', { name: /Mais opções da lista/ }));
    expect(screen.getByRole('button', { name: /Sem filtros ativos/ })).toBeDisabled();
  });

  it('no celular mostra UM painel por vez: com conversa aberta, a lista sai de cena', () => {
    // Medido em 24/09/2026 num Galaxy S9+ (320px): a grade so tem colunas a partir de `xl`, entao
    // abaixo disso os dois paineis empilhavam dentro de um container recortado e a lista cobria o
    // cartao da conversa pela metade. Aqui vale a regra do WhatsApp.
    render(<TenantConversationsPage />);

    // Classe a classe, e nao `toContain`: "hidden" casa dentro de "overflow-hidden" e o teste
    // passaria verde com o painel visivel.
    const classes = (el: Element | null) => new Set(String(el?.className || '').split(/\s+/));
    const lista = classes(screen.getByText('Conversas').closest('section'));
    const conversa = classes(screen.getByRole('button', { name: /Funil e etiquetas/ }).closest('section'));

    expect(lista.has('hidden')).toBe(true);
    expect(lista.has('xl:flex')).toBe(true); // no desktop as duas colunas convivem
    expect(conversa.has('flex')).toBe(true);
    expect(conversa.has('hidden')).toBe(false);
  });

  it('no celular a conversa tem volta para a lista — senao vira beco sem saida', () => {
    render(<TenantConversationsPage />);

    const voltar = screen.getByRole('button', { name: /Voltar para a lista de conversas/i });
    expect(voltar.className).toContain('xl:hidden'); // no desktop a seta nao faz sentido

    fireEvent.click(voltar);

    expect(screen.getByText('Selecione uma conversa')).toBeInTheDocument();
    expect(screen.getByText('Conversas').closest('section')?.className).toContain('flex');
  });

  it('conversa sem negocio passa `sem-negocio` em vez de inventar um', () => {
    threads[0].deal_id = null;
    render(<TenantConversationsPage />);

    fireEvent.click(screen.getByRole('button', { name: /Funil e etiquetas/ }));
    expect(screen.getByTestId('painel-negocio')).toHaveAttribute('data-deal', 'sem-negocio');
  });

  it('cancelar a reunião pede confirmação e manda `cancel_meeting` uma vez só', () => {
    // A rota PATCH já aceitava `cancel_meeting`; o que faltava era botão na tela. Este teste
    // prova a ponta que o card não vê: o corpo que a página envia.
    threads[0].metadata = { lastHandoff: MEETING_HANDOFF };
    render(<TenantConversationsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reunião' }));
    expect(
      mutateSpy.mock.calls.filter(([vars]) => (vars as { body?: Record<string, unknown> })?.body?.handoff_action),
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));

    const acoesDeHandoff = mutateSpy.mock.calls.filter(
      ([vars]) => (vars as { body?: Record<string, unknown> })?.body?.handoff_action,
    );
    expect(acoesDeHandoff).toHaveLength(1);
    expect(acoesDeHandoff[0][0]).toEqual({
      threadId: 'thread-reception',
      body: { handoff_action: { type: 'cancel_meeting' } },
    });
  });

  it('handoff deixado pelo cancelamento não oferece mais ação de agenda nenhuma', () => {
    threads[0].metadata = {
      lastHandoff: {
        ...MEETING_HANDOFF,
        type: 'other',
        reason: 'meeting_cancelled',
        requestedScheduleAt: null,
        requestedScheduleText: null,
        scheduleStatus: null,
      },
    };
    render(<TenantConversationsPage />);

    expect(screen.getByText('Reunião cancelada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar reunião' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar horário' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajustar' })).not.toBeInTheDocument();
  });

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
