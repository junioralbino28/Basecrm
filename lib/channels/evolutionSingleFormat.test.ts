// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvolutionDeliveryUnknownError, sendEvolutionTextMessage } from './evolution';

const base = {
  apiUrl: 'http://evolution.local',
  instanceName: 'inst',
  apiKey: 'chave',
  phone: '5511999999999',
  text: 'oi',
};

describe('sendEvolutionTextMessage — formato único e aborto (executor de automações)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('com singleFormat manda UM POST no formato configurado e não cai para os outros em 4xx', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'numero invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendEvolutionTextMessage({ ...base, sendMode: 'number_message', singleFormat: true }))
      .rejects.toThrow(/numero invalido/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ number: base.phone, message: 'oi' });
  });

  it('sem singleFormat continua tentando os quatro formatos (caminho manual/IA, inalterado)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'x' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendEvolutionTextMessage({ ...base })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('o AbortSignal chega ao fetch e o aborto vira entrega desconhecida (nunca reenvio)', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendEvolutionTextMessage({ ...base, signal: controller.signal, singleFormat: true });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(EvolutionDeliveryUnknownError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
