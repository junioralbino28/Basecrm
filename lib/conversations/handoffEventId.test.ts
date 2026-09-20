import { describe, expect, it } from 'vitest';
import { buildConversationScopedEventId } from './handoffEventId';

describe('conversation scoped event id', () => {
  it('e deterministico dentro da mesma organizacao e conversa', () => {
    const input = {
      organizationId: '11111111-1111-4111-8111-111111111111',
      threadId: '22222222-2222-4222-8222-222222222222',
      eventId: '33333333-3333-4333-8333-333333333333',
    };

    const first = buildConversationScopedEventId(input);
    const second = buildConversationScopedEventId(input);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('gera outro id para o mesmo evento em outro tenant', () => {
    const common = {
      threadId: '22222222-2222-4222-8222-222222222222',
      eventId: '33333333-3333-4333-8333-333333333333',
    };

    expect(
      buildConversationScopedEventId({
        ...common,
        organizationId: '11111111-1111-4111-8111-111111111111',
      })
    ).not.toBe(
      buildConversationScopedEventId({
        ...common,
        organizationId: '99999999-9999-4999-8999-999999999999',
      })
    );
  });
});
