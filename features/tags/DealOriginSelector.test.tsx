import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealOriginSelector } from './DealOriginSelector';
import { leadSourcesService } from '@/lib/supabase/leadSources';

vi.mock('@/lib/supabase/leadSources', () => ({
  leadSourcesService: {
    getActive: vi.fn(),
    getDealOriginPointers: vi.fn(),
    recordAttribution: vi.fn(),
  },
}));

const ORG = '11111111-1111-4111-8111-111111111111';
const DEAL = '22222222-2222-4222-8222-222222222222';

const SOURCES = [
  { id: 'src-meta', name: 'Anúncio Instagram', active: true },
  { id: 'src-indicacao', name: 'Indicação', active: true },
];

describe('DealOriginSelector (C2C — origem é entidade separada, §N1.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(leadSourcesService.getActive).mockResolvedValue({
      data: SOURCES as any,
      error: null,
    });
  });

  it('mostra primeira e última origem sem apagar a história', async () => {
    vi.mocked(leadSourcesService.getDealOriginPointers).mockResolvedValue({
      firstSourceId: 'src-meta',
      lastSourceId: 'src-indicacao',
      error: null,
    });
    render(<DealOriginSelector organizationId={ORG} dealId={DEAL} canAssign />);

    const first = await screen.findByText('Primeira ·');
    expect(first.parentElement).toHaveTextContent('Anúncio Instagram');
    const last = screen.getByText('Última ·');
    expect(last.parentElement).toHaveTextContent('Indicação');
  });

  it('registra um toque por seleção — com idempotência, nunca sobrescrita', async () => {
    vi.mocked(leadSourcesService.getDealOriginPointers).mockResolvedValue({
      firstSourceId: null,
      lastSourceId: null,
      error: null,
    });
    vi.mocked(leadSourcesService.recordAttribution).mockResolvedValue({ error: null });
    render(<DealOriginSelector organizationId={ORG} dealId={DEAL} canAssign />);
    await screen.findByText('Origem ainda não registrada.');

    fireEvent.change(screen.getByLabelText('Registrar origem do lead'), {
      target: { value: 'src-meta' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Registrar/i }));

    await waitFor(() => {
      expect(leadSourcesService.recordAttribution).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          dealId: DEAL,
          sourceId: 'src-meta',
          idempotencyKey: expect.any(String),
        }),
      );
    });
  });

  it('sem lead_sources.assign vira somente leitura', async () => {
    vi.mocked(leadSourcesService.getDealOriginPointers).mockResolvedValue({
      firstSourceId: 'src-meta',
      lastSourceId: 'src-meta',
      error: null,
    });
    render(<DealOriginSelector organizationId={ORG} dealId={DEAL} canAssign={false} />);

    expect(await screen.findByText('Anúncio Instagram')).toBeInTheDocument();
    expect(screen.queryByLabelText('Registrar origem do lead')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar/i })).not.toBeInTheDocument();
  });

  it('catálogo vazio instrui onde as origens são criadas (régua do R7)', async () => {
    vi.mocked(leadSourcesService.getActive).mockResolvedValue({ data: [], error: null });
    vi.mocked(leadSourcesService.getDealOriginPointers).mockResolvedValue({
      firstSourceId: null,
      lastSourceId: null,
      error: null,
    });
    render(<DealOriginSelector organizationId={ORG} dealId={DEAL} canAssign />);

    expect(
      await screen.findByText(/As origens são criadas em Configurações/i),
    ).toBeInTheDocument();
  });
});
