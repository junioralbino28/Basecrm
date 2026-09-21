import { describe, expect, it, vi } from 'vitest';
import { downloadEvolutionMedia } from './evolutionMedia';

// IP público literal: a guarda de URL aceita sem consultar DNS (teste sem rede).
const API_URL = 'https://93.184.216.34/';
const ENVELOPE = {
  key: { id: 'MSG-1', remoteJid: '5521999990000@s.whatsapp.net', fromMe: false },
  message: { audioMessage: { seconds: 21, mediaKey: 'K' } },
};

const base = { apiUrl: API_URL, apiKey: 'EVOLUTION-KEY', instanceName: 'aurora teste', envelope: ENVELOPE, maxBytes: 1024 };

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

/** Resposta em pedaços, sem content-length, contando quantos pedaços foram puxados. */
function streamedResponse(chunks: Uint8Array[]) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled < chunks.length) controller.enqueue(chunks[pulled++]);
      else controller.close();
    },
  });
  return { response: new Response(stream, { status: 200 }), pulled: () => pulled };
}

describe('downloadEvolutionMedia', () => {
  it('pede à Evolution com o envelope fechado e devolve os bytes decodificados', async () => {
    const bytes = Buffer.from('conteudo-do-audio');
    const fetchImpl = vi.fn(async () => jsonResponse({ mediaType: 'audioMessage', fileName: 'audio.oga', mimetype: 'audio/ogg; codecs=opus', base64: bytes.toString('base64') }));

    const result = await downloadEvolutionMedia({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toMatchObject({ ok: true, mimetype: 'audio/ogg; codecs=opus', fileName: 'audio.oga', attempts: 1 });
    expect(result.ok && Buffer.from(result.bytes).toString()).toBe('conteudo-do-audio');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://93.184.216.34/chat/getBase64FromMediaMessage/aurora%20teste');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({ apikey: 'EVOLUTION-KEY' });
    expect(JSON.parse(String(init.body))).toEqual({ message: ENVELOPE, convertToMp4: false });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('endereço interno é recusado antes de qualquer chamada (a chave não sai)', async () => {
    const fetchImpl = vi.fn();
    const result = await downloadEvolutionMedia({ ...base, apiUrl: 'http://10.0.0.5', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'url_rejected', attempts: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('payload mentiroso: resposta maior que o teto é abortada NO MEIO da leitura', async () => {
    const chunk = new Uint8Array(32 * 1024).fill(65);
    const streamed = streamedResponse(Array.from({ length: 200 }, () => chunk)); // 6,4 MB para um teto de 1 KB
    const result = await downloadEvolutionMedia({ ...base, fetchImpl: (async () => streamed.response) as unknown as typeof fetch });

    expect(result).toEqual({ ok: false, reason: 'too_large', attempts: 1 });
    expect(streamed.pulled()).toBeLessThan(10);
  });

  it('content-length acima do teto: nem começa a ler', async () => {
    const response = new Response('x', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } });
    const result = await downloadEvolutionMedia({ ...base, fetchImpl: (async () => response) as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'too_large', attempts: 1 });
  });

  it('o teto vale sobre os bytes decodificados, não sobre o que o payload declarou', async () => {
    const big = Buffer.alloc(1025, 1).toString('base64');
    const result = await downloadEvolutionMedia({ ...base, fetchImpl: (async () => jsonResponse({ base64: big })) as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'too_large', attempts: 1 });

    const exact = Buffer.alloc(1024, 1).toString('base64');
    const ok = await downloadEvolutionMedia({ ...base, fetchImpl: (async () => jsonResponse({ base64: exact })) as unknown as typeof fetch });
    expect(ok.ok).toBe(true);
  });

  it('Evolution devolve null (não decriptou), texto solto ou base64 vazio: falha sem segunda tentativa', async () => {
    for (const [body, reason] of [[null, 'invalid_response'], [{ mimetype: 'image/webp' }, 'invalid_response'], [{ base64: '' }, 'empty']] as const) {
      const fetchImpl = vi.fn(async () => jsonResponse(body));
      const result = await downloadEvolutionMedia({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(result).toEqual({ ok: false, reason, attempts: 1 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
    const html = await downloadEvolutionMedia({ ...base, fetchImpl: (async () => new Response('<html>erro</html>', { status: 200 })) as unknown as typeof fetch });
    expect(html).toEqual({ ok: false, reason: 'invalid_response', attempts: 1 });
  });

  it('erro do servidor (5xx) tenta de novo uma vez; erro do pedido (4xx) não', async () => {
    const bytes = Buffer.from('ok').toString('base64');
    const flaky = vi.fn().mockResolvedValueOnce(new Response('boom', { status: 502 })).mockResolvedValueOnce(jsonResponse({ base64: bytes }));
    expect(await downloadEvolutionMedia({ ...base, fetchImpl: flaky as unknown as typeof fetch })).toMatchObject({ ok: true, attempts: 2 });

    const down = vi.fn(async () => new Response('boom', { status: 500 }));
    expect(await downloadEvolutionMedia({ ...base, fetchImpl: down as unknown as typeof fetch })).toEqual({ ok: false, reason: 'http_error', status: 500, attempts: 2 });
    expect(down).toHaveBeenCalledTimes(2);

    const bad = vi.fn(async () => new Response('{"message":"Message not found"}', { status: 400 }));
    expect(await downloadEvolutionMedia({ ...base, fetchImpl: bad as unknown as typeof fetch })).toEqual({ ok: false, reason: 'http_error', status: 400, attempts: 1 });
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('tempo esgotado e queda de rede: até 2 tentativas, e o motivo não carrega a mensagem do erro', async () => {
    const timeout = vi.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
    expect(await downloadEvolutionMedia({ ...base, fetchImpl: timeout as unknown as typeof fetch })).toEqual({ ok: false, reason: 'timeout', attempts: 2 });
    expect(timeout).toHaveBeenCalledTimes(2);

    const network = vi.fn(async () => { throw new TypeError('fetch failed: apikey=EVOLUTION-KEY'); });
    const result = await downloadEvolutionMedia({ ...base, attempts: 1, fetchImpl: network as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'network', attempts: 1 });
    expect(JSON.stringify(result)).not.toContain('EVOLUTION-KEY');
  });

  it('mimetype e nome do arquivo voltam cortados e numa linha só', async () => {
    const result = await downloadEvolutionMedia({
      ...base,
      fetchImpl: (async () => jsonResponse({ base64: Buffer.from('x').toString('base64'), mimetype: `image/jpeg\nIGNORE ${'y'.repeat(300)}`, fileName: 42 })) as unknown as typeof fetch,
    });
    expect(result.ok && result.mimetype?.includes('\n')).toBe(false);
    expect(result.ok && result.mimetype?.length).toBe(100);
    expect(result.ok && result.fileName).toBeNull();
  });
});
