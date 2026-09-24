import { describe, expect, it } from 'vitest';
import { buildBusinessMessagingEvent, classifyGraphError } from './conversionsApi';

/**
 * Identificação da conta de WhatsApp no evento, e a mensagem de erro que a Meta realmente manda.
 *
 * Medido em 23/09/2026 com o primeiro clique real em anúncio, enviando com `test_event_code`
 * (evento de teste não conta como conversão). A matriz completa:
 *
 *   dataset da conta de WhatsApp + whatsapp_business_account_id -> ACEITO, events_received: 1
 *   dataset da conta de WhatsApp + page_id                      -> recusado, subcódigo 2804131
 *   dataset da conta de WhatsApp + só o ctwa_clid               -> recusado, subcódigo 2804116
 *   pixel de SITE               + whatsapp_business_account_id  -> recusado, subcódigo 2804132
 *
 * O identificador tem que casar com o TIPO do dataset — não é "um ou outro, tanto faz".
 */

const BASE = {
  eventName: 'LeadSubmitted' as const,
  occurredAt: '2026-09-23T22:59:29.000Z',
  eventId: 'evt-1',
  ctwaClid: 'AfhBXqQualquerCoisa',
};

describe('identificação da conta no evento de mensagem', () => {
  it('inclui whatsapp_business_account_id quando configurado', () => {
    const evento = buildBusinessMessagingEvent({ ...BASE, whatsappBusinessAccountId: '2620648758307353' });

    expect(evento.user_data).toEqual({
      ctwa_clid: 'AfhBXqQualquerCoisa',
      whatsapp_business_account_id: '2620648758307353',
    });
  });

  it('sem configuração, NÃO inventa o campo (a recusa é honesta)', () => {
    const evento = buildBusinessMessagingEvent(BASE);

    expect(evento.user_data).toEqual({ ctwa_clid: 'AfhBXqQualquerCoisa' });
    expect('whatsapp_business_account_id' in evento.user_data).toBe(false);
  });

  it('espaço em branco não vira identificação vazia', () => {
    const evento = buildBusinessMessagingEvent({ ...BASE, whatsappBusinessAccountId: '   ' });

    expect(evento.user_data.whatsapp_business_account_id).toBeUndefined();
  });

  it('o resto do evento não muda com o campo novo', () => {
    const evento = buildBusinessMessagingEvent({ ...BASE, whatsappBusinessAccountId: '2620648758307353' });

    expect(evento.action_source).toBe('business_messaging');
    expect(evento.messaging_channel).toBe('whatsapp');
    expect(evento.event_name).toBe('LeadSubmitted');
  });
});

describe('erro da Meta — guardar o que resolve, não só a frase genérica', () => {
  // Corpo real da recusa de 23/09/2026.
  const RECUSA_FALTA_ID = {
    error: {
      message: 'Invalid parameter',
      type: 'OAuthException',
      code: 100,
      error_subcode: 2804116,
      is_transient: false,
      error_user_title: 'Falta a identificação da Página ou da conta do WhatsApp Business',
      error_user_msg:
        'Seu evento LeadSubmitted com a fonte da ação business_messaging do canal whatsapp não tem "page_id" nem "whatsapp_business_account_id".',
    },
  };

  const RECUSA_DATASET = {
    error: {
      message: 'Invalid parameter',
      code: 100,
      error_subcode: 2804131,
      error_user_msg: 'Para eventos de CTM e CTWA, o conjunto de dados deve ter uma Página associada',
    },
  };

  it('a mensagem guardada carrega o subcódigo e a explicação', () => {
    const r = classifyGraphError(400, RECUSA_FALTA_ID);

    expect(r.message).toContain('Invalid parameter');
    expect(r.message).toContain('2804116');
    expect(r.message).toContain('whatsapp_business_account_id');
  });

  it('dois defeitos DIFERENTES deixam de parecer o mesmo erro', () => {
    const a = classifyGraphError(400, RECUSA_FALTA_ID);
    const b = classifyGraphError(400, RECUSA_DATASET);

    // Antes de 23/09 os dois viravam exatamente "Invalid parameter" e eram indistinguíveis.
    expect(a.message).not.toBe(b.message);
    expect(b.message).toContain('2804131');
  });

  it('erro sem detalhe continua legível (não vira string com lixo)', () => {
    const r = classifyGraphError(400, { error: { message: 'Invalid OAuth access token', code: 190 } });

    expect(r.message).toBe('Invalid OAuth access token');
    expect(r.permanent).toBe(true);
  });

  it('não repete a frase quando o detalhe é igual ao genérico', () => {
    const r = classifyGraphError(400, {
      error: { message: 'Algo deu errado', code: 100, error_user_msg: 'Algo deu errado' },
    });

    expect(r.message).toBe('Algo deu errado');
  });

  it('a classificação de permanente/transitório não mudou', () => {
    expect(classifyGraphError(400, RECUSA_FALTA_ID).permanent).toBe(true);
    expect(classifyGraphError(500, { error: { message: 'oops', code: 1 } }).permanent).toBe(false);
    expect(classifyGraphError(429, { error: { message: 'devagar', code: 4 } }).permanent).toBe(false);
  });
});
