import { describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_MESSAGING_EVENT_NAMES,
  CTWA_ATTRIBUTION_WINDOW_MS,
  buildBusinessMessagingEvent,
  classifyGraphError,
  isBusinessMessagingEventName,
  sendBusinessMessagingEvents,
} from './conversionsApi';

describe('Conversions API for Business Messaging — montagem do evento', () => {
  it('monta o evento exatamente como a doc pede: business_messaging + whatsapp + ctwa_clid sem hash', () => {
    const ev = buildBusinessMessagingEvent({
      eventName: 'QualifiedLead',
      occurredAt: '2026-09-13T15:00:00.000Z',
      eventId: '7d5f1c2a-1111-4222-8333-444455556666',
      ctwaClid: ' AfgqwIqB3-mpRoYkyPzy ',
    });

    expect(ev).toEqual({
      event_name: 'QualifiedLead',
      event_time: 1789311600,
      event_id: '7d5f1c2a-1111-4222-8333-444455556666',
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: { ctwa_clid: 'AfgqwIqB3-mpRoYkyPzy' },
    });
    // Nada de telefone, nome, e-mail ou procedimento: user_data só tem a etiqueta.
    expect(Object.keys(ev.user_data)).toEqual(['ctwa_clid']);
    expect(JSON.stringify(ev)).not.toMatch(/"ph"|"phone"|"fn"|"ln"|"em"|"email"|procedimento/);
  });

  it('valor só entra quando positivo, com moeda BRL e duas casas', () => {
    const com = buildBusinessMessagingEvent({
      eventName: 'Purchase',
      occurredAt: new Date('2026-09-13T15:00:00Z'),
      eventId: 'x',
      ctwaClid: 'Afg1',
      value: 1500.456,
    });
    expect(com.custom_data).toEqual({ currency: 'BRL', value: 1500.46 });

    const sem = buildBusinessMessagingEvent({ eventName: 'Purchase', occurredAt: new Date(), eventId: 'x', ctwaClid: 'Afg1', value: 0 });
    expect(sem.custom_data).toBeUndefined();
  });

  it('recusa etiqueta vazia e data inválida', () => {
    expect(() => buildBusinessMessagingEvent({ eventName: 'Purchase', occurredAt: new Date(), eventId: 'x', ctwaClid: '  ' })).toThrow();
    expect(() => buildBusinessMessagingEvent({ eventName: 'Purchase', occurredAt: 'ontem', eventId: 'x', ctwaClid: 'Afg' })).toThrow();
  });

  it('só aceita os 14 nomes de evento de mensageria da doc; janela é de 7 dias', () => {
    expect(BUSINESS_MESSAGING_EVENT_NAMES).toHaveLength(14);
    expect(isBusinessMessagingEventName('LeadSubmitted')).toBe(true);
    expect(isBusinessMessagingEventName('Schedule')).toBe(false);
    expect(isBusinessMessagingEventName(null)).toBe(false);
    expect(CTWA_ATTRIBUTION_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('Conversions API — envio e classificação de erro', () => {
  it('POST no dataset com o token no corpo (nunca na URL) e test_event_code quando configurado', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'abc' }), { status: 200 }));
    const ev = buildBusinessMessagingEvent({ eventName: 'LeadSubmitted', occurredAt: new Date(), eventId: 'e1', ctwaClid: 'Afg' });

    const res = await sendBusinessMessagingEvents({
      datasetId: '123456',
      accessToken: 'EAAB-token',
      events: [ev],
      testEventCode: 'TEST123',
      graphVersion: 'v21.0',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(res).toEqual({ ok: true, eventsReceived: 1, fbtraceId: 'abc' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/123456/events');
    expect(url).not.toContain('EAAB');
    const body = JSON.parse(String(init.body));
    expect(body.access_token).toBe('EAAB-token');
    expect(body.test_event_code).toBe('TEST123');
    expect(body.partner_agent).toBe('basecrm');
    expect(body.data[0]).toMatchObject({ action_source: 'business_messaging', messaging_channel: 'whatsapp' });
  });

  it('sem dataset ou token: erro permanente sem chamar a rede', async () => {
    const fetchMock = vi.fn();
    const res = await sendBusinessMessagingEvents({ datasetId: '', accessToken: 'x', events: [], fetchImpl: fetchMock as unknown as typeof fetch });
    expect(res).toMatchObject({ ok: false, permanent: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('token inválido (190) e parâmetro inválido (100) são permanentes; 5xx, 429, is_transient e limite de taxa são transitórios', () => {
    expect(classifyGraphError(400, { error: { code: 190, message: 'Invalid OAuth access token' } })).toMatchObject({ permanent: true, code: 190 });
    expect(classifyGraphError(400, { error: { code: 100, message: 'Invalid parameter' } })).toMatchObject({ permanent: true, code: 100 });
    expect(classifyGraphError(503, null)).toMatchObject({ permanent: false });
    expect(classifyGraphError(429, null)).toMatchObject({ permanent: false });
    expect(classifyGraphError(400, { error: { code: 1, is_transient: true, message: 'try again' } })).toMatchObject({ permanent: false });
    expect(classifyGraphError(400, { error: { code: 4, message: 'Application request limit reached' } })).toMatchObject({ permanent: false, code: 4 });
    expect(classifyGraphError(null, null)).toMatchObject({ permanent: false, message: 'Falha de rede ao falar com a Meta' });
  });

  it('falha de rede vira erro transitório, não exceção', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNRESET'); });
    const ev = buildBusinessMessagingEvent({ eventName: 'Purchase', occurredAt: new Date(), eventId: 'e', ctwaClid: 'Afg' });
    const res = await sendBusinessMessagingEvents({ datasetId: '1', accessToken: 't', events: [ev], fetchImpl: fetchMock as unknown as typeof fetch });
    expect(res).toMatchObject({ ok: false, permanent: false, status: null, message: 'ECONNRESET' });
  });
});
