// Controller da Home "Hoje" / call-list (F6): compõe activities + tasks +
// contacts (+ deals/boards pra etiqueta F1-F9) e reusa useToggleActivity /
// useUpdateTask para "marcar feito" — NUNCA move deal no funil (guardrail).
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Activity, Contact, Task } from '@/types';

const activitiesFixture: Activity[] = [
  {
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
  {
    id: 'a-today',
    dealId: 'deal-2',
    contactId: 'contact-2',
    dealTitle: 'Negócio 2',
    type: 'CALL',
    title: 'Ligar hoje',
    date: '2026-06-10T15:00:00',
    user: { name: 'Eu', avatar: '' },
    completed: false,
  },
];

const tasksFixture: Task[] = [
  {
    id: 't-hoje',
    contactId: 'contact-1',
    type: 'reminder',
    title: 'Retorno do raio-X',
    dueDate: '2026-06-10',
    dueTime: '08:00',
    status: 'open',
    juliaFirst: true,
  },
];

const contactsFixture: Contact[] = [
  { id: 'contact-1', name: 'Fulano', email: 'f@x.com', phone: '+5511999999999', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
  { id: 'contact-2', name: 'Beltrana', email: 'b@x.com', phone: '+5511888888888', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
];

const dealsFixture = [
  { id: 'deal-2', status: 'stage-f3', boardId: 'board-cadencia' },
];

const boardsFixture = [
  {
    id: 'board-cadencia',
    name: 'Follow-up · Cadência F1–F9',
    stages: [{ id: 'stage-f3', label: 'F3 · dia 2', color: '#000' }],
    createdAt: '2026-01-01T00:00:00',
  },
];

const toggleMutate = vi.fn();
const updateTaskMutate = vi.fn();
const showToast = vi.fn();

vi.mock('@/lib/query/hooks/useActivitiesQuery', () => ({
  useActivities: () => ({ data: activitiesFixture, isLoading: false, error: null }),
  useToggleActivity: () => ({ mutate: toggleMutate, isPending: false }),
}));

vi.mock('@/lib/query/hooks/useTasksQuery', () => ({
  useTasks: () => ({ data: tasksFixture, isLoading: false, error: null }),
  useUpdateTask: () => ({ mutate: updateTaskMutate, isPending: false }),
}));

vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useContacts: () => ({ data: contactsFixture, isLoading: false, error: null }),
}));

vi.mock('@/lib/query/hooks/useDealsQuery', () => ({
  useDeals: () => ({ data: dealsFixture, isLoading: false, error: null }),
}));

vi.mock('@/lib/query/hooks/useBoardsQuery', () => ({
  useBoards: () => ({ data: boardsFixture, isLoading: false, error: null }),
}));

vi.mock('@/lib/realtime/useRealtimeSync', () => ({
  useRealtimeSync: vi.fn(),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

import { useCallListController } from './useCallListController';

describe('useCallListController', () => {
  beforeEach(() => {
    toggleMutate.mockClear();
    updateTaskMutate.mockClear();
    showToast.mockClear();
  });

  it('compõe activities + tasks + contacts em buckets ordenados', () => {
    const { result } = renderHook(() => useCallListController(new Date('2026-06-10T12:00:00')));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.buckets.overdue.map((e) => e.activity?.id)).toEqual(['a-overdue']);
    // Task de 08:00 vem antes da ligação de 15:00 (ordem por hora).
    expect(result.current.buckets.today.map((e) => e.activity?.id ?? e.task?.id)).toEqual([
      't-hoje',
      'a-today',
    ]);
    expect(result.current.buckets.today[1].contact?.phone).toBe('+5511888888888');
    expect(result.current.totalPending).toBe(3);
  });

  it('etiqueta F1-F9 vem do board de cadência real (fallback honesto)', () => {
    const { result } = renderHook(() => useCallListController(new Date('2026-06-10T12:00:00')));

    // a-today: deal-2 está no estágio "F3 · dia 2" → badge.
    expect(result.current.buckets.today[1].cadenceStage).toBe('F3 · dia 2');
    // a-overdue: deal-1 não está em board nenhum → sem badge (não inventa).
    expect(result.current.buckets.overdue[0].cadenceStage).toBeUndefined();
  });

  it('handleMarkDone de activity delega ao useToggleActivity sem mover deal', () => {
    const { result } = renderHook(() => useCallListController(new Date('2026-06-10T12:00:00')));

    act(() => {
      result.current.handleMarkDone(result.current.buckets.today[1]);
    });

    expect(toggleMutate).toHaveBeenCalledWith('a-today', expect.any(Object));
    expect(updateTaskMutate).not.toHaveBeenCalled();
  });

  it('handleMarkDone de task conclui via useUpdateTask (status done)', () => {
    const { result } = renderHook(() => useCallListController(new Date('2026-06-10T12:00:00')));

    act(() => {
      result.current.handleMarkDone(result.current.buckets.today[0]);
    });

    expect(updateTaskMutate).toHaveBeenCalledWith(
      { id: 't-hoje', updates: { status: 'done' } },
      expect.any(Object)
    );
    expect(toggleMutate).not.toHaveBeenCalled();
  });

  it('toast de erro quando a mutation falha (regra: toast onError em toda mutation)', () => {
    const { result } = renderHook(() => useCallListController(new Date('2026-06-10T12:00:00')));

    act(() => {
      result.current.handleMarkDone(result.current.buckets.today[1]);
    });
    const callbacks = toggleMutate.mock.calls[0][1];
    act(() => {
      callbacks.onError(new Error('falhou'));
    });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('falhou'), 'error');
  });

  it('abre e fecha o CallModal guardando a entrada selecionada', () => {
    const { result } = renderHook(() => useCallListController(new Date('2026-06-10T12:00:00')));

    act(() => {
      result.current.openCall(result.current.buckets.today[1]);
    });
    expect(result.current.isCallModalOpen).toBe(true);
    expect(result.current.activeEntry?.activity?.id).toBe('a-today');

    act(() => {
      result.current.closeCall();
    });
    expect(result.current.isCallModalOpen).toBe(false);
  });
});
