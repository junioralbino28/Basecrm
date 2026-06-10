import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactCallOutcome } from './ContactCallOutcome';
import type { Activity, Contact } from '@/types';

const createActivityMutate = vi.fn();
const updateContactMutate = vi.fn();
const createTaskMutate = vi.fn();
const showToast = vi.fn();

vi.mock('@/lib/query/hooks/useActivitiesQuery', () => ({
  useCreateActivity: () => ({ mutate: createActivityMutate }),
}));
vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useUpdateContact: () => ({ mutate: updateContactMutate }),
}));
vi.mock('@/lib/query/hooks/useTasksQuery', () => ({
  useCreateTask: () => ({ mutate: createTaskMutate }),
}));
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

const contact = {
  id: 'c1',
  name: 'Camila Freitas',
  email: 'camila@x.com',
  phone: '+5511999999999',
  status: 'ACTIVE',
  stage: 'LEAD',
  createdAt: '2026-06-01',
} as Contact;

const activities: Activity[] = [
  {
    id: 'a1',
    dealId: 'd1',
    dealTitle: 'Limpeza',
    type: 'CALL',
    title: 'Ligação - Camila',
    description: 'Não atendeu - caiu na caixa',
    date: '2026-06-09T10:00:00.000Z',
    completed: true,
    user: { name: 'Eu', avatar: '' },
  },
];

const baseProps = {
  contact,
  dealId: 'd1',
  dealTitle: 'Limpeza',
  activities,
};

beforeEach(() => {
  createActivityMutate.mockClear();
  updateContactMutate.mockClear();
  createTaskMutate.mockClear();
  showToast.mockClear();
});

describe('ContactCallOutcome (ficha: última ligação — marcar resultado)', () => {
  it('renderiza os 4 chips do mockup e a última ligação registrada', () => {
    render(<ContactCallOutcome {...baseProps} />);
    expect(screen.getByText(/última ligação — marcar resultado/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Atendeu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Não atendeu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ligar depois' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /só whatsapp/i })).toBeTruthy();
    expect(screen.getByText(/caiu na caixa/i)).toBeTruthy();
  });

  it('Atendeu registra activity CALL com a convenção de description (padrão CallModal)', async () => {
    render(<ContactCallOutcome {...baseProps} />);
    await userEvent.type(screen.getByLabelText(/anotação da ligação/i), 'confirmou consulta');
    await userEvent.click(screen.getByRole('button', { name: 'Atendeu' }));
    expect(createActivityMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          type: 'CALL',
          contactId: 'c1',
          dealId: 'd1',
          completed: true,
          description: 'Atendeu - confirmou consulta',
        }),
      }),
      expect.anything()
    );
  });

  it('Ligar depois abre data/hora e cria task type call com due_date', async () => {
    render(<ContactCallOutcome {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ligar depois' }));
    const dateInput = screen.getByLabelText(/data da ligação/i);
    expect(dateInput).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /criar tarefa/i }));
    expect(createTaskMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          type: 'call',
          contactId: 'c1',
          title: 'Ligar pra Camila Freitas',
          status: 'open',
        }),
      }),
      expect.anything()
    );
  });

  it('Só WhatsApp seta contact_preference = whatsapp_only', async () => {
    render(<ContactCallOutcome {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: /só whatsapp/i }));
    expect(updateContactMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'c1',
        updates: { contactPreference: 'whatsapp_only' },
      }),
      expect.anything()
    );
  });
});
