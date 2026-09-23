import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhookPayload } from './evolutionWebhook';
import { buildConversationThreadMetadataUpdate, readConversationThreadMetadata } from './threadMetadata';

/**
 * Ponto de entrada de quem chega SEM anúncio pago (Junior, 23/09/2026).
 *
 * Ele clicou no botão "Chamar no WhatsApp" de um Reels e estranhou que nem a mensagem automática
 * apareceu. Medido no payload real: o WhatsApp mandou `contextInfo.entryPointConversionSource =
 * "post_cta"`, ou seja botão de PUBLICAÇÃO, não anúncio — e o CRM descartava isso inteiro, então a
 * conversa entrava sem origem nenhuma.
 *
 * A distinção que estes testes trancam: ponto de entrada NÃO é clique de anúncio. Sem `ctwa_clid`
 * a Meta não liga a conversa a campanha nenhuma; se os dois se misturassem, conversa orgânica
 * apareceria como "veio do anúncio X" e a atribuição de conversão passaria a mentir.
 */

// Copiado do payload real do teste do Junior (23/09/2026, 06:42:01Z), puxado da Evolution por
// `POST /chat/findMessages`. O CRM não guarda o payload; a Evolution guarda.
const REELS_ORGANICO = {
  event: 'messages.upsert',
  data: {
    key: { id: 'ACAD83B4392833195D9CD81605B87B15', remoteJid: '5521999999999@s.whatsapp.net', fromMe: false },
    message: { conversation: 'Oi' },
    contextInfo: {
      entryPointConversionApp: 'instagram',
      entryPointConversionSource: 'post_cta',
      entryPointConversionDelaySeconds: 84,
    },
    messageTimestamp: 1_789_769_834,
  },
};

const ANUNCIO_PAGO = {
  event: 'messages.upsert',
  data: {
    key: { id: 'inbound-ad', remoteJid: '5521999999999@s.whatsapp.net', fromMe: false },
    message: { conversation: 'Vi o anúncio' },
    contextInfo: {
      entryPointConversionApp: 'instagram',
      entryPointConversionSource: 'ctwa',
      externalAdReply: {
        ctwaClid: 'AfgqwIqB3-mpRoYkyPzyPoKC8f1vNZJjqFwQ',
        sourceId: '120256890905340211',
        sourceApp: 'instagram',
        title: 'Coisa que ninguém te fala',
      },
    },
    messageTimestamp: 1_789_769_900,
  },
};

describe('ponto de entrada orgânico — o que o CRM jogava fora', () => {
  it('lê app, origem e atraso do Reels orgânico (payload real do Junior)', () => {
    const parsed = parseEvolutionWebhookPayload(REELS_ORGANICO);

    expect(parsed?.entryPoint).toEqual({
      app: 'instagram',
      source: 'post_cta',
      delaySeconds: 84,
      hadAdReply: false,
    });
  });

  it('NÃO inventa clique de anúncio a partir do ponto de entrada', () => {
    const parsed = parseEvolutionWebhookPayload(REELS_ORGANICO);

    // Este é o ponto inteiro: sem `ctwa_clid` a Meta não liga isto a campanha nenhuma.
    expect(parsed?.adClick).toBeNull();
  });

  it('em anúncio de verdade, os dois convivem e `hadAdReply` marca que houve bloco', () => {
    const parsed = parseEvolutionWebhookPayload(ANUNCIO_PAGO);

    expect(parsed?.adClick?.ctwaClid).toBe('AfgqwIqB3-mpRoYkyPzyPoKC8f1vNZJjqFwQ');
    expect(parsed?.adClick?.sourceId).toBe('120256890905340211');
    expect(parsed?.entryPoint).toMatchObject({ source: 'ctwa', hadAdReply: true });
  });

  it('conversa sem sinal nenhum de origem devolve null — não enche o metadata', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: { id: 'inbound-seco', remoteJid: '5521999999999@s.whatsapp.net', fromMe: false },
        message: { conversation: 'Oi' },
      },
    });

    expect(parsed?.entryPoint).toBeNull();
    expect(parsed?.adClick).toBeNull();
  });

  it('acha o contexto dentro do tipo da mensagem, não só no topo do evento', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: { id: 'inbound-ext', remoteJid: '5521999999999@s.whatsapp.net', fromMe: false },
        message: {
          extendedTextMessage: {
            text: 'Oi',
            contextInfo: { entryPointConversionApp: 'facebook', entryPointConversionSource: 'profile_cta' },
          },
        },
      },
    });

    expect(parsed?.entryPoint).toMatchObject({ app: 'facebook', source: 'profile_cta' });
  });
});

describe('ponto de entrada no metadata da conversa', () => {
  const ENTRADA = {
    app: 'instagram',
    source: 'post_cta',
    delaySeconds: 84,
    hadAdReply: false,
    at: '2026-09-23T06:42:01.000Z',
  };

  it('o primeiro ponto de entrada nunca é sobrescrito; o último acompanha', () => {
    const primeiro = buildConversationThreadMetadataUpdate({}, { entryPoint: ENTRADA });
    const depois = buildConversationThreadMetadataUpdate(primeiro, {
      entryPoint: { ...ENTRADA, source: 'profile_cta', at: '2026-09-24T10:00:00.000Z' },
    });

    expect(depois.firstEntryPoint?.source).toBe('post_cta');
    expect(depois.lastEntryPoint?.source).toBe('profile_cta');
  });

  it('mensagem seguinte sem ponto de entrada não apaga o que já havia', () => {
    const primeiro = buildConversationThreadMetadataUpdate({}, { entryPoint: ENTRADA });
    const depois = buildConversationThreadMetadataUpdate(primeiro, { preview: 'oi de novo' });

    expect(depois.firstEntryPoint?.source).toBe('post_cta');
    expect(depois.lastEntryPoint?.source).toBe('post_cta');
  });

  it('ponto de entrada NÃO vira clique de anúncio no metadata', () => {
    const meta = buildConversationThreadMetadataUpdate({}, { entryPoint: ENTRADA });

    expect(meta.firstAdClick).toBeNull();
    expect(meta.lastAdClick).toBeNull();
  });

  it('registro sem app nem origem é descartado na leitura (não diz nada sobre procedência)', () => {
    const lido = readConversationThreadMetadata({
      firstEntryPoint: { app: null, source: null, delaySeconds: null, hadAdReply: true, at: 'x' },
    });

    expect(lido.firstEntryPoint).toBeNull();
  });

  it('atraso inválido não contamina o registro', () => {
    const lido = readConversationThreadMetadata({
      lastEntryPoint: { app: 'instagram', source: 'post_cta', delaySeconds: -5, hadAdReply: false, at: null },
    });

    expect(lido.lastEntryPoint).toMatchObject({ app: 'instagram', delaySeconds: null });
  });
});
