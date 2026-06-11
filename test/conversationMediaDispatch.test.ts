// @vitest-environment node
//
// Unit test do dispatcher de mídia de conversa (server-side).
//
// Prova que `dispatchConversationMedia` roteia para a função Evolution certa
// (sendMedia para image/document/video; sendWhatsAppAudio para audio) e devolve
// metadata de entrega no MESMO formato do envio de texto (provider/provider_message_id/
// delivery_status/delivery_provider). Mídia/áudio são injetados (DI) — sem rede.
import { describe, expect, it, vi } from 'vitest';
import { dispatchConversationMedia } from '@/lib/conversations/conversationMedia';

const creds = {
  apiUrl: 'https://evo.example.com',
  instanceName: 'clinica',
  apiKey: 'K',
  phone: '5511999990000',
};

describe('dispatchConversationMedia', () => {
  it('roteia documento para sendMedia com fileName/caption/mimetype', async () => {
    const sendMedia = vi.fn(async () => ({
      raw: { ok: true },
      providerMessageId: 'PM_DOC',
      attemptLabel: 'sendMedia:document',
    }));
    const sendAudio = vi.fn();

    const result = await dispatchConversationMedia(
      {
        ...creds,
        attachment: {
          kind: 'document',
          mediaUrl: 'https://signed/orcamento.pdf',
          fileName: 'orcamento.pdf',
          caption: 'Seu orçamento',
          mimetype: 'application/pdf',
        },
      },
      { sendMedia, sendAudio }
    );

    expect(sendAudio).not.toHaveBeenCalled();
    expect(sendMedia).toHaveBeenCalledTimes(1);
    const arg = sendMedia.mock.calls[0][0];
    expect(arg).toMatchObject({
      instanceName: 'clinica',
      phone: '5511999990000',
      mediatype: 'document',
      media: 'https://signed/orcamento.pdf',
      fileName: 'orcamento.pdf',
      caption: 'Seu orçamento',
      mimetype: 'application/pdf',
    });

    expect(result.delivery_status).toBe('sent');
    expect(result.provider).toBe('evolution');
    expect(result.provider_message_id).toBe('PM_DOC');
    expect(result.delivery_provider).toBe('evolution');
  });

  it('roteia audio para sendWhatsAppAudio (não chama sendMedia)', async () => {
    const sendMedia = vi.fn();
    const sendAudio = vi.fn(async () => ({
      raw: { ok: true },
      providerMessageId: 'PM_AUDIO',
      attemptLabel: 'sendWhatsAppAudio',
    }));

    const result = await dispatchConversationMedia(
      {
        ...creds,
        attachment: { kind: 'audio', mediaUrl: 'https://signed/audio.ogg' },
      },
      { sendMedia, sendAudio }
    );

    expect(sendMedia).not.toHaveBeenCalled();
    expect(sendAudio).toHaveBeenCalledTimes(1);
    expect(sendAudio.mock.calls[0][0]).toMatchObject({
      instanceName: 'clinica',
      phone: '5511999990000',
      audio: 'https://signed/audio.ogg',
    });
    expect(result.delivery_status).toBe('sent');
    expect(result.provider_message_id).toBe('PM_AUDIO');
  });

  it('falha do provider vira delivery_status=failed + delivery_error (não joga exceção)', async () => {
    const sendMedia = vi.fn(async () => {
      throw new Error('boom provider');
    });
    const sendAudio = vi.fn();

    const result = await dispatchConversationMedia(
      {
        ...creds,
        attachment: { kind: 'image', mediaUrl: 'https://signed/foto.jpg' },
      },
      { sendMedia, sendAudio }
    );

    expect(result.delivery_status).toBe('failed');
    expect(result.delivery_error).toMatch(/boom provider/);
    expect(result.provider).toBe('evolution');
  });
});
