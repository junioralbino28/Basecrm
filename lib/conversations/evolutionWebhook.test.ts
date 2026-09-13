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

// Forma real do bloco, copiada de uma mensagem da Evolution (dataset de 08/09/2026).
const anuncio = {
  body: 'Você acha que já passou da idade para usar aparelho?\n\nMuitos adultos...',
  title: 'Seu sorriso ainda te incomoda? A ortodontia pode ajudar',
  ctwaClid: 'AfgqwIqB3-mpRoYkyPzyPoKC8f1vNZJjqFwQlDzmispEejiL5lMxOjC6uKbelx5BQGw5R',
  mediaUrl: 'https://www.facebook.com/reel/1006666038440643/',
  sourceId: '120250248464550131',
  mediaType: 2,
  sourceApp: 'instagram',
  sourceUrl: 'https://www.instagram.com/p/DZ3U3KwAssH/',
  thumbnail: '/9j/4AAQSkZJRgABAQAAAQABAAD/7QCEUGhvdG9zaG9w',
  sourceType: 'ad',
  showAdAttribution: true,
  clickToWhatsappCall: true,
  greetingMessageBody: '🟢 ONLINE | Seja bem-vindo (a) ao consultório',
  renderLargerThumbnail: true,
};

const chave = (id: string) => ({ id, remoteJid: '5522999990000@s.whatsapp.net', fromMe: false });

describe('parseEvolutionWebhookPayload — clique de anúncio (Click-to-WhatsApp)', () => {
  it('lê o bloco no nível do evento (como a Evolution entrega para `conversation`)', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: chave('ad-1'),
        pushName: 'Maria',
        message: { conversation: 'Olá! Vi o anúncio e quero agendar', messageContextInfo: {} },
        contextInfo: { mentionedJid: [], externalAdReply: anuncio },
        messageType: 'conversation',
        messageTimestamp: 1_720_000_000,
      },
    });

    expect(parsed?.direction).toBe('inbound');
    expect(parsed?.adClick).toEqual({
      ctwaClid: anuncio.ctwaClid,
      title: anuncio.title,
      sourceId: anuncio.sourceId,
      sourceUrl: anuncio.sourceUrl,
      sourceApp: 'instagram',
      sourceType: 'ad',
      mediaUrl: anuncio.mediaUrl,
    });
    // Nada de thumbnail, corpo do anúncio ou saudação: só etiqueta e identidade do anúncio.
    expect(Object.keys(parsed!.adClick!)).not.toContain('thumbnail');
    expect(Object.keys(parsed!.adClick!)).not.toContain('body');
    expect(Object.keys(parsed!.adClick!)).not.toContain('greetingMessageBody');
  });

  it('lê o bloco dentro do tipo da mensagem e aceita interactiveMessage como texto', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: chave('ad-2'),
        message: {
          interactiveMessage: {
            body: { text: 'Quero saber mais sobre facetas' },
            contextInfo: { externalAdReply: anuncio },
          },
        },
      },
    });

    expect(parsed?.content).toBe('Quero saber mais sobre facetas');
    expect(parsed?.adClick?.ctwaClid).toBe(anuncio.ctwaClid);
    expect(parsed?.adClick?.sourceId).toBe(anuncio.sourceId);
  });

  it('ignora o anúncio de uma mensagem CITADA: ele é da outra mensagem, não desta', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: chave('reply-1'),
        message: {
          extendedTextMessage: {
            text: 'respondendo',
            contextInfo: {
              stanzaId: 'ad-1',
              quotedMessage: {
                extendedTextMessage: { text: 'Olá', contextInfo: { externalAdReply: anuncio } },
              },
            },
          },
        },
      },
    });

    expect(parsed?.quotedProviderMessageId).toBe('ad-1');
    expect(parsed?.adClick).toBeNull();
  });

  it('mensagem comum sem anúncio → adClick nulo', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: { key: chave('txt-1'), message: { conversation: 'Bom dia' } },
    });

    expect(parsed?.adClick).toBeNull();
  });

  it('aceita snake_case e bloco só com id do anúncio; bloco vazio não conta', () => {
    const snake = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: chave('ad-3'),
        message: { conversation: 'oi' },
        contextInfo: { externalAdReply: { ctwa_clid: 'Afx123', source_id: '999', source_app: 'facebook' } },
      },
    });
    expect(snake?.adClick).toMatchObject({ ctwaClid: 'Afx123', sourceId: '999', sourceApp: 'facebook' });

    const soAnuncio = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: chave('ad-4'),
        message: { conversation: 'oi' },
        contextInfo: { externalAdReply: { title: 'Sem etiqueta', sourceId: '777' } },
      },
    });
    expect(soAnuncio?.adClick).toMatchObject({ ctwaClid: null, sourceId: '777', title: 'Sem etiqueta' });

    const vazio = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: chave('ad-5'),
        message: { conversation: 'oi' },
        contextInfo: { externalAdReply: { title: 'Só título', showAdAttribution: true } },
      },
    });
    expect(vazio?.adClick).toBeNull();
  });

  it('corta campos absurdamente longos em 512 caracteres', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: chave('ad-6'),
        message: { conversation: 'oi' },
        contextInfo: { externalAdReply: { ctwaClid: 'A'.repeat(2000), title: 'T'.repeat(600) } },
      },
    });

    expect(parsed?.adClick?.ctwaClid).toHaveLength(512);
    expect(parsed?.adClick?.title).toHaveLength(512);
  });
});
