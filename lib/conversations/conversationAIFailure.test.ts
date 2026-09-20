import { describe, expect, it } from 'vitest';
import { buildConversationAIFailureNotification } from './conversationAIFailure';

describe('conversation AI failure notification', () => {
  it('gera alerta alto, idempotente e sem expor o erro interno ao usuario', () => {
    const notification = buildConversationAIFailureNotification({
      organizationId: '11111111-1111-4111-8111-111111111111',
      threadId: '22222222-2222-4222-8222-222222222222',
      eventId: '33333333-3333-4333-8333-333333333333:provider',
      contactLabel: 'Marina',
      stage: 'provider',
      createdAt: '2026-09-19T15:00:00.000Z',
    });

    expect(notification).toMatchObject({
      organization_id: '11111111-1111-4111-8111-111111111111',
      type: 'SYSTEM_ALERT',
      title: 'Atendimento automatico precisa de voce',
      severity: 'high',
      read_at: null,
      created_at: '2026-09-19T15:00:00.000Z',
    });
    expect(notification.message).toContain('Marina');
    expect(notification.message).not.toContain('provider');
  });
});
