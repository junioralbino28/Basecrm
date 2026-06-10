import React from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { runStorySteps } from './storyRunner';
import type { Activity, Contact, Task } from '@/types';

const Icon = () => null;

const activitiesFixture: Activity[] = [
  {
    id: 'a-today',
    dealId: 'deal-1',
    contactId: 'contact-1',
    dealTitle: 'Negócio 1',
    type: 'CALL',
    title: 'Ligar para o lead',
    date: '2026-06-10T15:00:00',
    user: { name: 'Eu', avatar: '' },
    completed: false,
  },
];

const tasksFixture: Task[] = [
  {
    id: 't-1',
    contactId: 'contact-2',
    type: 'reminder',
    title: 'Retorno do raio-X',
    dueDate: '2026-06-10',
    status: 'open',
    juliaFirst: true,
  },
];

const contactsFixture: Contact[] = [
  { id: 'contact-1', name: 'Fulano de Tal', email: 'f@x.com', phone: '+5511999999999', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
  { id: 'contact-2', name: 'Bruna Castro', email: 'b@x.com', phone: '+5522999014452', status: 'ACTIVE', stage: 'LEAD', createdAt: '2026-01-01T00:00:00' },
];

vi.mock('@/lib/query/hooks/useActivitiesQuery', () => ({
  useActivities: () => ({ data: activitiesFixture, isLoading: false, error: null }),
  useToggleActivity: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/query/hooks/useTasksQuery', () => ({
  useTasks: () => ({ data: tasksFixture, isLoading: false, error: null }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useContacts: () => ({ data: contactsFixture, isLoading: false, error: null }),
}));

vi.mock('@/lib/query/hooks/useDealsQuery', () => ({
  useDeals: () => ({ data: [], isLoading: false, error: null }),
}));

vi.mock('@/lib/query/hooks/useBoardsQuery', () => ({
  useBoards: () => ({ data: [], isLoading: false, error: null }),
}));

vi.mock('@/lib/realtime/useRealtimeSync', () => ({
  useRealtimeSync: vi.fn(),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1', role: 'clinic_staff', email: 'test@example.com', organization_id: 'org-1' },
  }),
}));

vi.mock('lucide-react', () => ({
  Phone: Icon,
  PhoneOff: Icon,
  Check: Icon,
  X: Icon,
  XCircle: Icon,
  Voicemail: Icon,
  Clock: Icon,
  FileText: Icon,
  Copy: Icon,
  ExternalLink: Icon,
  AlarmClock: Icon,
  AlertTriangle: Icon,
  BellRing: Icon,
  CalendarDays: Icon,
  MessageCircle: Icon,
}));

describe('Story - US-021: Home "Hoje" / call-list', () => {
  it('simula a historia e garante que nao quebra', async () => {
    const user = userEvent.setup();
    const { CallListPage } = await import('@/features/call-list/CallListPage');

    render(<CallListPage now={new Date('2026-06-10T12:00:00')} />);

    await runStorySteps(user, [
      { kind: 'expectText', text: /Fulano de Tal/ },
      { kind: 'expectText', text: 'Ligar para o lead' },
      { kind: 'expectText', text: 'Retorno do raio-X' },
      { kind: 'expectNotText', text: /Application error/i },
    ]);

    // Abre o CallModal pela linha da ligação e garante que continua sem erro.
    await runStorySteps(user, [
      { kind: 'click', target: { role: 'button', name: /ligar para fulano de tal/i } },
      { kind: 'expectText', text: /resultado da ligação/i },
      { kind: 'expectNotText', text: /Application error/i },
    ]);
  });
});
