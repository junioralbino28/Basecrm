import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleApiError,
  deleteGoogleCalendarEvent,
  getGoogleCalendarEvent,
  insertGoogleCalendarEvent,
  patchGoogleCalendarEvent,
} from './googleApiClient';

afterEach(() => vi.restoreAllMocks());

const EVENT = {
  summary: 'Diagnóstico Cenoura Hub — Marina',
  description: 'Descricao fixa.',
  startAt: '2026-09-23T17:00:00.000Z',
  endAt: '2026-09-23T17:40:00.000Z',
  timezone: 'America/Sao_Paulo',
};

describe('googleApiClient — eventos (Fatias 3 e 4)', () => {
  it('events.insert leva conferenceDataVersion=1, sendUpdates=all, hangoutsMeet e o convidado', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: 'ev-1',
        status: 'confirmed',
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
        conferenceData: { createRequest: { status: { statusCode: 'success' } } },
      }), { status: 200 }),
    );

    const event = await insertGoogleCalendarEvent({
      accessToken: 'at-1',
      calendarId: 'primary',
      event: { ...EVENT, attendeeEmails: ['lead@exemplo.com'], conferenceRequestId: 'req-1' },
      sendUpdates: 'all',
    });

    expect(event).toEqual({
      id: 'ev-1',
      status: 'confirmed',
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      conferenceStatus: 'success',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/calendar/v3/calendars/primary/events');
    // Sem conferenceDataVersion=1 o Google ignora conferenceData EM SILENCIO (pesquisa, 22/09).
    expect(parsed.searchParams.get('conferenceDataVersion')).toBe('1');
    expect(parsed.searchParams.get('sendUpdates')).toBe('all');
    expect(init.method).toBe('POST');

    const body = JSON.parse(String(init.body));
    expect(body.summary).toBe('Diagnóstico Cenoura Hub — Marina');
    expect(body.description).toBe('Descricao fixa.');
    expect(body.attendees).toEqual([{ email: 'lead@exemplo.com' }]);
    expect(body.start).toEqual({ dateTime: '2026-09-23T17:00:00.000Z', timeZone: 'America/Sao_Paulo' });
    expect(body.end).toEqual({ dateTime: '2026-09-23T17:40:00.000Z', timeZone: 'America/Sao_Paulo' });
    expect(body.conferenceData.createRequest).toEqual({
      requestId: 'req-1',
      conferenceSolutionKey: { type: 'hangoutsMeet' },
    });
  });

  it('sem convidado nenhum, o corpo sai sem `attendees` (evento so na agenda do responsavel)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'ev-1' }), { status: 200 }),
    );

    await insertGoogleCalendarEvent({
      accessToken: 'at-1', calendarId: 'primary',
      event: { ...EVENT, attendeeEmails: [] }, sendUpdates: 'none',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get('sendUpdates')).toBe('none');
    expect(JSON.parse(String(init.body))).not.toHaveProperty('attendees');
  });

  it('varios convidados viram uma lista de attendees na ordem recebida', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'ev-1' }), { status: 200 }),
    );

    await insertGoogleCalendarEvent({
      accessToken: 'at-1', calendarId: 'primary',
      event: { ...EVENT, attendeeEmails: ['lead@exemplo.com', 'junioralbino28@gmail.com'] },
      sendUpdates: 'all',
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).attendees).toEqual([
      { email: 'lead@exemplo.com' },
      { email: 'junioralbino28@gmail.com' },
    ]);
  });

  it('Meet ainda `pending`: devolve conferenceStatus pending e sem link', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: 'ev-2',
        conferenceData: { createRequest: { status: { statusCode: 'pending' } } },
      }), { status: 200 }),
    );

    const event = await insertGoogleCalendarEvent({
      accessToken: 'at-1', calendarId: 'primary',
      event: { ...EVENT, attendeeEmails: [] }, sendUpdates: 'none',
    });
    expect(event).toMatchObject({ id: 'ev-2', hangoutLink: null, conferenceStatus: 'pending' });
  });

  it('link tambem e lido de conferenceData.entryPoints quando hangoutLink ainda nao veio', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: 'ev-3',
        conferenceData: {
          createRequest: { status: { statusCode: 'success' } },
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+5511999990000' },
            { entryPointType: 'video', uri: 'https://meet.google.com/xyz-1234-abc' },
          ],
        },
      }), { status: 200 }),
    );

    const event = await getGoogleCalendarEvent({ accessToken: 'at-1', calendarId: 'primary', eventId: 'ev-3' });
    expect(event.hangoutLink).toBe('https://meet.google.com/xyz-1234-abc');
  });

  it('events.patch usa PATCH no evento com sendUpdates=all (remarcacao avisa o convidado)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'ev-1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }), { status: 200 }),
    );

    await patchGoogleCalendarEvent({
      accessToken: 'at-1', calendarId: 'primary', eventId: 'ev-1',
      event: { ...EVENT, startAt: '2026-09-24T17:00:00.000Z', attendeeEmails: ['lead@exemplo.com'] },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/calendar/v3/calendars/primary/events/ev-1');
    expect(parsed.searchParams.get('sendUpdates')).toBe('all');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body)).start.dateTime).toBe('2026-09-24T17:00:00.000Z');
  });

  it('events.delete usa DELETE com sendUpdates=all e trata 404/410 como ja apagado', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 204 }));
    await expect(deleteGoogleCalendarEvent({
      accessToken: 'at-1', calendarId: 'primary', eventId: 'ev-1',
    })).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/calendar/v3/calendars/primary/events/ev-1');
    expect(new URL(url).searchParams.get('sendUpdates')).toBe('all');
    expect(init.method).toBe('DELETE');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 410 }));
    await expect(deleteGoogleCalendarEvent({
      accessToken: 'at-1', calendarId: 'primary', eventId: 'ev-1',
    })).resolves.toBe(true);
  });

  it('erro do Google no evento vira GoogleApiError com o codigo (invalid_grant)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    await expect(insertGoogleCalendarEvent({
      accessToken: 'at-morto', calendarId: 'primary',
      event: { ...EVENT, attendeeEmails: [] }, sendUpdates: 'none',
    })).rejects.toBeInstanceOf(GoogleApiError);
  });
});
