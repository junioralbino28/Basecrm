// @vitest-environment happy-dom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildConversationHandoff } from '@/lib/conversations/handoff';
import { ConversationHandoffCard } from './ConversationHandoffCard';

function handoff(scheduleAt: string | null) {
  return buildConversationHandoff({
    type: 'meeting_requested',
    eventId: '44444444-4444-4444-8444-444444444444',
    summary: 'Quer revisar anúncios e o atendimento comercial.',
    reason: 'Pediu uma reunião.',
    requestedAt: '2026-09-19T14:00:00.000Z',
    requestedScheduleAt: scheduleAt,
    requestedScheduleText: scheduleAt ? 'segunda às 14h' : 'semana que vem',
    contactName: 'Marina',
    contactPhone: '+5511999990000',
  });
}

describe('ConversationHandoffCard', () => {
  it('mostra contexto, discador e confirmação quando há horário exato', () => {
    const onConfirm = vi.fn();
    render(
      <ConversationHandoffCard
        handoff={handoff('2026-09-21T17:00:00.000Z')}
        phone="+5511999990000"
        disabled={false}
        onConfirm={onConfirm}
        onAdjust={vi.fn()}
      />
    );

    expect(screen.getByText('Quer revisar anúncios e o atendimento comercial.')).toBeInTheDocument();
    expect(screen.getByText('Duração prevista: 40 min · inícios separados por 60 min')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ligar agora' })).toHaveAttribute('href', 'tel:+5511999990000');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar horário' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('exige definição de horário quando a preferência é ambígua', () => {
    const onAdjust = vi.fn();
    render(
      <ConversationHandoffCard
        handoff={handoff(null)}
        phone="+5511999990000"
        disabled={false}
        onConfirm={vi.fn()}
        onAdjust={onAdjust}
      />
    );

    expect(screen.queryByRole('button', { name: 'Confirmar horário' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Definir horário' }));
    fireEvent.change(screen.getByLabelText('Novo horário da reunião'), {
      target: { value: '2026-09-22T15:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário' }));

    expect(onAdjust).toHaveBeenCalledWith(new Date('2026-09-22T15:30').toISOString());
  });
});
