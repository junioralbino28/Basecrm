import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BoardStrategyHeader } from './BoardStrategyHeader';
import type { Board } from '@/types';

vi.mock('@/context/CRMContext', () => ({
  useCRM: () => ({
    updateBoard: vi.fn(),
    setIsGlobalAIOpen: vi.fn(),
    boards: [],
    deals: [],
  }),
}));

/**
 * Remodelagem do funil (Junior, 30/07/2026): os blocos de cima comiam a tela e
 * "mal dava pra ver o primeiro card". O painel de estratégia nasce RECOLHIDO
 * numa linha fina; expandir é escolha, e a escolha persiste no navegador.
 */
const BOARD: Board = {
  id: 'b1',
  name: 'Funil de Vendas',
  stages: [],
  goal: {
    type: 'percentage',
    targetValue: '30%',
    kpi: 'Taxa de conversão de leads em avaliações realizadas',
    description: 'contexto',
  },
  agentPersona: { name: 'Julia', role: 'Consultora', behavior: 'cordial' },
  entryTrigger: 'Lead preenche formulário',
} as unknown as Board;

describe('BoardStrategyHeader — recolhido por padrão', () => {
  it('nasce numa linha fina: meta e agente visíveis, SEM o painel grande', () => {
    render(<BoardStrategyHeader board={BOARD} />);

    // a linha fina mostra o essencial…
    expect(screen.getByText(/30% ·/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Estratégia/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // …e o painel grande NÃO está montado (a palavra "Entrada" é dele)
    expect(screen.queryByText('Entrada')).not.toBeInTheDocument();
  });

  it('expandir abre o painel completo e o botão vira "Recolher"', () => {
    render(<BoardStrategyHeader board={BOARD} />);

    fireEvent.click(screen.getByRole('button', { name: /Estratégia/ }));

    expect(screen.getByText('Entrada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recolher' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(localStorage.getItem('basecrm.boards.strategy.expanded')).toBe('1');
  });

  it('board sem estratégia continua oferecendo o botão de definir (fluxo antigo intacto)', () => {
    const vazio = { id: 'b2', name: 'Novo', stages: [] } as unknown as Board;
    render(<BoardStrategyHeader board={vazio} />);

    expect(
      screen.getByRole('button', { name: /Definir Estratégia do Board/ }),
    ).toBeInTheDocument();
  });
});
