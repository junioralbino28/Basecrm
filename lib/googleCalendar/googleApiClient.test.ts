import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleApiError,
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserInfo,
  listGoogleCalendars,
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
      accessToken: 'at-1', calendarIds: ['primary'], timeMin: '2026-09-21T00:00:00Z', timeMax: '2026-09-22T00:00:00Z',
    });
    expect(intervals).toEqual([{ start: '2026-09-21T12:30:00Z', end: '2026-09-21T15:30:00Z' }]);
  });

  it('freeBusy: junta o ocupado de VARIAS agendas (bloqueio na pessoal segura o horario)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      calendars: {
        'trabalho@grupo': { busy: [{ start: '2026-09-23T14:00:00Z', end: '2026-09-23T15:00:00Z' }] },
        'pessoal@gmail.com': { busy: [{ start: '2026-09-23T17:00:00Z', end: '2026-09-23T21:00:00Z' }] },
      },
    }), { status: 200 }));

    const intervalos = await queryGoogleFreeBusy({
      accessToken: 'at-1', calendarIds: ['trabalho@grupo', 'pessoal@gmail.com'],
      timeMin: '2026-09-23T00:00:00Z', timeMax: '2026-09-24T00:00:00Z',
    });

    expect(intervalos).toHaveLength(2);
    expect(intervalos[1]).toEqual({ start: '2026-09-23T17:00:00Z', end: '2026-09-23T21:00:00Z' });
    // As duas agendas vao num pedido so, sem repetir.
    const corpo = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(corpo.items).toEqual([{ id: 'trabalho@grupo' }, { id: 'pessoal@gmail.com' }]);
  });

  it('freeBusy: agenda repetida entra uma vez so', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      calendars: { primary: { busy: [] } },
    }), { status: 200 }));

    await queryGoogleFreeBusy({
      accessToken: 'at-1', calendarIds: ['primary', 'primary'],
      timeMin: '2026-09-23T00:00:00Z', timeMax: '2026-09-24T00:00:00Z',
    });

    const corpo = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(corpo.items).toEqual([{ id: 'primary' }]);
  });

  it('freeBusy: agenda que o Google recusa nao cega as outras', async () => {
    // Agenda apagada ou sem acesso volta com `errors`; o horario das demais tem de valer.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      calendars: {
        primary: { busy: [{ start: '2026-09-23T14:00:00Z', end: '2026-09-23T15:00:00Z' }] },
        'sumiu@grupo': { errors: [{ reason: 'notFound' }] },
      },
    }), { status: 200 }));

    const intervalos = await queryGoogleFreeBusy({
      accessToken: 'at-1', calendarIds: ['primary', 'sumiu@grupo'],
      timeMin: '2026-09-23T00:00:00Z', timeMax: '2026-09-24T00:00:00Z',
    });

    expect(intervalos).toEqual([{ start: '2026-09-23T14:00:00Z', end: '2026-09-23T15:00:00Z' }]);
  });

  it('freeBusy: sem agenda nenhuma nao chama o Google', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(queryGoogleFreeBusy({
      accessToken: 'at-1', calendarIds: [],
      timeMin: '2026-09-23T00:00:00Z', timeMax: '2026-09-24T00:00:00Z',
    })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('freeBusy: 401 vira GoogleApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 }),
    );
    await expect(queryGoogleFreeBusy({
      accessToken: 'at-morto', calendarIds: ['primary'], timeMin: '2026-09-21T00:00:00Z', timeMax: '2026-09-22T00:00:00Z',
    })).rejects.toBeInstanceOf(GoogleApiError);
  });

  it('freeBusy: JSON malformado (200) lanca em vez de devolver vazio silenciosamente', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nao-e-json', { status: 200 }));
    await expect(queryGoogleFreeBusy({
      accessToken: 'at-1', calendarIds: ['primary'], timeMin: '2026-09-21T00:00:00Z', timeMax: '2026-09-22T00:00:00Z',
    })).rejects.toThrow();
  });

  it('freeBusy: timeout (fetch rejeitado) propaga para o chamador tratar', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    await expect(queryGoogleFreeBusy({
      accessToken: 'at-1', calendarIds: ['primary'], timeMin: '2026-09-21T00:00:00Z', timeMax: '2026-09-22T00:00:00Z', timeoutMs: 10,
    })).rejects.toThrow();
  });

  it('freeBusy: calendario sem busy (nada ocupado) devolve lista vazia', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ calendars: { primary: {} } }), { status: 200 }),
    );
    await expect(queryGoogleFreeBusy({
      accessToken: 'at-1', calendarIds: ['primary'], timeMin: '2026-09-21T00:00:00Z', timeMax: '2026-09-22T00:00:00Z',
    })).resolves.toEqual([]);
  });
});

describe('listGoogleCalendars — o nome tem de ser o que a pessoa ve no Google', () => {
  it('prefere o nome renomeado (`summaryOverride`) ao `summary` da API', async () => {
    // Caso real (22/09): a agenda principal chega com `summary` = o proprio e-mail; o nome
    // que o Junior ve ("Cenoura Hub") vem de `summaryOverride`, e por isso a agenda dele
    // parecia nao existir na nossa lista.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      items: [
        { id: 'cenourahub@gmail.com', summary: 'cenourahub@gmail.com', summaryOverride: 'Cenoura Hub', primary: true, accessRole: 'owner' },
        { id: 'sdr@group.calendar.google.com', summary: 'Cenoura - SDR', accessRole: 'writer' },
        { id: 'sem-nome@group.calendar.google.com', accessRole: 'reader' },
        { id: 'so-espaco@group.calendar.google.com', summaryOverride: '   ', summary: 'Nome de verdade', accessRole: 'reader' },
      ],
    }), { status: 200 }));

    const lista = await listGoogleCalendars({ accessToken: 'at-1' });

    expect(lista.map((agenda) => agenda.summary)).toEqual([
      'Cenoura Hub', 'Cenoura - SDR', 'sem-nome@group.calendar.google.com', 'Nome de verdade',
    ]);
    expect(lista[0]).toMatchObject({ primary: true, accessRole: 'owner' });
  });
});
