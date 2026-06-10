import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/PageLoader', () => ({
  PageLoader: () => <div>Carregando...</div>,
}));

vi.mock('@/features/visao-geral/VisaoGeralPage', () => ({
  default: () => <div data-testid="visao-geral-page" />,
}));

import VisaoGeralRoute from './page';

describe('rota /visao-geral', () => {
  it('renderiza sem quebrar (wrapper dynamic)', () => {
    render(<VisaoGeralRoute />);
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
  });
});
