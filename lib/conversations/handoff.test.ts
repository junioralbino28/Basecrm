import { describe, expect, it } from 'vitest';
import {
  buildConversationHandoff,
  buildConversationHandoffNotification,
  readConversationHandoff,
} from './handoff';

describe('conversation handoff', () => {
  it('cria alerta persistente e idempotente quando o lead aceita uma ligacao', () => {
    const handoff = buildConversationHandoff({
      type: 'call_accepted',
      summary: 'Empresa anuncia e quer revisar a passagem dos leads para o comercial.',
      reason: 'Lead aceitou receber uma ligacao agora.',
      requestedAt: '2026-09-19T14:00:00.000Z',
      contactName: 'Marina',
      contactPhone: '5511999990000',
    });

    const notification = buildConversationHandoffNotification({
      organizationId: '11111111-1111-4111-8111-111111111111',
      threadId: '22222222-2222-4222-8222-222222222222',
      eventId: '33333333-3333-4333-8333-333333333333',
      handoff,
    });

    expect(notification).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      organization_id: '11111111-1111-4111-8111-111111111111',
      type: 'SYSTEM_ALERT',
      title: 'Lead aceitou ligacao',
      message:
        'Marina: Empresa anuncia e quer revisar a passagem dos leads para o comercial.',
      link:
        '/platform/tenants/11111111-1111-4111-8111-111111111111/conversations?thread=22222222-2222-4222-8222-222222222222',
      severity: 'high',
      read_at: null,
      created_at: '2026-09-19T14:00:00.000Z',
    });
  });

  it('distingue pedido de reuniao de um pedido generico de atendimento humano', () => {
    const handoff = buildConversationHandoff({
      type: 'meeting_requested',
      summary: null,
      reason: 'Quer conversar amanha de manha.',
      requestedAt: '2026-09-19T14:00:00.000Z',
      contactName: null,
      contactPhone: '5511999990000',
    });

    const notification = buildConversationHandoffNotification({
      organizationId: '11111111-1111-4111-8111-111111111111',
      threadId: '22222222-2222-4222-8222-222222222222',
      eventId: '33333333-3333-4333-8333-333333333333',
      handoff,
    });

    expect(notification.title).toBe('Lead quer agendar uma reuniao');
    expect(notification.message).toBe('5511999990000: Quer conversar amanha de manha.');
  });

  it('trata metadata como hostil e rejeita um handoff com tipo desconhecido', () => {
    expect(
      readConversationHandoff({
        type: 'delete_everything',
        summary: '<script>alert(1)</script>',
        requestedAt: '2026-09-19T14:00:00.000Z',
      })
    ).toBeNull();
  });
});
