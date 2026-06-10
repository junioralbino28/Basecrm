// UI da call-list (F6 + adendo): buckets Atrasadas/Hoje/Próximas no estilo do
// mockup "Seguir hoje", com badge de cadência F1-F9 (fallback honesto), pill de
// tipo pra tasks, botões Ligar + WhatsApp + Feita por linha, empty state e axe.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/lib/a11y/test/a11y-utils';
import type { CallListBuckets } from '@/lib/utils/callList';
import { CallListTable } from './CallListTable';

const buckets: CallListBuckets = {
  overdue: [
    {
      kind: 'activity',
      activity: {
        id: 'a-overdue',
        dealId: 'deal-1',
        contactId: 'contact-1',
        dealTitle: 'Negócio 1',
        type: 'CALL',
        title: 'Ligar atrasado',
        date: '2026-06-09T09:00:00',
        user: { name: 'Eu', avatar: '' },
        completed: false,
      },
      contact: { id: 'contact-1', name: 'Fulano', email: 'f@x.com', phone: '+5511999999999', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
      cadenceStage: 'F4 · dia 4',
    },
  ],
  today: [
    {
      kind: 'task',
      task: {
        id: 't-hoje',
        contactId: 'contact-2',
        type: 'reminder',
        title: 'Retorno do raio-X',
        dueDate: '2026-06-10',
        dueTime: '15:00',
        status: 'open',
        juliaFirst: true,
      },
      contact: { id: 'contact-2', name: 'Bruna Castro', email: 'b@x.com', phone: '+5522999014452', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
    },
    {
      kind: 'task',
      task: {
        id: 't-geral',
        type: 'reminder',
        title: 'Conferir caixa de retorno',
        dueDate: '2026-06-10',
        status: 'open',
        juliaFirst: false,
      },
    },
  ],
  upcoming: [],
};

const emptyBuckets: CallListBuckets = { overdue: [], today: [], upcoming: [] };

describe('CallListTable', () => {
  it('renderiza as pendências com nome, badge e botões de ação', () => {
    render(<CallListTable buckets={buckets} onCall={vi.fn()} onMarkDone={vi.fn()} />);

    expect(screen.getByText('Fulano')).toBeTruthy();
    expect(screen.getByText('Ligar atrasado')).toBeTruthy();
    expect(screen.getByText('Atrasadas')).toBeTruthy();
    expect(screen.getByText('Hoje')).toBeTruthy();
    // Etiqueta de cadência F1-F9 (só onde o controller resolveu estágio F).
    expect(screen.getByText('F4 · dia 4')).toBeTruthy();
    // Task: pill de tipo + paciente — motivo (2 tasks reminder no fixture).
    expect(screen.getAllByText('lembrete')).toHaveLength(2);
    expect(screen.getByText('Bruna Castro')).toBeTruthy();
    expect(screen.getByText('Retorno do raio-X')).toBeTruthy();
    expect(screen.getByRole('button', { name: /ligar para fulano/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /marcar ligar atrasado como feita/i })).toBeTruthy();
    // Adendo (d): botão WhatsApp por linha (link wa.me com número limpo).
    const wa = screen.getByRole('link', { name: /whatsapp de fulano/i }) as HTMLAnchorElement;
    expect(wa.href).toBe('https://wa.me/5511999999999');
  });

  it('linha sem contato/telefone não mostra Ligar nem WhatsApp (não inventa número)', () => {
    render(<CallListTable buckets={buckets} onCall={vi.fn()} onMarkDone={vi.fn()} />);

    expect(screen.getByText('Conferir caixa de retorno')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ligar para conferir/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /whatsapp de conferir/i })).toBeNull();
    expect(
      screen.getByRole('button', { name: /marcar conferir caixa de retorno como feita/i })
    ).toBeTruthy();
  });

  it('mostra estado vazio quando não há pendências', () => {
    render(<CallListTable buckets={emptyBuckets} onCall={vi.fn()} onMarkDone={vi.fn()} />);
    expect(screen.getByText('Nenhuma ligação pendente por aqui.')).toBeTruthy();
  });

  it('dispara onCall e onMarkDone ao clicar nos botões', async () => {
    const user = userEvent.setup();
    const onCall = vi.fn();
    const onMarkDone = vi.fn();
    render(<CallListTable buckets={buckets} onCall={onCall} onMarkDone={onMarkDone} />);

    await user.click(screen.getByRole('button', { name: /ligar para fulano/i }));
    expect(onCall).toHaveBeenCalledWith(buckets.overdue[0]);

    await user.click(screen.getByRole('button', { name: /marcar ligar atrasado como feita/i }));
    expect(onMarkDone).toHaveBeenCalledWith(buckets.overdue[0]);
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(
      <CallListTable buckets={buckets} onCall={vi.fn()} onMarkDone={vi.fn()} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
