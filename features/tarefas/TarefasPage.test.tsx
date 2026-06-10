import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TarefasPage } from './TarefasPage';
import type { Task } from '@/types';

const handleNew = vi.fn();
const handleComplete = vi.fn();
const handleSnooze = vi.fn();

const tasks: Task[] = [
  {
    id: 't1',
    contactId: 'c1',
    type: 'reminder',
    title: 'retorno do raio-X',
    note: 'a Dra. pediu retorno',
    dueDate: '2026-06-10',
    status: 'open',
    juliaFirst: true,
  },
  {
    id: 't2',
    type: 'call',
    title: 'Carlos Mota — ligar depois das 15h',
    dueDate: '2026-06-10',
    dueTime: '15:00',
    status: 'open',
    juliaFirst: false,
  },
];

const upcoming: Task[] = [
  {
    id: 't3',
    type: 'message',
    title: 'Ana Paula — retomar contato',
    dueDate: '2026-06-22',
    status: 'open',
    juliaFirst: true,
  },
];

// Select do nudge (N3) tem hooks/gate próprios — testado em
// TaskNudgeSettingsSelect.test.tsx; aqui só interessa o resto do header.
vi.mock('./components/TaskNudgeSettingsSelect', () => ({
  TaskNudgeSettingsSelect: () => null,
}));

vi.mock('./hooks/useTarefasController', () => ({
  useTarefasController: () => ({
    tasks: [],
    dueToday: tasks,
    upcoming,
    contacts: [],
    getContactName: (id?: string) => (id === 'c1' ? 'Bruna Castro' : ''),
    isLoading: false,
    isDrawerOpen: false,
    setIsDrawerOpen: vi.fn(),
    formData: {
      contactId: '', type: 'reminder', title: '', note: '',
      dueDate: '2026-06-10', dueTime: '', juliaFirst: true,
    },
    setFormData: vi.fn(),
    handleNew,
    handleSubmit: vi.fn(),
    handleComplete,
    handleSnooze,
    handleDelete: vi.fn(),
  }),
}));

describe('TarefasPage (mockup: Vence hoje / Próximas)', () => {
  it('renderiza as duas seções com as tarefas e badges do mockup', () => {
    render(<TarefasPage />);
    expect(screen.getByText(/tarefas & lembretes/i)).toBeTruthy();
    expect(screen.getByText('Vence hoje')).toBeTruthy();
    expect(screen.getByText('Próximas')).toBeTruthy();
    // paciente — motivo
    expect(screen.getByText('Bruna Castro — retorno do raio-X')).toBeTruthy();
    // pills de tipo
    expect(screen.getByText('lembrete')).toBeTruthy();
    expect(screen.getByText('ligação')).toBeTruthy();
    expect(screen.getByText('whatsapp')).toBeTruthy();
    // hora opcional vira chip
    expect(screen.getByText('15:00')).toBeTruthy();
    // toggle persiste → badge "Julia avisa antes"
    expect(screen.getAllByText('Julia avisa antes').length).toBeGreaterThan(0);
  });

  it('dispara nova tarefa, concluir e adiar', async () => {
    render(<TarefasPage />);
    await userEvent.click(screen.getByRole('button', { name: /nova tarefa/i }));
    expect(handleNew).toHaveBeenCalledTimes(1);

    await userEvent.click(
      screen.getByRole('button', { name: /concluir: bruna castro — retorno do raio-x/i })
    );
    expect(handleComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));

    await userEvent.click(screen.getAllByRole('button', { name: /adiar/i })[0]);
    expect(handleSnooze).toHaveBeenCalled();
  });
});
