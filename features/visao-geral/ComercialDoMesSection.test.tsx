// @vitest-environment happy-dom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const useCommercialReport = vi.fn();
vi.mock('@/lib/query/hooks/useFinanceReports', () => ({
  useRevenueReport: () => ({ data: undefined, isLoading: false }),
  useCommercialReport: (...a: unknown[]) => useCommercialReport(...a),
}));

// O arquivo da página importa estes módulos; a seção não usa nenhum deles.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: null }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn(), showToast: vi.fn() }) }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ lifecycleStages: [] }) }));
vi.mock('@/lib/query/hooks/useContactsQuery', () => ({ useContacts: () => ({ data: [] }) }));
vi.mock('@/lib/query/hooks/useDealsQuery', () => ({ useDealsView: () => ({ data: [] }) }));
vi.mock('@/lib/query/hooks/useTasksQuery', () => ({
  useTasks: () => ({ data: [] }),
  useCreateTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/lib/query/hooks/useLeadSourcesQuery', () => ({ useLeadSources: () => ({ data: [] }) }));
vi.mock('@/lib/auth/useHasPermission', () => ({ useHasPermission: () => true }));
vi.mock('@/components/charts', () => ({
  LazyLeadsByDayChart: () => null,
  ChartWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ComercialDoMesSection } from './VisaoGeralPage';

const relatorio = {
  regime: 'fechamento' as const,
  fechamento: {
    ganhos: { qtd: 3, valor: 1700 },
    perdidos: { qtd: 1, valor: 800, motivos: [{ motivo: 'Preço', qtd: 1 }] },
    taxaFechamento: 75,
    ticketMedio: 566.67,
    cicloMedioDias: 41.3,
  },
  entrada: { leads: 2, negocios: 4, valor: 10600 },
  porOrigem: [
    { origem: 'Instagram', ganhosQtd: 1, ganhosValor: 1000, perdidosQtd: 1 },
    { origem: 'Google', ganhosQtd: 1, ganhosValor: 500, perdidosQtd: 0 },
  ],
  porCampanha: [{ campanha: 'promo-junho', ganhosQtd: 1, ganhosValor: 1000 }],
};

describe('ComercialDoMesSection (mês de fechamento)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mostra fechamento, entrada, origem (1º toque) e campanha (último toque)', () => {
    useCommercialReport.mockReturnValue({ data: relatorio, isLoading: false, isError: false });

    render(<ComercialDoMesSection />);

    expect(screen.getByText('Comercial do mês')).toBeInTheDocument();
    expect(screen.getByText('Fechados (ganhos)')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('41.3 dias')).toBeInTheDocument();
    // Entrada é contexto, separada do fechamento.
    expect(screen.getByText('Entraram no mês')).toBeInTheDocument();
    expect(screen.getByText(/2 leads/)).toBeInTheDocument();
    // Origem e campanha.
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText(/1 ganho · R\$\s?1\.000,00 · 1 perdido/)).toBeInTheDocument();
    expect(screen.getByText('promo-junho')).toBeInTheDocument();
    expect(screen.getByText(/motivos de perda: Preço \(1\)/)).toBeInTheDocument();
  });

  it('sem negócio fechado, explica em vez de mostrar barra vazia', () => {
    useCommercialReport.mockReturnValue({
      data: { ...relatorio, porOrigem: [], porCampanha: [] },
      isLoading: false,
      isError: false,
    });

    render(<ComercialDoMesSection />);

    expect(screen.getByText('Nenhum negócio fechado neste mês.')).toBeInTheDocument();
    expect(screen.getByText('Sem campanha registrada nos negócios ganhos.')).toBeInTheDocument();
  });

  it('em erro do RPC, a seção some (não imprime zero como se fosse verdade)', () => {
    useCommercialReport.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    const { container } = render(<ComercialDoMesSection />);

    expect(container.firstChild).toBeNull();
  });
});
