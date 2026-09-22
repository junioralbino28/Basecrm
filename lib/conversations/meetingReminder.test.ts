import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

const sendEvolutionTextMessageMock = vi.fn();
const resolveEvolutionCredentialsMock = vi.fn();
const getGoogleCalendarAccessTokenMock = vi.fn();
const getGoogleCalendarEventMock = vi.fn();

vi.mock('@/lib/channels/evolution', () => ({
  sendEvolutionTextMessage: (...args: unknown[]) => sendEvolutionTextMessageMock(...args),
}));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: (...args: unknown[]) => resolveEvolutionCredentialsMock(...args),
}));
vi.mock('@/lib/googleCalendar/oauth', () => ({
  getGoogleCalendarAccessToken: (...args: unknown[]) => getGoogleCalendarAccessTokenMock(...args),
}));
vi.mock('@/lib/googleCalendar/googleApiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/googleCalendar/googleApiClient')>();
  return {
    ...actual,
    getGoogleCalendarEvent: (...args: unknown[]) => getGoogleCalendarEventMock(...args),
  };
});

import { GoogleApiError } from '@/lib/googleCalendar/googleApiClient';
import { GOOGLE_MEETING_EVENT_TABLE } from '@/lib/googleCalendar/meetingEventQueue';
import { buildMeetingLinkReminderText, sendDueMeetingLinkReminders } from './meetingReminder';

const ORG = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const ACTIVITY = '44444444-4444-4444-8444-444444444444';
const CONNECTION = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-09-23T16:50:00.000Z';
const MEET = 'https://meet.google.com/abc-defg-hij';

/** 16h50 + 10 min: dentro da janela de 15 min, mas ainda ha tempo de o problema se resolver. */
const DENTRO_DA_JANELA = '2026-09-23T17:00:00.000Z';
/** 16h50 + 3 min: ja passou do ponto de espera — problema pendente aqui vira aviso. */
const NA_BEIRA = '2026-09-23T16:53:00.000Z';

function row(overrides: Record<string, unknown> = {}) {
  return {
    activity_id: ACTIVITY,
    organization_id: ORG,
    thread_id: THREAD,
    channel_connection_id: CONNECTION,
    owner_id: OWNER,
    contact_name: 'Marina Souza',
    scheduled_at: DENTRO_DA_JANELA,
    google_calendar_id: 'primary',
    google_event_id: 'ev-1',
    meet_link: MEET,
    status: 'created',
    reminder_sent_at: null,
    reminder_escalated_at: null,
    ...overrides,
  };
}

function seed(
  rows: Record<string, unknown>[],
  connectionOverrides: Record<string, unknown> = {},
  // As duas travas de organizacao que o lembrete passou a respeitar junto com a da conexao.
  gate: { featureEnabled?: boolean; organizationAiEnabled?: boolean } = {},
) {
  return createFakeSupabaseAdmin({
    [GOOGLE_MEETING_EVENT_TABLE]: rows,
    ai_feature_flags: [{
      organization_id: ORG,
      key: 'ai_conversation_auto_reply',
      enabled: gate.featureEnabled ?? true,
    }],
    organization_settings: [{
      organization_id: ORG,
      ai_enabled: gate.organizationAiEnabled ?? true,
    }],
    conversation_threads: [{
      id: THREAD,
      organization_id: ORG,
      channel_connection_id: CONNECTION,
      contact_name: 'Marina Souza',
      contact_phone: '+5511999990000',
      status: 'human_queue',
      metadata: { humanLocked: true, routingMode: 'human' },
    }],
    channel_connections: [{
      id: CONNECTION,
      organization_id: ORG,
      name: 'CENNO',
      config: { aiEnabled: true, instanceName: 'cenno', agentName: 'Aurora', ...connectionOverrides },
    }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getGoogleCalendarAccessTokenMock.mockResolvedValue('at-1');
  getGoogleCalendarEventMock.mockResolvedValue({ id: 'ev-1', status: 'confirmed', hangoutLink: MEET, conferenceStatus: 'success' });
  resolveEvolutionCredentialsMock.mockResolvedValue({ apiUrl: 'https://evo.exemplo.com', apiKey: 'k', source: 'connection' });
  sendEvolutionTextMessageMock.mockResolvedValue({ providerMessageId: 'pm-1', attemptLabel: 'sendText:number+text', raw: {} });
});
afterEach(() => vi.restoreAllMocks());

describe('texto do lembrete', () => {
  it('bate palavra por palavra com o aprovado', () => {
    expect(buildMeetingLinkReminderText({ contactName: 'Marina Souza', meetLink: MEET }))
      .toBe(`Marina, nossa reunião começa daqui a pouco. Aqui está o link do Google Meet: ${MEET}`);
  });
});

describe('sendDueMeetingLinkReminders — o link sai 15 min antes (Fatia 4)', () => {
  it('REGRESSAO: sem nenhuma reuniao na janela, nao fala com o Google nem com o WhatsApp', async () => {
    const fake = seed([]);
    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary.due).toBe(0);
    expect(getGoogleCalendarAccessTokenMock).not.toHaveBeenCalled();
    expect(getGoogleCalendarEventMock).not.toHaveBeenCalled();
    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
  });

  it('JANELA: reuniao daqui a 40 min ainda nao entra', async () => {
    const fake = seed([row({ activity_id: 'longe', scheduled_at: '2026-09-23T17:30:00.000Z' })]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary.due).toBe(0);
    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
  });

  it('JANELA: reuniao que ja comecou entra SO para virar aviso, nunca para mandar link', async () => {
    const fake = seed([row({ activity_id: 'passou', scheduled_at: '2026-09-23T16:40:00.000Z' })]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary).toMatchObject({ due: 1, sent: 0, escalated: 1 });
    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
  });

  it('envia o texto exato pelo WhatsApp e confere o evento no Google antes', async () => {
    const fake = seed([row()]);
    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary).toMatchObject({ due: 1, sent: 1, escalated: 0, failed: 0 });
    expect(getGoogleCalendarEventMock).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'primary', eventId: 'ev-1',
    }));
    expect(sendEvolutionTextMessageMock).toHaveBeenCalledTimes(1);
    expect(sendEvolutionTextMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      phone: '5511999990000',
      text: `Marina, nossa reunião começa daqui a pouco. Aqui está o link do Google Meet: ${MEET}`,
    }));
    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0].reminder_sent_at).toEqual(expect.any(String));
  });

  it('a mensagem entra na conversa sem tirar ela da fila humana', async () => {
    const fake = seed([row()]);
    await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    const mensagens = fake.rowsOf('conversation_messages');
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0]).toMatchObject({
      thread_id: THREAD, organization_id: ORG, direction: 'outbound', message_type: 'text',
    });
    expect(String(mensagens[0].content)).toContain(MEET);

    const thread = fake.rowsOf('conversation_threads')[0];
    expect(thread.status).toBe('human_queue');
    expect((thread.metadata as Record<string, unknown>).humanLocked).toBe(true);
  });

  it('IDEMPOTENTE: dois ticks seguidos mandam uma vez so', async () => {
    const fake = seed([row()]);

    await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });
    const segundo = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(sendEvolutionTextMessageMock).toHaveBeenCalledTimes(1);
    // O carimbo tira a linha da janela: o segundo tick nem encontra a reuniao.
    expect(segundo.due).toBe(0);
  });

  it('IDEMPOTENTE: dois ticks CONCORRENTES tambem mandam uma vez so', async () => {
    const fake = seed([row()]);

    await Promise.all([
      sendDueMeetingLinkReminders({ admin: fake as never, now: NOW }),
      sendDueMeetingLinkReminders({ admin: fake as never, now: NOW }),
    ]);

    expect(sendEvolutionTextMessageMock).toHaveBeenCalledTimes(1);
  });

  it('evento apagado/cancelado no Google: nao manda link morto, escala com severidade alta', async () => {
    getGoogleCalendarEventMock.mockResolvedValue({ id: 'ev-1', status: 'cancelled', hangoutLink: MEET, conferenceStatus: 'success' });
    const fake = seed([row()]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary).toMatchObject({ sent: 0, escalated: 1 });
    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
    const avisos = fake.rowsOf('system_notifications');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ severity: 'high', organization_id: ORG });
  });

  it('evento sumiu do Google (404 no events.get) e DEFINITIVO: escala na hora, sem esperar', async () => {
    getGoogleCalendarEventMock.mockRejectedValue(new GoogleApiError('Not Found', 404, null));
    // Faltando 10 min: o que decide escalar agora e o 404 ser definitivo, nao o relogio.
    const fake = seed([row()]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary.escalated).toBe(1);
    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
  });

  it('falha PASSAGEIRA ao conferir o evento nao queima a janela: tenta de novo no ciclo seguinte', async () => {
    getGoogleCalendarEventMock.mockRejectedValueOnce(new Error('socket hang up'));
    const fake = seed([row()]);

    const primeiro = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });
    expect(primeiro).toMatchObject({ due: 1, sent: 0, escalated: 0, waiting: 1 });
    // Nada carimbado: a linha continua elegivel.
    const linha = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0];
    expect(linha.reminder_sent_at).toBeNull();
    expect(linha.reminder_escalated_at).toBeNull();
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);

    // Google respondeu no ciclo seguinte: o lead recebe o link normalmente.
    const segundo = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });
    expect(segundo).toMatchObject({ sent: 1, escalated: 0 });
    expect(sendEvolutionTextMessageMock).toHaveBeenCalledTimes(1);
  });

  it('falha passageira NA BEIRA da hora vira aviso: nao da mais para esperar', async () => {
    getGoogleCalendarEventMock.mockRejectedValue(new Error('socket hang up'));
    const fake = seed([row({ scheduled_at: NA_BEIRA })]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary).toMatchObject({ sent: 0, escalated: 1 });
    expect(String(fake.rowsOf('system_notifications')[0].message)).toContain('confirmar o evento no Google');
  });

  it('SEM LINK: reuniao que nunca virou evento gera aviso alto, uma vez so', async () => {
    const fake = seed([row({ status: 'failed', google_event_id: null, meet_link: null, scheduled_at: NA_BEIRA })]);

    const primeiro = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });
    const segundo = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(primeiro.escalated).toBe(1);
    // O carimbo de escalacao tira a linha da janela: nao repete a cada 5 min.
    expect(segundo.due).toBe(0);
    const avisos = fake.rowsOf('system_notifications');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ severity: 'high' });
    expect(String(avisos[0].title)).toContain('sem link do Google');
    expect(String(avisos[0].message)).toContain('Marina Souza');
    expect(String(avisos[0].message)).toContain('mande o link na mão');
    // Nunca fala com o Google quando nem evento existe.
    expect(getGoogleCalendarEventMock).not.toHaveBeenCalled();
  });

  it('SEM LINK na beira da hora: evento criado com o Meet ainda pendente escala', async () => {
    const fake = seed([row({ meet_link: null, scheduled_at: NA_BEIRA })]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary).toMatchObject({ sent: 0, escalated: 1 });
    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
  });

  it('lembrete ja suprimido (reuniao cancelada no CRM) nem aparece na janela', async () => {
    const fake = seed([row({ status: 'cancelled', reminder_sent_at: NOW, reminder_escalated_at: NOW })]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary.due).toBe(0);
    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
  });

  it('IA pausada no numero: nao envia sozinho, escala para o humano mandar na mao', async () => {
    const fake = seed([row({ scheduled_at: NA_BEIRA })], { aiEnabled: false });

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary.escalated).toBe(1);
    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
  });

  it('TRAVA DO CLIENTE: com a IA desligada no painel da organizacao, o lembrete nao sai sozinho', async () => {
    // E a mesma chave que o cliente usa para pausar a Aurora. Antes o lembrete olhava so a
    // conexao e continuava mandando mensagem depois de o cliente ter pausado tudo.
    const fake = seed([row({ scheduled_at: NA_BEIRA })], {}, { organizationAiEnabled: false });

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
    expect(summary.escalated).toBe(1);
  });

  it('TRAVA DA ORGANIZACAO: bandeira ai_conversation_auto_reply desligada tambem segura o envio', async () => {
    const fake = seed([row({ scheduled_at: NA_BEIRA })], {}, { featureEnabled: false });

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
    expect(summary.escalated).toBe(1);
  });

  it('mensagem que SAIU mas nao pode ser registrada nao vira aviso de "nao saiu"', async () => {
    // O lead receberia o link duas vezes se o humano acreditasse no aviso errado.
    const fake = seed([row()]);
    fake.failOn('conversation_messages', 'insert', 'coluna inexistente');

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(sendEvolutionTextMessageMock).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ sent: 1, failed: 0 });
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);
  });

  it('falha no envio pelo WhatsApp vira aviso alto (o lead nao fica esperando em silencio)', async () => {
    sendEvolutionTextMessageMock.mockRejectedValue(new Error('Evolution fora do ar'));
    const fake = seed([row()]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary.failed).toBe(1);
    const avisos = fake.rowsOf('system_notifications');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ severity: 'high' });
  });
});

describe('reuniao que passou da hora nao some em silencio', () => {
  it('horario ja passou e nada saiu: vira aviso no sino, sem mandar link', async () => {
    // Antes a consulta exigia `scheduled_at >= now`: bastava o lote estourar o prazo no unico
    // ciclo em que a linha podia escalar para ela sair da janela para sempre.
    const fake = seed([row({ scheduled_at: '2026-09-23T16:47:00.000Z', meet_link: null })]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary).toMatchObject({ due: 1, sent: 0, escalated: 1 });
    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
    expect(String(fake.rowsOf('system_notifications')[0].message)).toContain('começou sem o link');
  });

  it('reuniao que passou da hora COM link tambem nao recebe mensagem atrasada', async () => {
    const fake = seed([row({ scheduled_at: '2026-09-23T16:45:00.000Z' })]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary.sent).toBe(0);
    expect(sendEvolutionTextMessageMock).not.toHaveBeenCalled();
  });

  it('reuniao de uma hora e meia atras ja saiu da janela de vez', async () => {
    const fake = seed([row({ scheduled_at: '2026-09-23T15:20:00.000Z' })]);

    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });

    expect(summary.due).toBe(0);
  });
});

describe('envio do lembrete tem tempo limite proprio', () => {
  it('Evolution pendurada nao segura o tick: vira falha com aviso, nao espera infinita', async () => {
    sendEvolutionTextMessageMock.mockImplementation((params: { signal?: AbortSignal }) => new Promise((_, reject) => {
      // Imita o provedor que nunca responde: so o abort do tempo limite resolve isto.
      params.signal?.addEventListener('abort', () => reject(new Error('abortado')));
    }));
    const fake = seed([row()]);

    const antes = Date.now();
    const summary = await sendDueMeetingLinkReminders({ admin: fake as never, now: NOW });
    const gastou = Date.now() - antes;

    expect(summary.failed).toBe(1);
    expect(gastou).toBeLessThan(20_000);
    expect(fake.rowsOf('system_notifications')[0]).toMatchObject({ severity: 'high' });
  }, 30_000);
});
