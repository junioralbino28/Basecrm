import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleApiError,
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserInfo,
  queryGoogleFreeBusy,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from './googleApiClient';

afterEach(() => vi.restoreAllMocks());

describe('googleApiClient — unico ponto de fetch para o Google', () => {
  it('troca o code por tokens via POST form-urlencoded no endpoint de token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-1', scope: 'a b' }), { status: 200 }),
    );

    const result = await exchangeGoogleAuthorizationCode({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      code: 'code-1',
      redirectUri: 'https://crm.basea2.com/api/integrations/google-calendar/callback',
    });

    expect(result.access_token).toBe('at-1');
    expect(result.refresh_token).toBe('rt-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('redirect_uri')).toBe('https://crm.basea2.com/api/integrations/google-calendar/callback');
  });

  it('renova o access token com grant_type=refresh_token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'at-2', expires_in: 3599 }), { status: 200 }),
    );
    const result = await refreshGoogleAccessToken({
      clientId: 'client-1', clientSecret: 'secret-1', refreshToken: 'rt-1',
    });
    expect(result.access_token).toBe('at-2');
  });

  it('classifica invalid_grant a partir do corpo de erro do Google', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 }),
    );

    await expect(refreshGoogleAccessToken({
      clientId: 'client-1', clientSecret: 'secret-1', refreshToken: 'rt-morto',
    })).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('propaga erro generico (5xx) sem codigo quando o corpo nao tem `error`', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    const error = await refreshGoogleAccessToken({
      clientId: 'client-1', clientSecret: 'secret-1', refreshToken: 'rt-1',
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect((error as GoogleApiError).status).toBe(503);
    expect((error as GoogleApiError).code).toBeNull();
  });

  it('revoke e melhor esforco: devolve false em erro de rede, nunca lanca', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(revokeGoogleToken({ token: 'rt-1' })).resolves.toBe(false);
  });

  it('revoke devolve true quando o Google confirma com 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await expect(revokeGoogleToken({ token: 'rt-1' })).resolves.toBe(true);
  });

  it('le o e-mail da conta via userinfo com Bearer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ email: 'cenourahub@gmail.com' }), { status: 200 }),
    );
    const result = await fetchGoogleUserInfo({ accessToken: 'at-1' });
    expect(result.email).toBe('cenourahub@gmail.com');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer at-1');
  });

  it('freeBusy: extrai os intervalos ocupados do calendario pedido', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        calendars: {
          primary: { busy: [{ start: '2026-09-21T12:30:00Z', end: '2026-09-21T15:30:00Z' }] },
        },
      }), { status: 200 }),
    );
    const intervals = await queryGoogleFreeBusy({
      accessToken: 'at-1', calendarId: 'primary', timeMin: '2026-09-21T00:00:00Z', timeMax: '2026-09-22T00:00:00Z',
    });
    expect(intervals).toEqual([{ start: '2026-09-21T12:30:00Z', end: '2026-09-21T15:30:00Z' }]);
  });

  it('freeBusy: 401 vira GoogleApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 }),
    );
    await expect(queryGoogleFreeBusy({
      accessToken: 'at-morto', calendarId: 'primary', timeMin: '2026-09-21T00:00:00Z', timeMax: '2026-09-22T00:00:00Z',
    })).rejects.toBeInstanceOf(GoogleApiError);
  });

  it('freeBusy: JSON malformado (200) lanca em vez de devolver vazio silenciosamente', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nao-e-json', { status: 200 }));
    await expect(queryGoogleFreeBusy({
      accessToken: 'at-1', calendarId: 'primary', timeMin: '2026-09-21T00:00:00Z', timeMax: '2026-09-22T00:00:00Z',
    })).rejects.toThrow();
  });

  it('freeBusy: timeout (fetch rejeitado) propaga para o chamador tratar', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    await expect(queryGoogleFreeBusy({
      accessToken: 'at-1', calendarId: 'primary', timeMin: '2026-09-21T00:00:00Z', timeMax: '2026-09-22T00:00:00Z', timeoutMs: 10,
    })).rejects.toThrow();
  });

  it('freeBusy: calendario sem busy (nada ocupado) devolve lista vazia', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ calendars: { primary: {} } }), { status: 200 }),
    );
    await expect(queryGoogleFreeBusy({
      accessToken: 'at-1', calendarId: 'primary', timeMin: '2026-09-21T00:00:00Z', timeMax: '2026-09-22T00:00:00Z',
    })).resolves.toEqual([]);
  });
});
