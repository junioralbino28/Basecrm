// Nudge pop-up de tarefas (N3 — mockup): card dourado bottom-right que aparece
// a cada N minutos (intervalo configurado em organization_settings) com as
// tarefas de hoje em aberto. Snooze (+30 min) e fechar são ESTADO LOCAL.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { axe } from '@/lib/a11y/test/a11y-utils';
import type { Task } from '@/types';

const MINUTE = 60_000;

let mockInterval: number | null = 30;
let mockTasks: Task[] = [];
const pushMock = vi.fn();

const baseTasks: Task[] = [
  {
    id: 't-1',
    contactId: 'c-1',
    type: 'reminder',
    title: 'retorno do raio-X',
    dueDate: '2026-06-10',
    status: 'open',
    juliaFirst: true,
  },
  {
    id: 't-2',
    type: 'call',
    title: 'Carlos — ligar 15h',
    dueDate: '2026-06-09',
    status: 'open',
    juliaFirst: false,
  },
  {
    id: 't-futura',
    type: 'message',
    title: 'Ana — retomar contato',
    dueDate: '2026-06-22',
    status: 'open',
    juliaFirst: false,
  },
];

vi.mock('@/lib/query/hooks/useTasksQuery', () => ({
  useTasks: () => ({ data: mockTasks, isLoading: false }),
}));

vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useContacts: () => ({
    data: [
      { id: 'c-1', name: 'Bruna Castro', email: 'b@x.com', phone: '+5522999014452', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/lib/query/hooks/useOrganizationSettingsQuery', () => ({
  useTaskNudgeInterval: () => ({ data: mockInterval, isLoading: false }),
}));

vi.mock('@/components/navigation/useTenantScopedHref', () => ({
  useTenantScopedHrefBuilder: () => (href: string) => href,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { TaskNudge } from './TaskNudge';

describe('TaskNudge (N3 — pop-up de tarefas)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T09:00:00'));
    mockInterval = 30;
    mockTasks = baseTasks;
    pushMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aparece só depois do intervalo configurado, com contagem das tasks de hoje (inclui atrasadas, exclui futuras)', () => {
    render(<TaskNudge />);

    expect(screen.queryByText(/tarefas de hoje em aberto/i)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(30 * MINUTE);
    });

    expect(screen.getByText('2 tarefas de hoje em aberto')).toBeTruthy();
    // Resumo com nome do paciente (mockup) e rodapé com o intervalo.
    expect(screen.getByText(/Bruna Castro \(retorno do raio-X\)/)).toBeTruthy();
    expect(screen.getByText(/aviso a cada 30 min/i)).toBeTruthy();
  });

  it('"Ver tarefas" navega pra tela Tarefas (rota tenant-scoped) e fecha o card', () => {
    render(<TaskNudge />);
    act(() => {
      vi.advanceTimersByTime(30 * MINUTE);
    });

    fireEvent.click(screen.getByRole('button', { name: /ver tarefas/i }));
    expect(pushMock).toHaveBeenCalledWith('/tarefas');
    expect(screen.queryByText(/tarefas de hoje em aberto/i)).toBeNull();
  });

  it('"+30 min" adia (estado local): só volta quando o snooze vence', () => {
    mockInterval = 15;
    render(<TaskNudge />);

    act(() => {
      vi.advanceTimersByTime(15 * MINUTE);
    });
    expect(screen.getByText(/tarefas de hoje em aberto/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /\+30 min/i }));
    expect(screen.queryByText(/tarefas de hoje em aberto/i)).toBeNull();

    // Tick aos 30 min do mount (15 min de snooze decorridos) → segue adiado.
    act(() => {
      vi.advanceTimersByTime(15 * MINUTE);
    });
    expect(screen.queryByText(/tarefas de hoje em aberto/i)).toBeNull();

    // Tick aos 45 min (30 min após o snooze) → volta.
    act(() => {
      vi.advanceTimersByTime(15 * MINUTE);
    });
    expect(screen.getByText(/tarefas de hoje em aberto/i)).toBeTruthy();
  });

  it('fechar (X) esconde e o card volta no próximo tick do intervalo', () => {
    render(<TaskNudge />);
    act(() => {
      vi.advanceTimersByTime(30 * MINUTE);
    });

    fireEvent.click(screen.getByRole('button', { name: /fechar aviso/i }));
    expect(screen.queryByText(/tarefas de hoje em aberto/i)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(30 * MINUTE);
    });
    expect(screen.getByText(/tarefas de hoje em aberto/i)).toBeTruthy();
  });

  it('intervalo null = desligado: nunca aparece', () => {
    mockInterval = null;
    render(<TaskNudge />);
    act(() => {
      vi.advanceTimersByTime(8 * 60 * MINUTE);
    });
    expect(screen.queryByText(/tarefas de hoje em aberto/i)).toBeNull();
  });

  it('sem tasks de hoje em aberto: não incomoda', () => {
    mockTasks = [baseTasks[2]]; // só a futura
    render(<TaskNudge />);
    act(() => {
      vi.advanceTimersByTime(60 * MINUTE);
    });
    expect(screen.queryByText(/de hoje em aberto/i)).toBeNull();
  });

  it('singular: "1 tarefa de hoje em aberto"', () => {
    mockTasks = [baseTasks[0]];
    render(<TaskNudge />);
    act(() => {
      vi.advanceTimersByTime(30 * MINUTE);
    });
    expect(screen.getByText('1 tarefa de hoje em aberto')).toBeTruthy();
  });

  it('não tem violações de acessibilidade quando visível', async () => {
    vi.useRealTimers();
    // Sem timers fake: força visível via tick curto não dá; renderiza e roda axe
    // no estado oculto + visível usando fake timers só pro avanço.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T09:00:00'));
    const { container } = render(<TaskNudge />);
    act(() => {
      vi.advanceTimersByTime(30 * MINUTE);
    });
    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });
});
