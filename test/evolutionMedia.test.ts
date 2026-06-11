// @vitest-environment node
//
// Unit test das funções de envio de mídia/áudio da Evolution (server-side).
//
// Prova o contrato dos endpoints `/message/sendMedia/{instance}` e
// `/message/sendWhatsAppAudio/{instance}` SEM tocar a rede: `fetch` é mockado.
// Espelha o padrão server-side do `sendEvolutionTextMessage` (apikey header,
// parseEvolutionResponse, providerMessageId).
//
// NÃO-tautológico: assere a URL exata, o método, o header `apikey` e o body
// (mediatype/media/caption/fileName para mídia; number/audio para áudio), e que
// erro HTTP do provider vira throw com mensagem útil.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sendEvolutionMediaMessage,
  sendEvolutionAudioMessage,
} from '@/lib/channels/evolution';

type FetchCall = { url: string; init: RequestInit };

function mockFetchOnce(response: {
  ok?: boolean;
  status?: number;
  body: unknown;
}) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: async () =>
        typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

function parseBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body));
}

describe('sendEvolutionMediaMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /message/sendMedia/{instance} com number + mediatype + media + caption + fileName e apikey no header', async () => {
    const { calls } = mockFetchOnce({ body: { key: { id: 'MSG_MEDIA_1' } } });

    const result = await sendEvolutionMediaMessage({
      apiUrl: 'https://evo.example.com/',
      instanceName: 'clinica-jessica',
      apiKey: 'SECRET-KEY',
      phone: '5511999990000',
      mediatype: 'document',
      media: 'https://signed.example.com/orcamento.pdf',
      caption: 'Seu orçamento',
      fileName: 'orcamento-pedro.pdf',
      mimetype: 'application/pdf',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://evo.example.com/message/sendMedia/clinica-jessica'
    );
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe('SECRET-KEY');

    const body = parseBody(calls[0]);
    expect(body.number).toBe('5511999990000');
    expect(body.mediatype).toBe('document');
    expect(body.media).toBe('https://signed.example.com/orcamento.pdf');
    expect(body.caption).toBe('Seu orçamento');
    expect(body.fileName).toBe('orcamento-pedro.pdf');
    expect(body.mimetype).toBe('application/pdf');

    expect(result.providerMessageId).toBe('MSG_MEDIA_1');
  });

  it('instanceName é URL-encoded e a barra final do apiUrl é normalizada', async () => {
    const { calls } = mockFetchOnce({ body: { key: { id: 'x' } } });

    await sendEvolutionMediaMessage({
      apiUrl: 'https://evo.example.com///',
      instanceName: 'inst a/b',
      apiKey: 'K',
      phone: '5511999990000',
      mediatype: 'image',
      media: 'https://signed.example.com/foto.jpg',
    });

    expect(calls[0].url).toBe(
      'https://evo.example.com/message/sendMedia/inst%20a%2Fb'
    );
  });

  it('erro HTTP do provider vira throw com a mensagem do corpo', async () => {
    mockFetchOnce({ ok: false, status: 400, body: 'numero invalido' });

    await expect(
      sendEvolutionMediaMessage({
        apiUrl: 'https://evo.example.com',
        instanceName: 'i',
        apiKey: 'K',
        phone: 'bad',
        mediatype: 'image',
        media: 'https://x/y.jpg',
      })
    ).rejects.toThrow(/numero invalido/);
  });
});

describe('sendEvolutionAudioMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /message/sendWhatsAppAudio/{instance} com number + audio e apikey no header', async () => {
    const { calls } = mockFetchOnce({ body: { key: { id: 'MSG_AUDIO_1' } } });

    const result = await sendEvolutionAudioMessage({
      apiUrl: 'https://evo.example.com',
      instanceName: 'clinica-jessica',
      apiKey: 'SECRET-KEY',
      phone: '5511999990000',
      audio: 'https://signed.example.com/audio.ogg',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://evo.example.com/message/sendWhatsAppAudio/clinica-jessica'
    );
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe('SECRET-KEY');

    const body = parseBody(calls[0]);
    expect(body.number).toBe('5511999990000');
    expect(body.audio).toBe('https://signed.example.com/audio.ogg');

    expect(result.providerMessageId).toBe('MSG_AUDIO_1');
  });
});
