import { describe, expect, it } from 'vitest';
import { buildEvolutionMessageMetadata } from './messageMetadata';

// Regressão do achado X: a metadata da mensagem NÃO pode voltar a carregar o payload
// cru do WhatsApp (raw_payload). Se alguém reintroduzir, este teste quebra.

describe('buildEvolutionMessageMetadata — não persiste payload cru (achado X)', () => {
  it('não inclui raw_payload e mantém só a proveniência mínima', () => {
    const md = buildEvolutionMessageMetadata({
      event: 'messages.upsert',
      providerMessageId: 'ABC123',
    });
    expect(md).not.toHaveProperty('raw_payload');
    expect(Object.keys(md).sort()).toEqual(['event', 'provider', 'provider_message_id']);
    expect(md.provider).toBe('evolution');
    expect(md.event).toBe('messages.upsert');
    expect(md.provider_message_id).toBe('ABC123');
  });

  it('aceita provider_message_id ausente', () => {
    const md = buildEvolutionMessageMetadata({ event: 'messages.upsert', providerMessageId: null });
    expect(md).not.toHaveProperty('raw_payload');
    expect(md.provider_message_id).toBeNull();
  });
});

// SPEC-midia-recebida: `media` entra em lista fechada. A igualdade exata de chaves continua sendo a
// trava contra campo novo silencioso (url, directPath, mediaKey, miniatura, payload cru).
describe('buildEvolutionMessageMetadata — mídia recebida', () => {
  const media = {
    kind: 'audio' as const,
    mimetype: 'audio/ogg; codecs=opus',
    seconds: 21,
    fileLength: 48211,
    isAnimated: false,
    isLottie: false,
    viewOnce: false,
    placeholder: true,
    status: 'recorded' as const,
  };

  it('sem mídia (ou media: null) a chave nem existe', () => {
    const md = buildEvolutionMessageMetadata({ event: 'messages.upsert', providerMessageId: 'ABC123', media: null });
    expect(Object.keys(md).sort()).toEqual(['event', 'provider', 'provider_message_id']);
  });

  it('com mídia, só os campos conhecidos são gravados', () => {
    const md = buildEvolutionMessageMetadata({
      event: 'messages.upsert',
      providerMessageId: 'ABC123',
      media: { ...media, url: 'https://mmg.whatsapp.net/x', mediaKey: 'segredo', jpegThumbnail: '/9j/4AAQ' } as typeof media,
    });
    expect(Object.keys(md).sort()).toEqual(['event', 'media', 'provider', 'provider_message_id']);
    expect(Object.keys(md.media ?? {}).sort()).toEqual([
      'fileLength',
      'isAnimated',
      'isLottie',
      'kind',
      'mimetype',
      'placeholder',
      'seconds',
      'status',
      'viewOnce',
    ]);
    expect(md.media).toEqual(media);
  });
});
