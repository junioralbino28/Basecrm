import { describe, expect, it } from 'vitest';
import { mergeConversationDeliveryMetadata } from './conversationDeliveryMetadata';

describe('conversation delivery metadata', () => {
  it('nao permite que metadado externo sobrescreva campos controlados pelo sistema', () => {
    expect(
      mergeConversationDeliveryMetadata(
        { provider: 'attacker', delivery_status: 'sent', campaign: 'meta-cenno' },
        { provider: 'evolution', delivery_status: 'failed' },
      )
    ).toEqual({
      provider: 'evolution',
      delivery_status: 'failed',
      campaign: 'meta-cenno',
    });
  });
});
