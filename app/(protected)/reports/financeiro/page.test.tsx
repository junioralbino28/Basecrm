import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock do PageLoader e da página real para isolar o wrapper.
vi.mock('@/components/PageLoader', () => ({
  PageLoader: () => <div>Carregando...</div>,
}));

vi.mock('@/features/reports/FinanceReportPage', () => ({
  default: () => <div data-testid="finance-report-page" />,
}));

import FinanceiroRoute from './page';

describe('rota /reports/financeiro', () => {
  it('renderiza sem quebrar (wrapper dynamic)', () => {
    render(<FinanceiroRoute />);
    // O dynamic com ssr:false renderiza o loading no primeiro paint.
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
  });
});
