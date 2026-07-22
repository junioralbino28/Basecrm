import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealTagSelector } from './DealTagSelector';
import { dealTagsService } from '@/lib/supabase/dealTags';

vi.mock('@/lib/supabase/dealTags', () => ({
  dealTagsService: {
    getCatalog: vi.fn(),
    getAssignments: vi.fn(),
    assign: vi.fn(),
    remove: vi.fn(),
    setPrimary: vi.fn(),
  },
}));

const ORG = '11111111-1111-4111-8111-111111111111';
const DEAL = '22222222-2222-4222-8222-222222222222';

const CATEGORIES = [
  { id: 'cat-proc', label: 'Procedimentos', cardinality: 'multiple' as const },
  { id: 'cat-conv', label: 'Convênio', cardinality: 'single' as const },
];
const TAGS = [
  { id: 'tag-facetas', categoryId: 'cat-proc', name: 'Facetas' },
  { id: 'tag-clareamento', categoryId: 'cat-proc', name: 'Clareamento' },
  { id: 'tag-unimed', categoryId: 'cat-conv', name: 'Unimed' },
];

function mockData({ assignments = [] as any[] } = {}) {
  vi.mocked(dealTagsService.getCatalog).mockResolvedValue({
    categories: CATEGORIES as any,
    tags: TAGS as any,
    error: null,
  });
  vi.mocked(dealTagsService.getAssignments).mockResolvedValue({
    data: assignments,
    error: null,
  });
}

describe('DealTagSelector (C2C — a secretária seleciona, nunca digita)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('não tem NENHUM campo de texto — o contrato §N1.1 é seleção pura', async () => {
    mockData();
    const { container } = render(
      <DealTagSelector organizationId={ORG} dealId={DEAL} canAssign canManage={false} />,
    );
    await screen.findByText('Nenhuma etiqueta aplicada.');

    fireEvent.click(screen.getByRole('button', { name: /Adicionar tag/i }));
    await screen.findByText('Procedimentos');

    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('menu navega categoria → etiqueta e aplica por seleção', async () => {
    mockData();
    vi.mocked(dealTagsService.assign).mockResolvedValue({ error: null });
    render(<DealTagSelector organizationId={ORG} dealId={DEAL} canAssign canManage={false} />);
    await screen.findByText('Nenhuma etiqueta aplicada.');

    fireEvent.click(screen.getByRole('button', { name: /Adicionar tag/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Procedimentos/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Facetas' }));

    await waitFor(() => {
      expect(dealTagsService.assign).toHaveBeenCalledWith(ORG, DEAL, 'tag-facetas');
    });
  });

  it('categoria single avisa que escolher outra substitui a atual', async () => {
    mockData();
    render(<DealTagSelector organizationId={ORG} dealId={DEAL} canAssign canManage={false} />);
    await screen.findByText('Nenhuma etiqueta aplicada.');

    fireEvent.click(screen.getByRole('button', { name: /Adicionar tag/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Convênio/i }));

    expect(await screen.findByText('Escolher outra substitui a atual.')).toBeInTheDocument();
  });

  it('mostra a principal com estrela e permite trocar com um clique', async () => {
    mockData({
      assignments: [
        { id: 'a1', dealId: DEAL, categoryId: 'cat-proc', tagId: 'tag-facetas', isPrimary: true },
        { id: 'a2', dealId: DEAL, categoryId: 'cat-proc', tagId: 'tag-clareamento', isPrimary: false },
      ],
    });
    vi.mocked(dealTagsService.setPrimary).mockResolvedValue({ error: null });
    render(<DealTagSelector organizationId={ORG} dealId={DEAL} canAssign canManage={false} />);

    await screen.findByText('Facetas');
    expect(screen.getByLabelText(/Etiqueta principal/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tornar Clareamento a principal' }));
    await waitFor(() => {
      expect(dealTagsService.setPrimary).toHaveBeenCalledWith(ORG, DEAL, 'tag-clareamento');
    });
  });

  it('sem tags.assign vira somente leitura: sem adicionar, remover ou trocar principal', async () => {
    mockData({
      assignments: [
        { id: 'a1', dealId: DEAL, categoryId: 'cat-proc', tagId: 'tag-facetas', isPrimary: false },
      ],
    });
    render(
      <DealTagSelector organizationId={ORG} dealId={DEAL} canAssign={false} canManage={false} />,
    );

    await screen.findByText('Facetas');
    expect(screen.queryByRole('button', { name: /Adicionar tag/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remover etiqueta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /a principal/i })).not.toBeInTheDocument();
  });

  it('catálogo vazio instrui em vez de constatar (régua do R7)', async () => {
    vi.mocked(dealTagsService.getCatalog).mockResolvedValue({ categories: [], tags: [], error: null });
    vi.mocked(dealTagsService.getAssignments).mockResolvedValue({ data: [], error: null });
    render(<DealTagSelector organizationId={ORG} dealId={DEAL} canAssign canManage={false} />);
    await screen.findByText('Nenhuma etiqueta aplicada.');

    fireEvent.click(screen.getByRole('button', { name: /Adicionar tag/i }));
    expect(
      await screen.findByText(/Peça à administração para criar as categorias/i),
    ).toBeInTheDocument();
  });
});
