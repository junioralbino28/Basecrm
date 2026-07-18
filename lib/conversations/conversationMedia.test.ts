import { describe, expect, it, vi } from 'vitest';
import { dispatchConversationMedia } from './conversationMedia';

describe('dispatchConversationMedia', () => {
  it('preserva unknown quando o POST tem resultado ambíguo', async () => {
    const error = new Error('timeout depois do POST');
    Object.assign(error, { deliveryUnknown: true });

    const result = await dispatchConversationMedia(
      {
        apiUrl: 'https://evolution.example.com',
        instanceName: 'instance',
        apiKey: 'secret',
        phone: '5511999999999',
        attachment: {
          kind: 'video',
          mediaUrl: 'https://storage.example.com/video.mp4',
        },
      },
      {
        sendMedia: vi.fn(async () => {
          throw error;
        }),
        sendAudio: vi.fn(),
      },
    );

    expect(result.delivery_status).toBe('unknown');
    expect(result.provider_message_id).toBeUndefined();
  });
});
