import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TriggerTagSelector } from './TriggerTagSelector';
import { dealTagsService } from '@/lib/supabase/dealTags';

vi.mock('@/lib/supabase/dealTags', () => ({
  dealTagsService: {
    getCatalog: vi.fn(),
    createTag: vi.fn(),
  },
}));

const ORG = '11111111-1111-4111-8111-111111111111';

const CATEGORIES = [{ id: 'cat-proc', label: 'Procedimentos', cardinality: 'multiple' as const }];
const TAGS = [
  { id: 'tag-facetas', categoryId: 'cat-proc', name: 'Facetas' },
  { id: 'tag-orto', categoryId: 'cat-proc', name: 'Ortodontia' },
];

describe('TriggerTagSelector (C2C — o gatilho vira entidade)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dealTagsService.getCatalog).mockResolvedValue({
      categories: CATEGORIES as any,
      tags: TAGS as any,
      error: null,
    });
  });

  it('escolher uma etiqueta entrega o tag_id (contrato v3), nunca texto', async () => {
    const onSelectTag = vi.fn();
    render(
      <TriggerTagSelector
        organizationId={ORG}
        triggerConfig={{}}
        canEdit
        canManage={false}
        onSelectTag={onSelectTag}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /ainda não selecionado/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Procedimentos/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Facetas' }));

    expect(onSelectTag).toHaveBeenCalledWith('tag-facetas');
  });

  it('mostra o nome da etiqueta selecionada a partir do tag_id', async () => {
    render(
      <TriggerTagSelector
        organizationId={ORG}
        triggerConfig={{ tag_id: 'tag-orto' }}
        canEdit
        canManage={false}
        onSelectTag={vi.fn()}
      />,
    );

    expect(await screen.findByText('Ortodontia')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trocar etiqueta' })).toBeInTheDocument();
  });

  it('gatilho legado por texto aparece marcado como legado, somente leitura', async () => {
    render(
      <TriggerTagSelector
        organizationId={ORG}
        triggerConfig={{ tag: 'lentes' }}
        canEdit={false}
        canManage={false}
        onSelectTag={vi.fn()}
      />,
    );

    expect(await screen.findByText('lentes')).toBeInTheDocument();
    expect(screen.getByText('legado')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('sem tags.manage não existe criação de etiqueta no gatilho', async () => {
    render(
      <TriggerTagSelector
        organizationId={ORG}
        triggerConfig={{}}
        canEdit
        canManage={false}
        onSelectTag={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /ainda não selecionado/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Procedimentos/i }));
    await screen.findByRole('menuitem', { name: 'Facetas' });

    expect(screen.queryByLabelText(/Nova etiqueta em/i)).not.toBeInTheDocument();
  });

  it('com tags.manage cria pela RPC com dedupe e já seleciona a criada', async () => {
    const onSelectTag = vi.fn();
    vi.mocked(dealTagsService.createTag).mockResolvedValue({
      data: { id: 'tag-nova', categoryId: 'cat-proc', name: 'Clareamento' } as any,
      error: null,
    });
    render(
      <TriggerTagSelector
        organizationId={ORG}
        triggerConfig={{}}
        canEdit
        canManage
        onSelectTag={onSelectTag}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /ainda não selecionado/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Procedimentos/i }));
    fireEvent.change(await screen.findByLabelText('Nova etiqueta em Procedimentos'), {
      target: { value: 'Clareamento' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));

    await waitFor(() => {
      expect(dealTagsService.createTag).toHaveBeenCalledWith(ORG, 'cat-proc', 'Clareamento');
      expect(onSelectTag).toHaveBeenCalledWith('tag-nova');
    });
  });
});
