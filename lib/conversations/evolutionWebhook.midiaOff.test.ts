import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhookPayload } from './evolutionWebhook';

/**
 * TRAVA DO COMPORTAMENTO ATUAL (SPEC-midia-recebida v2, Passo 0).
 *
 * O parser é compartilhado por todos os números de todos os tenants. A obra de mídia recebida entra atrás
 * de uma chave por conexão (`config.media.mode`), e com a chave desligada NADA pode mudar. Este arquivo
 * congela o que o parser faz hoje, inclusive o que ele descarta: mensagem só de mídia devolve `null`
 * e por isso nunca vira contato, negócio, resposta à régua de automação nem evento para a Meta.
 *
 * Se um teste daqui quebrar, a mudança vazou para quem está com a chave desligada.
 */

const JID = '5521999990000@s.whatsapp.net';

function payload(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    event: 'messages.upsert',
    instance: 'teste',
    data: {
      key: { id: 'MSG-1', remoteJid: JID, fromMe: false },
      pushName: 'Maria',
      message,
      messageTimestamp: 1_790_000_000,
      ...extra,
    },
  };
}

describe('parser com a chave de mídia desligada: texto continua como sempre', () => {
  it('conversation', () => {
    const parsed = parseEvolutionWebhookPayload(payload({ conversation: '  oi, tudo bem?  ' }));
    expect(parsed).toMatchObject({
      content: 'oi, tudo bem?',
      messageType: 'conversation',
      direction: 'inbound',
      contactPhone: '5521999990000',
      contactName: 'Maria',
      providerMessageId: 'MSG-1',
      sentAt: new Date(1_790_000_000 * 1000).toISOString(),
    });
  });

  it('extendedTextMessage', () => {
    const parsed = parseEvolutionWebhookPayload(payload({ extendedTextMessage: { text: 'mensagem longa' } }));
    expect(parsed?.content).toBe('mensagem longa');
    expect(parsed?.messageType).toBe('extendedTextMessage');
  });

  it('botão, lista, template e resposta interativa', () => {
    expect(parseEvolutionWebhookPayload(payload({ buttonsResponseMessage: { selectedDisplayText: 'Sim' } }))?.content).toBe('Sim');
    expect(parseEvolutionWebhookPayload(payload({ listResponseMessage: { title: 'Opção A' } }))?.content).toBe('Opção A');
    expect(
      parseEvolutionWebhookPayload(payload({ listResponseMessage: { singleSelectReply: { selectedRowId: 'row-1' } } }))?.content,
    ).toBe('row-1');
    expect(parseEvolutionWebhookPayload(payload({ templateButtonReplyMessage: { selectedDisplayText: 'Quero' } }))?.content).toBe('Quero');
    expect(parseEvolutionWebhookPayload(payload({ interactiveResponseMessage: { body: { text: 'ok' } } }))?.content).toBe('ok');
  });

  it('primeira mensagem de anúncio como interactiveMessage', () => {
    const parsed = parseEvolutionWebhookPayload(payload({ interactiveMessage: { body: { text: 'Olá! Tenho interesse' } } }));
    expect(parsed?.content).toBe('Olá! Tenho interesse');
  });

  it('mensagem enviada pelo próprio número é outbound', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: { key: { id: 'MSG-2', remoteJid: JID, fromMe: true }, message: { conversation: 'resposta do atendente' } },
    });
    expect(parsed?.direction).toBe('outbound');
  });

  it('grupo é ignorado', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: { key: { id: 'MSG-3', remoteJid: '120363000000000000@g.us', fromMe: false }, message: { conversation: 'oi grupo' } },
    });
    expect(parsed).toBeNull();
  });
});

describe('parser com a chave de mídia desligada: mídia COM legenda grava a legenda crua', () => {
  it('imagem com legenda: content é só a legenda, sem prefixo', () => {
    const parsed = parseEvolutionWebhookPayload(
      payload({ imageMessage: { caption: 'olha esse print', mimetype: 'image/jpeg', url: 'https://mmg.whatsapp.net/x' } }),
    );
    expect(parsed?.content).toBe('olha esse print');
    expect(parsed?.messageType).toBe('imageMessage');
  });

  it('vídeo com legenda', () => {
    const parsed = parseEvolutionWebhookPayload(payload({ videoMessage: { caption: 'vídeo da loja', mimetype: 'video/mp4' } }));
    expect(parsed?.content).toBe('vídeo da loja');
  });

  it('documento: legenda, e na falta dela o nome do arquivo', () => {
    expect(
      parseEvolutionWebhookPayload(payload({ documentMessage: { caption: 'segue a proposta', fileName: 'proposta.pdf' } }))?.content,
    ).toBe('segue a proposta');
    expect(parseEvolutionWebhookPayload(payload({ documentMessage: { fileName: 'proposta.pdf' } }))?.content).toBe('proposta.pdf');
  });
});

describe('parser com a chave de mídia desligada: mídia SEM texto continua descartada (null)', () => {
  const semTexto: Array<[string, Record<string, unknown>]> = [
    ['nota de voz', { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 21, ptt: true, fileLength: '48211' } }],
    ['imagem sem legenda', { imageMessage: { mimetype: 'image/jpeg', width: 1200, height: 1600 } }],
    ['figurinha estática', { stickerMessage: { mimetype: 'image/webp', isAnimated: false } }],
    ['figurinha animada', { stickerMessage: { mimetype: 'image/webp', isAnimated: true } }],
    ['GIF (vídeo com gifPlayback) sem legenda', { videoMessage: { mimetype: 'video/mp4', gifPlayback: true, seconds: 3 } }],
    ['vídeo sem legenda', { videoMessage: { mimetype: 'video/mp4', seconds: 12 } }],
    ['localização', { locationMessage: { degreesLatitude: -22.9, degreesLongitude: -43.2 } }],
    ['contato', { contactMessage: { displayName: 'João', vcard: 'BEGIN:VCARD\nEND:VCARD' } }],
    ['imagem de ver uma vez', { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } }],
    ['nota de voz com messageContextInfo na frente', { messageContextInfo: { deviceListMetadataVersion: 2 }, audioMessage: { seconds: 5, ptt: true } }],
  ];

  it.each(semTexto)('%s', (_nome, message) => {
    expect(parseEvolutionWebhookPayload(payload(message))).toBeNull();
  });

  it('texto dentro de conversa com mensagens temporárias (ephemeralMessage) também é descartado hoje', () => {
    // Dívida pré-existente nº 4 da SPEC: o parser não olha dentro do embrulho. Registrado como comportamento atual.
    const parsed = parseEvolutionWebhookPayload(payload({ ephemeralMessage: { message: { conversation: 'mensagem temporária' } } }));
    expect(parsed).toBeNull();
  });

  it('legenda vazia ou só com espaços conta como sem texto', () => {
    expect(parseEvolutionWebhookPayload(payload({ imageMessage: { caption: '   ', mimetype: 'image/jpeg' } }))).toBeNull();
  });
});

describe('parser com a chave de mídia desligada: tipo e nome como são hoje', () => {
  it('messageType é a primeira chave do objeto message', () => {
    const parsed = parseEvolutionWebhookPayload(payload({ conversation: 'oi', messageContextInfo: {} }));
    expect(parsed?.messageType).toBe('conversation');
  });

  it('contactName vem do pushName, só com trim', () => {
    const parsed = parseEvolutionWebhookPayload(payload({ conversation: 'oi' }, { pushName: '  Maria   Souza ' }));
    expect(parsed?.contactName).toBe('Maria   Souza');
  });
});
