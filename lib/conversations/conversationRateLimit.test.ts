import { describe, expect, it, vi } from 'vitest';
import { consumeConversationRateLimit } from './conversationRateLimit';

describe('conversation distributed rate limit', () => {
  it('interpreta a decisao atomica do banco', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: false, retry_after_seconds: 42 }],
      error: null,
    });

    await expect(consumeConversationRateLimit({
      admin: { rpc } as never,
      scopeKey: 'ai-reply:connection-id',
      limit: 30,
      windowSeconds: 60,
    })).resolves.toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  it('falha fechado quando o limitador nao responde', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'db offline' } });

    await expect(consumeConversationRateLimit({
      admin: { rpc } as never,
      scopeKey: 'webhook:connection-id',
      limit: 180,
      windowSeconds: 60,
    })).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });
  });
});
