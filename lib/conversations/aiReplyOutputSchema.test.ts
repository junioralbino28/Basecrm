import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ConversationAutoReplySchema } from './aiReply';

describe('ConversationAutoReplySchema — formato do modelo nao derruba a resposta', () => {
  it('aceita data fora do ISO (vira null na normalizacao, nao erro de parse)', () => {
    const parsed = ConversationAutoReplySchema.safeParse({
      replyText: 'Posso te ligar amanha?',
      shouldHandoff: false,
      handoffType: null,
      requestedScheduleAt: 'amanha as 10h',
      requestedScheduleText: 'amanha as 10h',
    });
    expect(parsed.success).toBe(true);
  });

  it('aceita ISO com offset e o minimo obrigatorio', () => {
    const parsed = ConversationAutoReplySchema.safeParse({
      replyText: 'Fechado para terca as 10h.',
      shouldHandoff: true,
      handoffType: 'meeting_confirmed',
      requestedScheduleAt: '2026-09-22T10:00:00-03:00',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.shouldHandoff).toBe(true);
  });

  it('continua recusando handoffType fora do contrato', () => {
    const parsed = ConversationAutoReplySchema.safeParse({ replyText: 'x', handoffType: 'ligar' });
    expect(parsed.success).toBe(false);
  });
});
