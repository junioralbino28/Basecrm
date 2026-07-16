// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvolutionInstance } from './evolution';

describe('createEvolutionInstance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cria a instancia com o contrato R8 e extrai QR, codigo e nome da resposta', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({
        instance: { instanceName: 'comercial-vitoria-a1b2c3' },
        qrcode: {
          base64: 'data:image/png;base64,QR_BASE64',
          code: 'PAIR-1234',
        },
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createEvolutionInstance({
      apiUrl: 'https://evolution.example.com/',
      apiKey: 'GLOBAL-SECRET',
      instanceName: 'comercial-vitoria-a1b2c3',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/instance/create',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: {
          apikey: 'GLOBAL-SECRET',
          accept: 'application/json',
          'content-type': 'application/json',
        },
      }),
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      instanceName: 'comercial-vitoria-a1b2c3',
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      groupsIgnore: true,
      rejectCall: true,
      alwaysOnline: true,
    });
    expect(result).toEqual({
      raw: expect.any(Object),
      qrBase64: 'data:image/png;base64,QR_BASE64',
      pairingCode: 'PAIR-1234',
      instanceName: 'comercial-vitoria-a1b2c3',
    });
  });

  it('aceita payload flat e usa o nome solicitado quando a resposta nao repete o nome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ base64: 'iVBOR_FLAT', code: '887766' }),
    } as Response)));

    await expect(createEvolutionInstance({
      apiUrl: 'https://evolution.example.com',
      apiKey: 'KEY',
      instanceName: 'ia-julia-123abc',
    })).resolves.toMatchObject({
      qrBase64: 'iVBOR_FLAT',
      pairingCode: '887766',
      instanceName: 'ia-julia-123abc',
    });
  });
});
