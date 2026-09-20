import { describe, expect, it } from 'vitest';
import { buildConversationHandoff } from './handoff';
import { buildConversationMeetingActivity } from './meetingRequest';

describe('conversation meeting request', () => {
  it('nao cria atividade confirmada quando o lead apenas informa um horario desejado', () => {
    const handoff = buildConversationHandoff({
      type: 'meeting_requested',
      summary: 'Quer revisar o funil comercial.',
      reason: 'Pediu uma reuniao.',
      requestedAt: '2026-09-19T14:00:00.000Z',
      requestedScheduleAt: '2026-09-20T13:00:00.000Z',
      requestedScheduleText: 'amanha as 10h',
      contactName: 'Marina',
      contactPhone: '5511999990000',
    });

    expect(
      buildConversationMeetingActivity({
        organizationId: '11111111-1111-4111-8111-111111111111',
        eventId: '33333333-3333-4333-8333-333333333333',
        contactId: '44444444-4444-4444-8444-444444444444',
        dealId: '55555555-5555-4555-8555-555555555555',
        ownerId: null,
        agentName: 'Aurora',
        handoff,
      })
    ).toBeNull();
  });

  it('cria atividade idempotente somente para horario confirmado', () => {
    const handoff = buildConversationHandoff({
      type: 'meeting_confirmed',
      summary: 'Quer revisar o funil comercial.',
      reason: 'Reuniao confirmada.',
      requestedAt: '2026-09-19T14:00:00.000Z',
      requestedScheduleAt: '2026-09-20T13:00:00.000Z',
      requestedScheduleText: 'amanha as 10h',
      contactName: 'Marina',
      contactPhone: '5511999990000',
      scheduleStatus: 'confirmed',
    });

    const activity = buildConversationMeetingActivity({
      organizationId: '11111111-1111-4111-8111-111111111111',
      eventId: '33333333-3333-4333-8333-333333333333',
      contactId: '44444444-4444-4444-8444-444444444444',
      dealId: '55555555-5555-4555-8555-555555555555',
      ownerId: null,
      agentName: 'Aurora',
      handoff,
    });

    expect(activity).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Reuniao confirmada com Marina',
      type: 'MEETING',
      date: '2026-09-20T13:00:00.000Z',
    });
  });

  it('nao inventa atividade quando a preferencia ainda nao tem data exata', () => {
    const handoff = buildConversationHandoff({
      type: 'meeting_requested',
      summary: 'Quer conversar.',
      reason: 'Pediu uma reuniao.',
      requestedAt: '2026-09-19T14:00:00.000Z',
      requestedScheduleAt: null,
      requestedScheduleText: 'semana que vem',
      contactName: 'Marina',
      contactPhone: '5511999990000',
    });

    expect(
      buildConversationMeetingActivity({
        organizationId: '11111111-1111-4111-8111-111111111111',
        eventId: '33333333-3333-4333-8333-333333333333',
        contactId: null,
        dealId: null,
        ownerId: null,
        agentName: 'Aurora',
        handoff,
      })
    ).toBeNull();
    expect(handoff.requestedScheduleText).toBe('semana que vem');
  });

  it('rejeita horario anterior ao pedido', () => {
    const handoff = buildConversationHandoff({
      type: 'meeting_requested',
      summary: null,
      reason: 'Pediu uma reuniao.',
      requestedAt: '2026-09-19T14:00:00.000Z',
      requestedScheduleAt: '2026-09-18T14:00:00.000Z',
      requestedScheduleText: 'ontem',
      contactName: 'Marina',
      contactPhone: '5511999990000',
    });

    expect(handoff.requestedScheduleAt).toBeNull();
  });
});
