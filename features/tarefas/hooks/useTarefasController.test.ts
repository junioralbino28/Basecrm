import { describe, it, expect } from 'vitest';
import { splitTasks, addDaysIso, localTodayIso } from './useTarefasController';
import type { Task } from '@/types';

const task = (overrides: Partial<Task>): Task => ({
  id: Math.random().toString(36).slice(2),
  type: 'reminder',
  title: 'Tarefa',
  dueDate: '2026-06-10',
  status: 'open',
  juliaFirst: false,
  ...overrides,
});

describe('splitTasks (seções Vence hoje / Próximas do mockup)', () => {
  const today = '2026-06-10';

  it('separa vence hoje (inclui atrasadas) de próximas', () => {
    const overdue = task({ dueDate: '2026-06-08' });
    const hoje = task({ dueDate: '2026-06-10' });
    const amanha = task({ dueDate: '2026-06-11' });

    const { dueToday, upcoming } = splitTasks([overdue, hoje, amanha], today);
    expect(dueToday).toContain(overdue);
    expect(dueToday).toContain(hoje);
    expect(upcoming).toEqual([amanha]);
  });

  it('concluídas (done) saem das duas seções', () => {
    const done = task({ dueDate: '2026-06-10', status: 'done', completedAt: 'x' });
    const { dueToday, upcoming } = splitTasks([done], today);
    expect(dueToday).toHaveLength(0);
    expect(upcoming).toHaveLength(0);
  });

  it('adiadas (snoozed) continuam visíveis na seção da data', () => {
    const snoozed = task({ dueDate: '2026-06-11', status: 'snoozed' });
    const { upcoming } = splitTasks([snoozed], today);
    expect(upcoming).toEqual([snoozed]);
  });
});

describe('helpers de data local (due_date é date — sem UTC)', () => {
  it('addDaysIso soma dias inclusive na virada de mês', () => {
    expect(addDaysIso('2026-06-10', 1)).toBe('2026-06-11');
    expect(addDaysIso('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('localTodayIso formata YYYY-MM-DD na hora local', () => {
    expect(localTodayIso(new Date(2026, 5, 10, 23, 30))).toBe('2026-06-10');
    expect(localTodayIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
});
