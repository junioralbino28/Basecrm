import { describe, expect, it } from 'vitest';
import { applyMeetingReplyPolicy } from './meetingReplyPolicy';

describe('meeting reply policy', () => {
  it('oferece os dois primeiros horarios quando o lead pediu reuniao sem confirmar um slot', () => {
    expect(
      applyMeetingReplyPolicy({
        replyText: 'Perfeito, registrei sua reuniao.',
        handoffType: 'meeting_requested',
        requestedScheduleAt: null,
        requestedScheduleText: 'amanha de manha',
        requiresHumanConfirmation: false,
        availableSlots: [
          { startAt: '2026-09-20T12:00:00.000Z', label: 'amanha as 9h' },
          { startAt: '2026-09-20T13:00:00.000Z', label: 'amanha as 10h' },
          { startAt: '2026-09-20T14:00:00.000Z', label: 'amanha as 11h' },
        ],
      })
    ).toMatchObject({
      handoffType: null,
      requestedScheduleAt: null,
      replyText: 'Ainda nao confirmei a reuniao. Posso te oferecer amanha as 9h ou amanha as 10h. Qual horario funciona melhor para voce?',
    });
  });

  it('mantem o handoff quando o horario exige confirmacao humana', () => {
    const result = applyMeetingReplyPolicy({
      replyText: 'Registrei sua preferencia.',
      handoffType: 'meeting_requested',
      requestedScheduleAt: '2026-09-26T12:00:00.000Z',
      requestedScheduleText: 'sabado as 9h',
      requiresHumanConfirmation: true,
      availableSlots: [{ startAt: '2026-09-26T12:00:00.000Z', label: 'sabado as 9h' }],
    });

    expect(result.handoffType).toBe('meeting_requested');
    expect(result.replyText).toBe('Registrei sua preferencia.');
  });
});
