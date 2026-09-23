import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useDealMock = vi.fn();
const useBoardsMock = vi.fn();
const moveDealMock = vi.fn();
const permissoes = new Set<string>();

vi.mock('@/lib/query/hooks/useDealsQuery', () => ({ useDeal: (...a: unknown[]) => useDealMock(...a) }));
vi.mock('@/lib/query/hooks/useBoardsQuery', () => ({ useBoards: () => useBoardsMock() }));
vi.mock('@/lib/query/hooks/useMoveDeal', () => ({
  useMoveDealSimple: () => ({ moveDeal: moveDealMock, isMoving: false, error: null }),
}));
vi.mock('@/lib/auth/useHasPermission', () => ({
  useHasPermission: (p: string) => permissoes.has(p),
}));
// Os seletores de etiqueta e origem sao os MESMOS do detalhe do negocio e tem teste proprio;
// aqui so provamos que chegam com o negocio e a organizacao certos.
vi.mock('@/features/tags/DealTagSelector', () => ({
  DealTagSelector: (p: { organizationId: string; dealId: string }) =>
    <div data-testid="etiquetas">{p.organizationId}|{p.dealId}</div>,
}));
vi.mock('@/features/tags/DealOriginSelector', () => ({
  DealOriginSelector: (p: { organizationId: string; dealId: string }) =>
    <div data-testid="origem">{p.organizationId}|{p.dealId}</div>,
}));

import { ConversationDealPanel } from './ConversationDealPanel';

const ORG = '11111111-1111-4111-8111-111111111111';
const DEAL = '22222222-2222-4222-8222-222222222222';
const PERDIDO = 'etapa-perdido';

const FUNIL = {
  id: 'funil-casa',
  name: 'CASA',
  lostStageId: PERDIDO,
  stages: [
    { id: 'etapa-novo', label: 'Novo' },
    { id: 'etapa-qualificado', label: 'Qualificado' },
    { id: PERDIDO, label: 'Perdido' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  permissoes.clear();
  ['tags.assign', 'tags.manage', 'lead_sources.assign', 'funnels.move'].forEach((p) => permissoes.add(p));
  useDealMock.mockReturnValue({ data: { id: DEAL, boardId: FUNIL.id, status: 'etapa-novo' }, isLoading: false });
  useBoardsMock.mockReturnValue({ data: [FUNIL] });
  moveDealMock.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('funil, etiquetas e origem dentro da conversa (Junior, 23/09)', () => {
  it('mostra a etapa ATUAL do negocio e as etapas do funil dele', () => {
    render(<ConversationDealPanel organizationId={ORG} dealId={DEAL} />);

    const etapa = screen.getByLabelText(/Etapa no funil/) as HTMLSelectElement;
    expect(etapa.value).toBe('etapa-novo');
    expect(screen.getByRole('option', { name: 'Qualificado' })).toBeInTheDocument();
    expect(screen.getByText(/CASA/)).toBeInTheDocument();
  });

  it('mudar a etapa chama a MESMA movimentacao do quadro (ganho/perda, historico, automacao)', async () => {
    render(<ConversationDealPanel organizationId={ORG} dealId={DEAL} />);

    fireEvent.change(screen.getByLabelText(/Etapa no funil/), { target: { value: 'etapa-qualificado' } });

    await waitFor(() => expect(moveDealMock).toHaveBeenCalledTimes(1));
    expect(moveDealMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: DEAL }), 'etapa-qualificado', undefined,
    );
  });

  it('PERDA nao move na hora: pede o motivo antes, senao o relatorio de perdas fica cego', async () => {
    render(<ConversationDealPanel organizationId={ORG} dealId={DEAL} />);

    fireEvent.change(screen.getByLabelText(/Etapa no funil/), { target: { value: PERDIDO } });

    expect(moveDealMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Por que perdeu/), { target: { value: 'sem verba agora' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar perda' }));

    await waitFor(() => expect(moveDealMock).toHaveBeenCalledTimes(1));
    expect(moveDealMock).toHaveBeenCalledWith(expect.anything(), PERDIDO, 'sem verba agora');
  });

  it('cancelar a perda nao move nada', () => {
    render(<ConversationDealPanel organizationId={ORG} dealId={DEAL} />);

    fireEvent.change(screen.getByLabelText(/Etapa no funil/), { target: { value: PERDIDO } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(moveDealMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Por que perdeu/)).not.toBeInTheDocument();
  });

  it('sem permissao de mover no funil, o seletor fica travado e explica', () => {
    permissoes.delete('funnels.move');
    render(<ConversationDealPanel organizationId={ORG} dealId={DEAL} />);

    expect(screen.getByLabelText(/Etapa no funil/)).toBeDisabled();
    expect(screen.getByText(/não tem permissão para mudar a etapa/i)).toBeInTheDocument();
  });

  it('etiquetas e origem recebem a organizacao e o negocio certos', () => {
    render(<ConversationDealPanel organizationId={ORG} dealId={DEAL} />);

    expect(screen.getByTestId('etiquetas')).toHaveTextContent(`${ORG}|${DEAL}`);
    expect(screen.getByTestId('origem')).toHaveTextContent(`${ORG}|${DEAL}`);
  });

  it('conversa SEM negocio explica em vez de mostrar controles quebrados', () => {
    render(<ConversationDealPanel organizationId={ORG} dealId={null} />);

    expect(screen.getByText(/ainda não virou negócio/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Etapa no funil/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('etiquetas')).not.toBeInTheDocument();
    // Sem negocio nao se consulta negocio nenhum.
    expect(useDealMock).toHaveBeenCalledWith(undefined);
  });

  it('escolher a MESMA etapa nao dispara movimentacao (evita historico de mentira)', () => {
    render(<ConversationDealPanel organizationId={ORG} dealId={DEAL} />);

    fireEvent.change(screen.getByLabelText(/Etapa no funil/), { target: { value: 'etapa-novo' } });

    expect(moveDealMock).not.toHaveBeenCalled();
  });
});
