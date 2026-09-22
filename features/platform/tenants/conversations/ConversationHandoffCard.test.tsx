// @vitest-environment happy-dom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildConversationHandoff } from '@/lib/conversations/handoff';
import { resolveConversationMeetingAction } from '@/lib/conversations/meetingHandoffAction';
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

/**
 * O handoff pós-cancelamento NÃO é escrito à mão aqui de propósito: quem o produz em produção é
 * `resolveConversationMeetingAction`, chamada pela rota PATCH da conversa. Montar o fixture pela
 * função real é o que garante que o card trata o formato que de fato chega (`type: 'other'` +
 * `reason: 'meeting_cancelled'`), e não um formato que eu imaginei.
 */
function cancelledHandoff() {
  return resolveConversationMeetingAction({
    organizationId: '11111111-1111-4111-8111-111111111111',
    threadId: 'thread-1',
    handoff: handoff('2026-09-21T17:00:00.000Z'),
    action: { type: 'cancel_meeting' },
    performedAt: '2026-09-20T10:00:00.000Z',
    performedBy: '55555555-5555-4555-8555-555555555555',
  }).handoff;
}

function renderCard(
  props: Partial<React.ComponentProps<typeof ConversationHandoffCard>> = {}
) {
  const onConfirm = vi.fn();
  const onAdjust = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConversationHandoffCard
      handoff={handoff('2026-09-21T17:00:00.000Z')}
      phone="+5511999990000"
      disabled={false}
      onConfirm={onConfirm}
      onAdjust={onAdjust}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onConfirm, onAdjust, onCancel };
}

describe('ConversationHandoffCard', () => {
  it('mostra contexto, discador e confirmação quando há horário exato', () => {
    const { onConfirm } = renderCard();

    expect(screen.getByText('Quer revisar anúncios e o atendimento comercial.')).toBeInTheDocument();
    expect(screen.getByText('Duração prevista: 40 min · inícios separados por 60 min')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ligar agora' })).toHaveAttribute('href', 'tel:+5511999990000');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar horário' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('exige definição de horário quando a preferência é ambígua', () => {
    const { onAdjust } = renderCard({ handoff: handoff(null) });

    expect(screen.queryByRole('button', { name: 'Confirmar horário' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Definir horário' }));
    fireEvent.change(screen.getByLabelText('Novo horário da reunião'), {
      target: { value: '2026-09-22T15:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário' }));

    expect(onAdjust).toHaveBeenCalledWith(new Date('2026-09-22T15:30').toISOString());
  });
});

describe('ConversationHandoffCard — cancelar reunião', () => {
  it('oferece o cancelamento quando existe reunião marcada', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Cancelar reunião' })).toBeInTheDocument();
  });

  it('não oferece cancelamento sem reunião marcada', () => {
    renderCard({ handoff: handoff(null) });
    expect(screen.queryByRole('button', { name: 'Cancelar reunião' })).not.toBeInTheDocument();
  });

  it('não oferece cancelamento em handoff que não é de reunião', () => {
    renderCard({
      handoff: buildConversationHandoff({
        type: 'human_requested',
        requestedAt: '2026-09-19T14:00:00.000Z',
        reason: 'Pediu atendimento humano.',
        contactPhone: '+5511999990000',
      }),
    });
    expect(screen.queryByRole('button', { name: 'Cancelar reunião' })).not.toBeInTheDocument();
  });

  it('o primeiro clique só pede confirmação — não dispara nada', () => {
    const { onCancel } = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reunião' }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirmar cancelamento' })).toBeInTheDocument();
    // A ação principal continua acessível enquanto o operador não confirma.
    expect(screen.getByRole('button', { name: 'Confirmar horário' })).toBeInTheDocument();
  });

  it('confirmar dispara o cancelamento uma única vez', () => {
    const { onCancel, onConfirm, onAdjust } = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reunião' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onAdjust).not.toHaveBeenCalled();
  });

  it('"Manter reunião" volta atrás sem cancelar nada', () => {
    const { onCancel } = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reunião' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manter reunião' }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirmar cancelamento' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar reunião' })).toBeInTheDocument();
  });

  it('com a chamada em andamento o confirmar fica desabilitado como os demais', () => {
    const { onCancel } = renderCard({ disabled: true });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reunião' }));
    expect(screen.queryByRole('button', { name: 'Confirmar cancelamento' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar reunião' })).toBeDisabled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('ConversationHandoffCard — depois do cancelamento', () => {
  it('o handoff que o cancelamento deixa é `other` + `meeting_cancelled`', () => {
    const cancelled = cancelledHandoff();
    expect(cancelled.type).toBe('other');
    expect(cancelled.reason).toBe('meeting_cancelled');
    expect(cancelled.requestedScheduleAt).toBeNull();
  });

  it('diz que a reunião foi cancelada e não oferece mais nenhuma ação de agenda', () => {
    renderCard({ handoff: cancelledHandoff() });

    expect(screen.getByText('Reunião cancelada')).toBeInTheDocument();
    // Com a data: `buildConversationHandoff` passou a preservar `scheduleUpdatedAt` no
    // cancelamento (antes vinha sempre nulo e a tela so conseguia mostrar a variante sem data).
    expect(screen.getByText(/Reunião cancelada em .+\. O horário foi liberado/)).toBeInTheDocument();
    expect(screen.queryByText('Aguardando ação')).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Confirmar horário' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajustar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Definir horário' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar reunião' })).not.toBeInTheDocument();

    // Falar com o lead continua possível — o que sai são só as ações de agenda.
    expect(screen.getByRole('link', { name: 'Ligar agora' })).toBeInTheDocument();
  });
});
