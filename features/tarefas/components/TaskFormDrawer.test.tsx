import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormDrawer } from './TaskFormDrawer';
import type { Contact } from '@/types';
import type { TaskFormState } from '../hooks/useTarefasController';

const baseForm: TaskFormState = {
  contactId: '',
  type: 'reminder',
  title: '',
  note: '',
  dueDate: '2026-06-17',
  dueTime: '',
  juliaFirst: true,
};

const contacts = [
  { id: 'c1', name: 'Bruna Castro', email: 'b@x.com', phone: '', status: 'ACTIVE', stage: 'LEAD', createdAt: '' },
] as Contact[];

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSubmit: vi.fn((e: React.FormEvent) => e.preventDefault()),
  formData: baseForm,
  setFormData: vi.fn(),
  contacts,
};

describe('TaskFormDrawer (mockup drawer-task)', () => {
  it('renderiza os campos do mockup: paciente, tipo, motivo, nota, data, hora, toggle Julia', () => {
    render(<TaskFormDrawer {...baseProps} />);
    expect(screen.getByText(/nova tarefa \/ lembrete/i)).toBeTruthy();
    expect(screen.getByLabelText(/paciente/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /ligação/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /lembrete/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /mensagem/i })).toBeTruthy();
    expect(screen.getByLabelText(/motivo/i)).toBeTruthy();
    expect(screen.getByLabelText(/nota/i)).toBeTruthy();
    expect(screen.getByLabelText(/quando/i)).toBeTruthy();
    expect(screen.getByLabelText(/hora \(opcional\)/i)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /julia avisa primeiro no whatsapp/i })).toBeTruthy();
    expect(screen.getByText(/pode ficar vazio — tarefa geral da recepção/i)).toBeTruthy();
  });

  it('toggle Julia grava juliaFirst no formData (v1 só persiste a intenção)', async () => {
    const setFormData = vi.fn();
    render(<TaskFormDrawer {...baseProps} setFormData={setFormData} />);
    await userEvent.click(
      screen.getByRole('checkbox', { name: /julia avisa primeiro no whatsapp/i })
    );
    expect(setFormData).toHaveBeenCalledWith(expect.objectContaining({ juliaFirst: false }));
  });

  it('seleciona o tipo ligação', async () => {
    const setFormData = vi.fn();
    render(<TaskFormDrawer {...baseProps} setFormData={setFormData} />);
    await userEvent.click(screen.getByRole('button', { name: /ligação/i }));
    expect(setFormData).toHaveBeenCalledWith(expect.objectContaining({ type: 'call' }));
  });

  it('submete pelo botão Criar (type=submit ligado ao form)', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <TaskFormDrawer
        {...baseProps}
        onSubmit={onSubmit}
        formData={{ ...baseForm, title: 'Retorno do raio-X' }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /^criar$/i }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
