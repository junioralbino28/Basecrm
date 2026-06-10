import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/PageLoader', () => ({
  PageLoader: () => <div>Carregando...</div>,
}));

vi.mock('@/features/reports/ProfessionalsReportPage', () => ({
  default: () => <div data-testid="professionals-report-page" />,
}));

import ProfissionaisRoute from './page';

describe('rota /reports/profissionais', () => {
  it('renderiza sem quebrar (wrapper dynamic)', () => {
    render(<ProfissionaisRoute />);
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
  });
});
