import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';

/**
 * Com varios atendentes no mesmo numero, quem abre a conversa precisa ver QUEM respondeu —
 * independente de a assinatura estar ligada, porque isso e informacao interna do CRM.
 */

function mensagem(extra: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    thread_id: 't1',
    organization_id: 'o1',
    direction: 'outbound',
    message_type: 'text',
    author_name: 'Vitoria',
    content: 'Confirmo amanha as 14h',
    metadata: {},
    sent_at: '2026-09-25T12:00:00.000Z',
    created_at: '2026-09-25T12:00:00.000Z',
    ...extra,
  } as never;
}

describe('MessageBubble: quem enviou', () => {
  it('mostra o nome do atendente na mensagem que saiu', () => {
    render(<MessageBubble message={mensagem()} />);
    expect(screen.getByTestId('remetente-da-bolha')).toHaveTextContent('Vitoria');
  });

  it('nao inventa rotulo quando a mensagem saiu sem autor', () => {
    render(<MessageBubble message={mensagem({ author_name: null })} />);
    expect(screen.queryByTestId('remetente-da-bolha')).not.toBeInTheDocument();
  });

  it('a mensagem do lead nao ganha rotulo de remetente', () => {
    render(<MessageBubble message={mensagem({ direction: 'inbound', author_name: 'Maria' })} />);
    expect(screen.queryByTestId('remetente-da-bolha')).not.toBeInTheDocument();
  });

  it('nota interna continua com o rotulo proprio, sem duplicar', () => {
    render(<MessageBubble message={mensagem({ direction: 'internal', content: 'lead pediu desconto' })} />);
    expect(screen.getByText(/Nota interna/)).toBeInTheDocument();
    expect(screen.queryByTestId('remetente-da-bolha')).not.toBeInTheDocument();
  });

  it('o texto da mensagem nao carrega o nome — o prefixo so existe no que foi para a Evolution', () => {
    render(<MessageBubble message={mensagem()} />);
    expect(screen.getByText('Confirmo amanha as 14h')).toBeInTheDocument();
  });
});
