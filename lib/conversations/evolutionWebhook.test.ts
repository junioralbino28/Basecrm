import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhookPayload } from './evolutionWebhook';

describe('parseEvolutionWebhookPayload — correlação de resposta', () => {
  it('extrai contextInfo.stanzaId de resposta citada', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: {
          id: 'inbound-1',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        message: {
          extendedTextMessage: {
            text: 'Tenho interesse',
            contextInfo: {
              stanzaId: 'outbound-quoted-1',
            },
          },
        },
        messageTimestamp: 1_720_000_000,
      },
    });

    expect(parsed).toMatchObject({
      providerMessageId: 'inbound-1',
      quotedProviderMessageId: 'outbound-quoted-1',
      direction: 'inbound',
    });
  });

  it('retorna quote nulo quando a conversa não cita mensagem', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: {
          id: 'inbound-2',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        message: { conversation: 'Mensagem nova' },
      },
    });

    expect(parsed?.quotedProviderMessageId).toBeNull();
  });
});
