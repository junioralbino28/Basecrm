import { describe, expect, it } from 'vitest';
import { buildConversationHandoff } from './handoff';
import {
  ConversationMeetingActionSchema,
  resolveConversationMeetingAction,
} from './meetingHandoffAction';

const organizationId = '11111111-1111-4111-8111-111111111111';
const threadId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';

function meetingHandoff(scheduleAt: string | null) {
  return buildConversationHandoff({
    type: 'meeting_requested',
    eventId,
    summary: 'Quer conversar sobre anúncios e atendimento comercial.',
    reason: 'Pediu uma reunião.',
    requestedAt: '2026-09-19T14:00:00.000Z',
    requestedScheduleAt: scheduleAt,
    requestedScheduleText: scheduleAt ? 'segunda às 14h' : 'semana que vem',
    contactName: 'Marina',
    contactPhone: '+5511999990000',
  });
}

describe('meeting handoff action', () => {
  it('confirma o horário exato solicitado e preserva o ID idempotente', () => {
    const result = resolveConversationMeetingAction({
      organizationId,
      threadId,
      handoff: meetingHandoff('2026-09-21T17:00:00.000Z'),
      action: { type: 'confirm_meeting' },
      performedAt: '2026-09-19T15:00:00.000Z',
      performedBy: actorId,
    });

    expect(result.activityId).toBe(eventId);
    expect(result.handoff).toMatchObject({
      type: 'meeting_confirmed',
      eventId,
      requestedScheduleAt: '2026-09-21T17:00:00.000Z',
      scheduleStatus: 'confirmed',
      scheduleUpdatedAt: '2026-09-19T15:00:00.000Z',
      scheduleUpdatedBy: actorId,
    });
  });

  it('permite ajustar uma preferência ambígua para um horário futuro exato', () => {
    const result = resolveConversationMeetingAction({
      organizationId,
      threadId,
      handoff: meetingHandoff(null),
      action: {
        type: 'adjust_meeting',
        scheduledAt: '2026-09-22T18:30:00.000Z',
      },
      performedAt: '2026-09-19T15:00:00.000Z',
      performedBy: actorId,
    });

    expect(result.handoff.scheduleStatus).toBe('adjusted');
    expect(result.handoff.requestedScheduleAt).toBe('2026-09-22T18:30:00.000Z');
  });

  it('recusa confirmação sem horário exato e ajuste no passado', () => {
    expect(() => resolveConversationMeetingAction({
      organizationId,
      threadId,
      handoff: meetingHandoff(null),
      action: { type: 'confirm_meeting' },
      performedAt: '2026-09-19T15:00:00.000Z',
      performedBy: actorId,
    })).toThrow('Defina um horario exato antes de confirmar.');

    expect(() => resolveConversationMeetingAction({
      organizationId,
      threadId,
      handoff: meetingHandoff(null),
      action: {
        type: 'adjust_meeting',
        scheduledAt: '2026-09-19T14:30:00.000Z',
      },
      performedAt: '2026-09-19T15:00:00.000Z',
      performedBy: actorId,
    })).toThrow('O horario da reuniao precisa estar no futuro.');
  });
});

const previousActivityId = '55555555-5555-4555-8555-555555555555';

describe('remarcar/cancelar recaem sobre a reuniao JA confirmada', () => {
  it('REMARCACAO: usa a activity antiga mesmo com o handoff novo trazendo outro eventId', () => {
    const result = resolveConversationMeetingAction({
      organizationId,
      threadId,
      // Handoff novo aberto pela IA quando o lead pediu para remarcar: eventId novo em folha.
      handoff: meetingHandoff(null),
      action: { type: 'adjust_meeting', scheduledAt: '2026-09-25T18:00:00.000Z' },
      performedAt: '2026-09-19T15:00:00.000Z',
      performedBy: actorId,
      previousActivityId,
    });

    // Sem isto, a reuniao antiga ficaria marcada para sempre e o evento do Google, orfao.
    expect(result.activityId).toBe(previousActivityId);
    expect(result.handoff.eventId).toBe(previousActivityId);
    expect(result.cancelled).toBe(false);
  });

  it('sem reuniao anterior, continua usando o eventId do proprio handoff', () => {
    const result = resolveConversationMeetingAction({
      organizationId,
      threadId,
      handoff: meetingHandoff('2026-09-21T17:00:00.000Z'),
      action: { type: 'confirm_meeting' },
      performedAt: '2026-09-19T15:00:00.000Z',
      performedBy: actorId,
      previousActivityId: null,
    });

    expect(result.activityId).toBe(eventId);
  });

  it('CANCELAMENTO: fecha a reuniao sem exigir horario e tira o handoff de reuniao', () => {
    const result = resolveConversationMeetingAction({
      organizationId,
      threadId,
      handoff: meetingHandoff('2026-09-21T17:00:00.000Z'),
      action: { type: 'cancel_meeting' },
      performedAt: '2026-09-19T15:00:00.000Z',
      performedBy: actorId,
      previousActivityId,
    });

    expect(result.cancelled).toBe(true);
    expect(result.activityId).toBe(previousActivityId);
    expect(result.handoff.type).toBe('other');
    expect(result.handoff.reason).toBe('meeting_cancelled');
    expect(result.handoff.requestedScheduleAt).toBeNull();
    expect(result.handoff.scheduleStatus).toBeNull();
  });

  it('CANCELAMENTO: funciona mesmo quando o horario pedido ja passou (o lead desistiu depois)', () => {
    expect(() => resolveConversationMeetingAction({
      organizationId,
      threadId,
      handoff: meetingHandoff(null),
      action: { type: 'cancel_meeting' },
      performedAt: '2026-09-19T15:00:00.000Z',
      performedBy: actorId,
    })).not.toThrow();
  });

  it('a acao de cancelar e aceita pelo schema e campo desconhecido continua recusado', () => {
    expect(ConversationMeetingActionSchema.safeParse({ type: 'cancel_meeting' }).success).toBe(true);
    expect(ConversationMeetingActionSchema.safeParse({ type: 'cancel_meeting', x: 1 }).success).toBe(false);
    expect(ConversationMeetingActionSchema.safeParse({ type: 'delete_meeting' }).success).toBe(false);
  });
});
