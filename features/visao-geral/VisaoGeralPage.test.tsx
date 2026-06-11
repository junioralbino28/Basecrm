import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const addToast = vi.fn();
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast, showToast: addToast }),
}));

vi.mock('@/context/CRMContext', () => ({
  useCRM: () => ({
    lifecycleStages: [
      { id: 's-lead', name: 'Lead', color: '#999', order: 1 },
      { id: 's-conversa', name: 'Em conversa', color: '#999', order: 2 },
    ],
  }),
}));

const NOW = new Date();
const DIA_MS = 24 * 60 * 60 * 1000;

const contacts = [
  {
    id: 'c-1',
    name: 'Ana Paula',
    email: '',
    phone: '',
    status: 'ACTIVE',
    stage: 's-lead',
    source: 'Instagram',
    createdAt: new Date(NOW.getTime() - 3 * DIA_MS).toISOString(),
  },
  {
    id: 'c-2',
    name: 'Rita Alves',
    email: '',
    phone: '',
    status: 'ACTIVE',
    stage: 's-conversa',
    source: 'Anúncio Meta',
    createdAt: new Date(NOW.getTime() - 4 * DIA_MS).toISOString(),
  },
];

const deals = [
  {
    id: 'd-1',
    title: 'Facetas',
    contactId: 'c-1',
    contactName: 'Ana Paula',
    contactEmail: '',
    stageLabel: 'Em conversa',
    boardId: 'b-1',
    value: 5000,
    items: [],
    status: 'stage-1',
    isWon: false,
    isLost: false,
    createdAt: new Date(NOW.getTime() - 10 * DIA_MS).toISOString(),
    updatedAt: NOW.toISOString(),
    lastStageChangeDate: new Date(NOW.getTime() - 5 * DIA_MS).toISOString(),
    probability: 0,
    priority: 'medium',
    owner: { name: '', avatar: '' },
    tags: [],
  },
];

vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useContacts: () => ({ data: contacts, isLoading: false }),
}));

vi.mock('@/lib/query/hooks/useDealsQuery', () => ({
  useDealsView: () => ({ data: deals, isLoading: false }),
}));

const createTaskAsync = vi.fn();
vi.mock('@/lib/query/hooks/useTasksQuery', () => ({
  useTasks: () => ({ data: [], isLoading: false }),
  useCreateTask: () => ({ mutateAsync: createTaskAsync, isPending: false }),
}));

vi.mock('@/lib/query/hooks/useLeadSourcesQuery', () => ({
  useLeadSources: () => ({
    data: [
      { id: 'ls-1', name: 'Anúncio Meta', active: true },
      { id: 'ls-2', name: 'Instagram', active: true },
    ],
    isLoading: false,
  }),
}));

const useRevenueReport = vi.fn();
vi.mock('@/lib/query/hooks/useFinanceReports', () => ({
  useRevenueReport: (...a: unknown[]) => useRevenueReport(...a),
}));

vi.mock('@/components/charts', () => ({
  LazyLeadsByDayChart: () => <div data-testid="leads-by-day-chart" />,
  ChartWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import VisaoGeralPage from './VisaoGeralPage';
import { useAuth } from '@/context/AuthContext';

const useAuthMock = vi.mocked(useAuth);

describe('VisaoGeralPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTaskAsync.mockResolvedValue({ id: 't-1' });
    // LOW-6: "mandar pra fila" agora confirma antes de disparar — confirma por padrão.
    // happy-dom não implementa window.confirm (undefined), então atribuímos o mock
    // direto em vez de vi.spyOn (que exige uma função existente pra espionar).
    window.confirm = vi.fn(() => true);
    useRevenueReport.mockReturnValue({
      data: { faturamento: 18430, totalAtendimentos: 47, porMes: [], porSemana: [] },
      isLoading: false,
      isError: false,
    });
  });

  it('clinic_admin vê KPIs incluindo o card de R$ (Recebido no mês)', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    render(<VisaoGeralPage />);

    expect(screen.getByText('Leads novos')).toBeInTheDocument();
    expect(screen.getByText('Recebido no mês')).toBeInTheDocument();
    // "Leads parados" aparece no KPI e no card da leitura inteligente
    expect(screen.getAllByText('Leads parados').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Tarefas de hoje')).toBeInTheDocument();
  });

  it('clinic_staff (Vitória) vê a Visão Geral mas SEM o card de R$ (gate por role do mockup)', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u2', role: 'clinic_staff', organization_id: 'org-1', email: 'vitoria@clinica.com' },
    } as any);

    render(<VisaoGeralPage />);

    expect(screen.getByText('Leads novos')).toBeInTheDocument();
    expect(screen.queryByText('Recebido no mês')).not.toBeInTheDocument();
    // staff não dispara a query financeira
    expect(useRevenueReport).not.toHaveBeenCalled();
  });

  it('lista leads parados por etapa e "mandar pra fila" cria tasks em lote', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u2', role: 'clinic_staff', organization_id: 'org-1', email: 'vitoria@clinica.com' },
    } as any);

    render(<VisaoGeralPage />);

    // d-1 está parado há 5 dias na etapa "Em conversa" (aparece também no funil)
    expect(screen.getAllByText('Em conversa').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: /mandar.*pra fila/i }));

    // LOW-6: confirma antes de disparar o lote.
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(createTaskAsync).toHaveBeenCalledTimes(1));
    const { task } = createTaskAsync.mock.calls[0][0];
    expect(task.type).toBe('call');
    expect(task.contactId).toBe('c-1');
    expect(task.status).toBe('open');
    await waitFor(() => expect(addToast).toHaveBeenCalled());
  });

  it('LOW-6: cancelar a confirmação NÃO cria nenhuma tarefa', async () => {
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
    useAuthMock.mockReturnValue({
      profile: { id: 'u2', role: 'clinic_staff', organization_id: 'org-1', email: 'vitoria@clinica.com' },
    } as any);

    render(<VisaoGeralPage />);
    fireEvent.click(screen.getByRole('button', { name: /mandar.*pra fila/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(createTaskAsync).not.toHaveBeenCalled();
  });

  it('notas de atenção determinísticas aparecem com botão resolver', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u2', role: 'clinic_staff', organization_id: 'org-1', email: 'vitoria@clinica.com' },
    } as any);

    render(<VisaoGeralPage />);

    // c-1/c-2 sem interação há 48h+ e d-1 com R$ 5.000 parado geram notas
    expect(screen.getByText(/sem resposta há 48h\+/i)).toBeInTheDocument();
    expect(screen.getByText(/em orçamentos sem resposta/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /resolver/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('card de Insights da Julia fica OCULTO sem a flag (v1.1)', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    render(<VisaoGeralPage />);

    expect(screen.queryByText(/insights/i)).not.toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', role: 'clinic_admin', organization_id: 'org-1', email: 'adel@clinica.com' },
    } as any);

    const { container } = render(<VisaoGeralPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
