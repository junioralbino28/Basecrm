import { describe, expect, it, vi } from 'vitest';
import {
  dispatchConversationOutbound,
  type OutboundDeliveryOutcome,
} from './dispatchConversationOutbound';

describe('dispatchConversationOutbound', () => {
  it('persiste pending antes do efeito externo e finaliza como sent', async () => {
    const order: string[] = [];
    const sent: OutboundDeliveryOutcome = {
      status: 'sent',
      providerMessageId: 'provider-1',
      attemptLabel: 'sendText:number+text',
      error: null,
      metadata: { provider: 'evolution' },
    };

    const result = await dispatchConversationOutbound(
      { mode: 'manual', idempotencyKey: 'manual-1' },
      {
        prepare: vi.fn(async () => {
          order.push('prepare');
          return { messageId: 'message-1', isNew: true, status: 'pending' };
        }),
        deliver: vi.fn(async () => {
          order.push('deliver');
          return sent;
        }),
        complete: vi.fn(async (_prepared, outcome) => {
          order.push('complete');
          return { messageId: 'message-1', ...outcome };
        }),
      },
    );

    expect(order).toEqual(['prepare', 'deliver', 'complete']);
    expect(result).toMatchObject({
      messageId: 'message-1',
      status: 'sent',
      providerMessageId: 'provider-1',
    });
  });

  it('não repete efeito quando a idempotency_key já existe', async () => {
    const deliver = vi.fn();
    const complete = vi.fn();

    const result = await dispatchConversationOutbound(
      { mode: 'manual', idempotencyKey: 'manual-repeat' },
      {
        prepare: async () => ({
          messageId: 'message-existing',
          isNew: false,
          status: 'sent',
          providerMessageId: 'provider-existing',
        }),
        deliver,
        complete,
      },
    );

    expect(deliver).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      messageId: 'message-existing',
      status: 'sent',
      providerMessageId: 'provider-existing',
      duplicate: true,
    });
  });

  it('timeout ambíguo vira unknown e nunca dispara retry cego', async () => {
    const deliver = vi.fn(async () => {
      const error = new Error('timeout depois do POST');
      Object.assign(error, { deliveryUnknown: true });
      throw error;
    });
    const complete = vi.fn(async (_prepared, outcome) => ({
      messageId: 'message-unknown',
      ...outcome,
    }));

    const result = await dispatchConversationOutbound(
      { mode: 'manual', idempotencyKey: 'manual-timeout' },
      {
        prepare: async () => ({
          messageId: 'message-unknown',
          isNew: true,
          status: 'pending',
        }),
        deliver,
        complete,
      },
    );

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('unknown');
  });

  it('simulation registra decisão sem resolver credencial, adapter ou provider ID', async () => {
    const resolveCredentials = vi.fn();
    const deliver = vi.fn();
    const complete = vi.fn(async (_prepared, outcome) => ({
      messageId: 'message-simulated',
      ...outcome,
    }));

    const result = await dispatchConversationOutbound(
      { mode: 'automation_simulation', idempotencyKey: 'job-simulation' },
      {
        prepare: async () => ({
          messageId: 'message-simulated',
          isNew: true,
          status: 'pending',
        }),
        resolveCredentials,
        deliver,
        complete,
      },
    );

    expect(resolveCredentials).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'simulated',
      providerMessageId: null,
    });
  });
});
