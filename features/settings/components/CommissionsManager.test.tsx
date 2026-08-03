import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/context/TenantContext', () => ({
  useTenant: () => ({ tenant: { organizationId: 'org-1' } }),
}));

const createSpy = vi.fn();
const updateSpy = vi.fn();
const REGRA_EXISTENTE = {
  id: 'rule-1',
  professionalId: 'prof-1',
  specialty: 'Ortodontia',
  procedimento: 'Consulta',
  amountType: 'fixed' as const,
  amount: 30,
  validFrom: '2026-01-01',
  percent: 0,
};
let regras: Array<typeof REGRA_EXISTENTE> = [];

vi.mock('@/lib/query/hooks/useCommissionRulesQuery', () => ({
  useCommissionRules: () => ({ data: regras, isLoading: false, error: null }),
  useCreateCommissionRule: () => ({ mutateAsync: createSpy, isPending: false }),
  useUpdateCommissionRule: () => ({ mutateAsync: updateSpy, isPending: false }),
  useDeleteCommissionRule: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/query/hooks/useProductsQuery', () => ({
  useProducts: () => ({
    data: [{ id: 'prod-1', name: 'Consulta', price: 120, active: true }],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/lib/query/hooks/useProfessionalsQuery', () => ({
  useProfessionals: () => ({
    data: [{
      id: 'prof-1',
      name: 'Dra. Jéssica',
      specialty: 'Ortodontia',
      specialtyIds: ['esp-orto'],
      active: true,
    }],
    isLoading: false,
    error: null,
  }),
}))

// Sem este mock a tela sai buscando na rede durante o teste (e o teardown do
// happy-dom aborta a chamada no meio, poluindo a saída).
const setFazSpy = vi.fn(async () => ({ error: null }))
let vinculosDaEspecialidade: Array<{ specialtyId: string; productId: string }> = []
vi.mock('@/lib/supabase/specialtyProducts', () => ({
  specialtyProductsService: {
    list: async () => ({ data: vinculosDaEspecialidade, error: null }),
    set: vi.fn(async () => ({ error: null })),
  },
  professionalProductsService: {
    listOverrides: async () => ({ data: [], error: null }),
    set: (...args: unknown[]) => setFazSpy(...(args as [])),
    setBatch: vi.fn(async () => ({ error: null })),
  },
}));

import { CommissionsManager } from './CommissionsManager';

describe('CommissionsManager', () => {
  beforeEach(() => {
    regras = [];
    vinculosDaEspecialidade = [];
    setFazSpy.mockClear();
    createSpy.mockReset();
    updateSpy.mockReset();
  });

  it('começa pedindo a pessoa (mestre-detalhe), sem despejar todas as regras', () => {
    regras = [REGRA_EXISTENTE];
    render(<CommissionsManager />);
    expect(screen.getByRole('heading', { name: /Comissões/i })).toBeInTheDocument();
    expect(screen.getByText(/Escolha uma pessoa acima/i)).toBeInTheDocument();
    // O nome do profissional NÃO se repete em cartão nenhum antes de escolher
    // (o formato antigo repetia o nome em cada uma das 89 regras).
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // MODO EMBUTIDO — a comissão passou a morar dentro da ficha do funcionário
  // (Junior, 27/07: "3 menus pra cadastrar uma pessoa"). Se alguém voltar a
  // exigir o seletor de pessoa aqui, estes dois testes caem.
  it('embutido na ficha: já mostra a tabela da pessoa, sem pedir pra escolher', () => {
    regras = [REGRA_EXISTENTE];
    render(<CommissionsManager professionalId="prof-1" />);
    expect(screen.queryByText(/Escolha uma pessoa acima/i)).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Consulta')).toBeInTheDocument();
  });

  it('embutido na ficha: não repete o seletor de pessoa', () => {
    render(<CommissionsManager professionalId="prof-1" />);
    expect(screen.queryByLabelText(/^Pessoa$/i)).not.toBeInTheDocument();
  });

  // Pedido do Junior (27/07): o procedimento que cabe na especialidade da pessoa
  // já abre LIGADO, sem ninguém marcar de novo pessoa por pessoa.
  it('liga sozinho o procedimento que cabe na especialidade da pessoa', async () => {
    vinculosDaEspecialidade = [{ specialtyId: 'esp-orto', productId: 'prod-1' }];
    render(<CommissionsManager professionalId="prof-1" />);
    const chave = await screen.findByRole('switch', { name: /Consulta.*faz/i });
    await vi.waitFor(() => expect(chave).toHaveAttribute('aria-checked', 'true'));
  });

  it('procedimento fora das especialidades dela começa desligado', async () => {
    render(<CommissionsManager professionalId="prof-1" />);
    const chave = await screen.findByRole('switch', { name: /Consulta.*faz/i });
    expect(chave).toHaveAttribute('aria-checked', 'false');
  });

  it('lista os profissionais no select', () => {
    render(<CommissionsManager />);
    expect(screen.getByRole('option', { name: /Dra\. Jéssica/i })).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<CommissionsManager />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('ao escolher a pessoa, mostra a TABELA de procedimentos dela com valor e comissão', () => {
    regras = [REGRA_EXISTENTE];
    render(<CommissionsManager />);
    fireEvent.change(screen.getByLabelText('Pessoa'), { target: { value: 'prof-1' } });

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Procedimento/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /^Valor$/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Comissão/i })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Consulta' })).toBeInTheDocument();
  });

  it('alterar o valor CRIA um período novo (não edita o antigo) — o passado não muda', async () => {
    regras = [REGRA_EXISTENTE];
    render(<CommissionsManager />);
    fireEvent.change(screen.getByLabelText('Pessoa'), { target: { value: 'prof-1' } });

    fireEvent.click(screen.getByRole('button', { name: /^Alterar$/i }));
    const campo = screen.getByLabelText('Comissão de Consulta');
    // Centavos entram pela direita (Junior, 27/07): "5000" = R$ 50,00.
    fireEvent.change(campo, { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar/i }));

    // A regra antiga NÃO pode ser tocada — senão o relatório do mês passado mudava.
    expect(updateSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(1);
    const payload = createSpy.mock.calls[0][0];
    expect(payload).toMatchObject({
      professionalId: 'prof-1',
      procedimento: 'Consulta',
      amountType: 'fixed',
      amount: 50,
    });
  });
});
