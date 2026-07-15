import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccessDenied } from './AccessDenied';

describe('AccessDenied', () => {
  it('renderiza título e mensagem em uma região de status acessível', () => {
    render(<AccessDenied title="Sem permissão" message="Fale com um administrador." />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('heading', { name: 'Sem permissão' })).toBeInTheDocument();
    expect(screen.getByText('Fale com um administrador.')).toBeInTheDocument();
  });

  it('usa Acesso restrito como título padrão', () => {
    render(<AccessDenied message="Você não pode abrir esta área." />);

    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
  });
});
