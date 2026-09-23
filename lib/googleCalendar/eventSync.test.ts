import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

const getGoogleCalendarAccessTokenMock = vi.fn();
const markGoogleCalendarConnectionIssueMock = vi.fn();
const getGoogleCalendarConnectionMock = vi.fn();
const freeBusyMock = vi.fn();
const insertEventMock = vi.fn();
const patchEventMock = vi.fn();
const getEventMock = vi.fn();
const deleteEventMock = vi.fn();

vi.mock('./oauth', () => ({
  getGoogleCalendarAccessToken: (...args: unknown[]) => getGoogleCalendarAccessTokenMock(...args),
}));
vi.mock('./connectionStore', () => ({
  markGoogleCalendarConnectionIssue: (...args: unknown[]) => markGoogleCalendarConnectionIssueMock(...args),
  getGoogleCalendarConnection: (...args: unknown[]) => getGoogleCalendarConnectionMock(...args),
}));
vi.mock('./googleApiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./googleApiClient')>();
  return {
    ...actual,
    insertGoogleCalendarEvent: (...args: unknown[]) => insertEventMock(...args),
    patchGoogleCalendarEvent: (...args: unknown[]) => patchEventMock(...args),
    getGoogleCalendarEvent: (...args: unknown[]) => getEventMock(...args),
    deleteGoogleCalendarEvent: (...args: unknown[]) => deleteEventMock(...args),
    queryGoogleFreeBusy: (...args: unknown[]) => freeBusyMock(...args),
  };
});

import { GoogleApiError } from './googleApiClient';
import {
  buildGoogleMeetingAttendees,
  createDueGoogleCalendarEvents,
  deleteOrphanGoogleCalendarEvents,
  GOOGLE_MEETING_DAILY_INVITE_LIMIT,
  GOOGLE_ORPHAN_EVENT_TABLE,
  requeueFailedGoogleMeetingEvents,
} from './eventSync';
import { OVERLAP_WARNING_TEXT } from './eventSync';
import {
  GOOGLE_INVITE_LOG_TABLE,
  GOOGLE_MEETING_EVENT_TABLE,
  MAX_GOOGLE_MEETING_ATTEMPTS,
} from './meetingEventQueue';

const ORG = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const ACTIVITY = '44444444-4444-4444-8444-444444444444';
const CONNECTION = '55555555-5555-4555-8555-555555555555';
const CONTACT = '66666666-6666-4666-8666-666666666666';
const NOW = '2026-09-22T12:00:00.000Z';
const SCHEDULED = '2026-09-23T17:00:00.000Z';
const MEET = 'https://meet.google.com/abc-defg-hij';

function row(overrides: Record<string, unknown> = {}) {
  return {
    activity_id: ACTIVITY,
    organization_id: ORG,
    thread_id: THREAD,
    channel_connection_id: CONNECTION,
    owner_id: OWNER,
    contact_id: CONTACT,
    contact_name: 'Marina Souza',
    invitee_email: 'marina@exemplo.com',
    invited_at: null,
    scheduled_at: SCHEDULED,
    timezone: 'America/Sao_Paulo',
    google_calendar_id: 'primary',
    google_event_id: null,
    meet_link: null,
    status: 'pending',
    attempts: 0,
    last_error: null,
    next_retry_at: NOW,
    reminder_sent_at: null,
    reminder_escalated_at: null,
    overlap_warning: null,
    ...overrides,
  };
}

/** `extraAttendees` fica em `config.calendar`; sem o campo, a conexao e a de hoje. */
function connectionConfig(extraAttendees?: string[]) {
  return {
    id: CONNECTION,
    organization_id: ORG,
    config: {
      calendar: {
        enabled: true,
        timezone: 'America/Sao_Paulo',
        ownerId: OWNER,
        minimumNoticeMinutes: 60,
        schedulingHorizonDays: 7,
        humanConfirmationWeekdays: ['saturday'],
        weeklyHours: {
          monday: [{ start: '09:00', end: '18:00' }],
          tuesday: [{ start: '09:00', end: '18:00' }],
          wednesday: [{ start: '09:00', end: '18:00' }],
          thursday: [{ start: '09:00', end: '18:00' }],
          friday: [{ start: '09:00', end: '18:00' }],
          saturday: [],
          sunday: [],
        },
        ...(extraAttendees ? { extraAttendees } : {}),
      },
    },
  };
}

function seed(
  rows: Record<string, unknown>[],
  extraAttendees?: string[],
  inviteLog: Record<string, unknown>[] = [],
) {
  return createFakeSupabaseAdmin({
    [GOOGLE_MEETING_EVENT_TABLE]: rows,
    [GOOGLE_INVITE_LOG_TABLE]: inviteLog,
    channel_connections: [connectionConfig(extraAttendees)],
  });
}

/** Convites JA enviados por esta conexao — e o que o teto de 24 h conta. */
function convitesEnviados(quantidade: number, sentAt = '2026-09-22T09:00:00.000Z') {
  return Array.from({ length: quantidade }, (_, index) => ({
    id: `log-${index}`,
    organization_id: ORG,
    owner_id: OWNER,
    invitee_email: `ja${index}@exemplo.com`,
    source_activity_id: `ja-${index}`,
    sent_at: sentAt,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getGoogleCalendarAccessTokenMock.mockResolvedValue('at-1');
  insertEventMock.mockResolvedValue({ id: 'ev-1', status: 'confirmed', hangoutLink: MEET, conferenceStatus: 'success' });
  patchEventMock.mockResolvedValue({ id: 'ev-1', status: 'confirmed', hangoutLink: MEET, conferenceStatus: 'success' });
  getEventMock.mockResolvedValue({ id: 'ev-1', status: 'confirmed', hangoutLink: MEET, conferenceStatus: 'success' });
  deleteEventMock.mockResolvedValue(true);
  // Padrao: nenhuma agenda de observacao configurada (comportamento de quem nunca escolheu nada).
  getGoogleCalendarConnectionMock.mockResolvedValue({ watchCalendarIds: [], busyCalendarIds: [] });
  freeBusyMock.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('buildGoogleMeetingAttendees — lead + fixos, sem repetir', () => {
  it('coloca o lead primeiro e depois os fixos', () => {
    expect(buildGoogleMeetingAttendees({
      inviteeEmail: 'lead@exemplo.com',
      extraAttendees: ['junioralbino28@gmail.com', 'closer2@exemplo.com'],
    })).toEqual(['lead@exemplo.com', 'junioralbino28@gmail.com', 'closer2@exemplo.com']);
  });

  it('lead sem e-mail: sai so com os fixos', () => {
    expect(buildGoogleMeetingAttendees({
      inviteeEmail: null, extraAttendees: ['junioralbino28@gmail.com'],
    })).toEqual(['junioralbino28@gmail.com']);
  });

  it('e-mail repetido entre lead e fixo nao duplica (compara em minusculas)', () => {
    expect(buildGoogleMeetingAttendees({
      inviteeEmail: 'Junior@Exemplo.com',
      extraAttendees: ['junior@exemplo.com', 'outro@exemplo.com'],
    })).toEqual(['Junior@Exemplo.com', 'outro@exemplo.com']);
  });

  it('sem fixos nenhum, a lista e exatamente a de hoje', () => {
    expect(buildGoogleMeetingAttendees({ inviteeEmail: 'lead@exemplo.com', extraAttendees: [] }))
      .toEqual(['lead@exemplo.com']);
    expect(buildGoogleMeetingAttendees({ inviteeEmail: null, extraAttendees: [] })).toEqual([]);
  });
});

describe('createDueGoogleCalendarEvents — cria o evento no Google (Fatia 3)', () => {
  it('REGRESSAO: sem nenhuma linha pendente, nao chama o googleApiClient nem pede token', async () => {
    const fake = seed([]);
    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.due).toBe(0);
    expect(getGoogleCalendarAccessTokenMock).not.toHaveBeenCalled();
    expect(insertEventMock).not.toHaveBeenCalled();
    expect(patchEventMock).not.toHaveBeenCalled();
    expect(getEventMock).not.toHaveBeenCalled();
    expect(deleteEventMock).not.toHaveBeenCalled();
  });

  it('linha sem trabalho pendente (next_retry_at nulo) nunca entra no lote', async () => {
    const fake = seed([row({ status: 'created', google_event_id: 'ev-1', meet_link: MEET, next_retry_at: null })]);
    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.due).toBe(0);
    expect(insertEventMock).not.toHaveBeenCalled();
  });

  it('monta o evento com titulo e descricao FIXOS, o lead convidado e sendUpdates=all', async () => {
    const fake = seed([row()]);
    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.created).toBe(1);
    expect(insertEventMock).toHaveBeenCalledTimes(1);
    expect(insertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'at-1',
      calendarId: 'primary',
      sendUpdates: 'all',
      event: expect.objectContaining({
        // A marca vem da conexao e, sem ela, do nome da organizacao — o teste dedicado está em
        // meetingEventQueue.test.ts. Aqui interessa o FORMATO fixo, sem nada vindo do LLM.
        summary: expect.stringMatching(/^Diagnóstico .+ — Marina$/),
        description: expect.stringContaining('O link do Google Meet está neste convite'),
        startAt: SCHEDULED,
        // Duracao prevista de 40 min (MEETING_TARGET_DURATION_MINUTES).
        endAt: '2026-09-23T17:40:00.000Z',
        timezone: 'America/Sao_Paulo',
        attendeeEmails: ['marina@exemplo.com'],
        conferenceRequestId: expect.any(String),
      }),
    }));

    const stored = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0];
    expect(stored).toMatchObject({
      status: 'created', google_event_id: 'ev-1', meet_link: MEET,
      attempts: 0, next_retry_at: null, invited_at: expect.any(String),
    });
  });

  it('convida tambem os e-mails fixos da conexao (o closer usa outra conta que a da agenda)', async () => {
    const fake = seed([row()], ['junioralbino28@gmail.com']);
    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(insertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      sendUpdates: 'all',
      event: expect.objectContaining({
        attendeeEmails: ['marina@exemplo.com', 'junioralbino28@gmail.com'],
      }),
    }));
  });

  it('lead sem e-mail e conexao com fixos: o evento sai convidando so os fixos', async () => {
    const fake = seed([row({ invitee_email: null })], ['junioralbino28@gmail.com', 'closer2@exemplo.com']);
    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(insertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      sendUpdates: 'all',
      event: expect.objectContaining({
        attendeeEmails: ['junioralbino28@gmail.com', 'closer2@exemplo.com'],
      }),
    }));
    // Nenhum convite veio do lead: o teto anti-abuso nao e consumido.
    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0].invited_at).toBeNull();
  });

  it('REGRESSAO: conexao SEM extraAttendees manda o mesmo payload de antes', async () => {
    const fake = seed([row()]);
    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(insertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ attendeeEmails: ['marina@exemplo.com'] }),
    }));
  });

  it('lead sem e-mail e sem fixos: evento so na agenda do responsavel, sendUpdates=none', async () => {
    const fake = seed([row({ invitee_email: null })]);
    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(insertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      sendUpdates: 'none',
      event: expect.objectContaining({ attendeeEmails: [] }),
    }));
  });

  it('AUDITORIA: todo convite ao lead gera aviso de baixa severidade com o e-mail convidado', async () => {
    const fake = seed([row()]);
    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    const avisos = fake.rowsOf('system_notifications');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ severity: 'low', organization_id: ORG });
    expect(String(avisos[0].message)).toContain('marina@exemplo.com');
  });

  it('ANTI-ABUSO: passando de 20 convites em 24 h, o evento sai SEM o convidado do lead + aviso alto', async () => {
    const fake = seed([row()], ['junioralbino28@gmail.com'],
      convitesEnviados(GOOGLE_MEETING_DAILY_INVITE_LIMIT));

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    // Os fixos continuam (sao configuracao do cliente, nao entram no teto); o lead, nao.
    expect(insertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ attendeeEmails: ['junioralbino28@gmail.com'] }),
    }));
    const alto = fake.rowsOf('system_notifications').filter((aviso) => aviso.severity === 'high');
    expect(alto).toHaveLength(1);
    expect(String(alto[0].title)).toContain('limite do dia');
  });

  it('convites antigos (fora da janela de 24 h) nao contam para o teto', async () => {
    const antigos = convitesEnviados(GOOGLE_MEETING_DAILY_INVITE_LIMIT, '2026-09-20T09:00:00.000Z');
    const fake = seed([...antigos, row()]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(insertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ attendeeEmails: ['marina@exemplo.com'] }),
    }));
  });

  it('REMARCACAO: `update_pending` vira events.patch no MESMO evento, com o horario novo', async () => {
    const fake = seed([row({
      status: 'update_pending', google_event_id: 'ev-1', meet_link: MEET,
      scheduled_at: '2026-09-24T17:00:00.000Z', invited_at: NOW,
    })], ['junioralbino28@gmail.com']);

    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.updated).toBe(1);
    expect(insertEventMock).not.toHaveBeenCalled();
    expect(patchEventMock).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'primary',
      eventId: 'ev-1',
      event: expect.objectContaining({
        startAt: '2026-09-24T17:00:00.000Z',
        endAt: '2026-09-24T17:40:00.000Z',
        // Os convidados continuam no evento remarcado.
        attendeeEmails: ['marina@exemplo.com', 'junioralbino28@gmail.com'],
      }),
    }));
    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0]).toMatchObject({ status: 'created', next_retry_at: null });
  });

  it('CANCELAMENTO: `cancel_pending` vira events.delete e fecha a linha como `cancelled`', async () => {
    const fake = seed([row({ status: 'cancel_pending', google_event_id: 'ev-1', meet_link: MEET })]);

    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.cancelled).toBe(1);
    expect(deleteEventMock).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'primary', eventId: 'ev-1' }));
    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0]).toMatchObject({
      status: 'cancelled', next_retry_at: null,
      reminder_sent_at: expect.any(String), reminder_escalated_at: expect.any(String),
    });
  });

  it('MEET PENDING: sem link no insert, a linha fica agendada para releitura e o link chega depois', async () => {
    insertEventMock.mockResolvedValue({ id: 'ev-1', status: 'confirmed', hangoutLink: null, conferenceStatus: 'pending' });
    const fake = seed([row()]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });
    const depoisDoInsert = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0];
    expect(depoisDoInsert).toMatchObject({ status: 'created', google_event_id: 'ev-1', meet_link: null });
    expect(depoisDoInsert.next_retry_at).toEqual(expect.any(String));

    // Tick seguinte: rele o evento e finalmente grava o link.
    getEventMock.mockResolvedValue({ id: 'ev-1', status: 'confirmed', hangoutLink: MEET, conferenceStatus: 'success' });
    const segundo = await createDueGoogleCalendarEvents({
      admin: fake as never, now: '2026-09-22T12:30:00.000Z',
    });

    expect(segundo.linked).toBe(1);
    expect(getEventMock).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'ev-1' }));
    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0]).toMatchObject({
      status: 'created', meet_link: MEET, attempts: 0, next_retry_at: null,
    });
  });

  it('RETENTATIVA: falha comum mantem o status, conta a tentativa e espera mais na proxima', async () => {
    insertEventMock.mockRejectedValue(new GoogleApiError('Backend Error', 500, null));
    const fake = seed([row()]);

    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.failed).toBe(1);
    const primeira = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0];
    expect(primeira).toMatchObject({ status: 'pending', attempts: 1 });
    expect(String(primeira.last_error)).toContain('Backend Error');
    const primeiraEspera = new Date(String(primeira.next_retry_at)).getTime();

    await createDueGoogleCalendarEvents({ admin: fake as never, now: '2026-09-22T13:00:00.000Z' });
    const segunda = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0];
    expect(segunda.attempts).toBe(2);
    // Espera crescente: a 2a tentativa adia mais que a 1a.
    expect(new Date(String(segunda.next_retry_at)).getTime()).toBeGreaterThan(primeiraEspera);
  });

  it('ESGOTAMENTO: na ultima tentativa vira `failed` e sobe aviso de alta severidade', async () => {
    insertEventMock.mockRejectedValue(new GoogleApiError('Backend Error', 500, null));
    const fake = seed([row({ attempts: MAX_GOOGLE_MEETING_ATTEMPTS - 1 })]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0]).toMatchObject({
      status: 'failed', attempts: MAX_GOOGLE_MEETING_ATTEMPTS, next_retry_at: null,
    });
    const avisos = fake.rowsOf('system_notifications');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ severity: 'high' });
    expect(String(avisos[0].title)).toContain('sem evento no Google');
  });

  it('INVALID_GRANT: marca a conexao como reconnect_required e avisa com severidade alta', async () => {
    insertEventMock.mockRejectedValue(new GoogleApiError('Token has been expired or revoked.', 400, 'invalid_grant'));
    const fake = seed([row()]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(markGoogleCalendarConnectionIssueMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, ownerId: OWNER, status: 'reconnect_required',
    }));
    // Para de insistir na hora (token morto nao melhora com retentativa).
    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0]).toMatchObject({ status: 'failed', next_retry_at: null });
    const avisos = fake.rowsOf('system_notifications');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ severity: 'high' });
    expect(String(avisos[0].title)).toContain('reconectado');
  });

  it('dois ticks concorrentes: a reserva atomica impede chamar o Google duas vezes', async () => {
    const fake = seed([row()]);

    await Promise.all([
      createDueGoogleCalendarEvents({ admin: fake as never, now: NOW }),
      createDueGoogleCalendarEvents({ admin: fake as never, now: NOW }),
    ]);

    expect(insertEventMock).toHaveBeenCalledTimes(1);
  });

  it('a reserva do CRM nunca e desfeita: nenhuma falha do Google toca em activities', async () => {
    insertEventMock.mockRejectedValue(new GoogleApiError('Backend Error', 500, null));
    const fake = createFakeSupabaseAdmin({
      [GOOGLE_MEETING_EVENT_TABLE]: [row()],
      channel_connections: [connectionConfig()],
      activities: [{ id: ACTIVITY, organization_id: ORG, type: 'MEETING', completed: false, deleted_at: null }],
    });

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(fake.rowsOf('activities')).toHaveLength(1);
    expect(fake.rowsOf('activities')[0]).toMatchObject({ completed: false, deleted_at: null });
  });

  it('sem access token (conexao desfeita entre a reserva e o tick), nao chama o Google', async () => {
    getGoogleCalendarAccessTokenMock.mockResolvedValue(null);
    const fake = seed([row()]);

    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.skipped).toBe(1);
    expect(insertEventMock).not.toHaveBeenCalled();
  });
});

describe('idempotencia do events.insert (retentativa nao duplica evento nem convite)', () => {
  it('409 do Google: le o evento que ja existe em vez de criar outro', async () => {
    // A tentativa anterior chegou no Google; so a resposta se perdeu (timeout de 6 s).
    insertEventMock.mockRejectedValueOnce(new GoogleApiError('duplicate', 409, null));
    getEventMock.mockResolvedValue({ id: 'ev-ja-existia', status: 'confirmed', hangoutLink: MEET, conferenceStatus: 'success' });
    const fake = seed([row({ attempts: 1 })]);

    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary).toMatchObject({ created: 1, failed: 0 });
    expect(insertEventMock).toHaveBeenCalledTimes(1);
    expect(getEventMock).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'primary' }));
    const linha = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0];
    expect(linha).toMatchObject({ status: 'created', google_event_id: 'ev-ja-existia', meet_link: MEET });
  });

  it('manda id proprio derivado da activity, e o mesmo id em toda tentativa', async () => {
    const fake = seed([row()]);
    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    const primeiro = insertEventMock.mock.calls[0][0].event.eventId;
    expect(primeiro).toBe(`cenno${ACTIVITY.replace(/-/g, '')}`);
    // Formato exigido pelo Google: base32hex (0-9a-v), 5 a 1024 caracteres.
    expect(primeiro).toMatch(/^[0-9a-v]{5,1024}$/);

    insertEventMock.mockClear();
    const outro = seed([row({ status: 'pending', google_event_id: null, meet_link: null })]);
    await createDueGoogleCalendarEvents({ admin: outro as never, now: NOW });
    expect(insertEventMock.mock.calls[0][0].event.eventId).toBe(primeiro);
  });

  it('409 numa remarcacao NAO acontece: o patch nao manda id nem pede conferencia nova', async () => {
    const fake = seed([row({ status: 'update_pending', google_event_id: 'ev-1', meet_link: MEET })]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    const enviado = patchEventMock.mock.calls[0][0].event;
    expect(enviado.eventId).toBeNull();
    // Pedir conferencia nova num evento que ja tem uma troca (ou congela) o link do Meet.
    expect(enviado.conferenceRequestId).toBeNull();
  });
});

describe('teto de convites tambem na remarcacao (achado bloqueante de seguranca)', () => {
  function comConvitesGastos(quantidade: number, linha: Record<string, unknown>) {
    return seed([linha], undefined, convitesEnviados(quantidade, NOW));
  }

  it('endereco NOVO na remarcacao consome o teto e vira aviso de auditoria', async () => {
    const fake = seed([row({
      status: 'update_pending',
      google_event_id: 'ev-1',
      meet_link: MEET,
      // Confirmou sem e-mail; informou depois e pediu para remarcar.
      invitee_email: 'depois@exemplo.com',
      invited_at: null,
      invited_email: null,
    })]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(patchEventMock.mock.calls[0][0].event.attendeeEmails).toEqual(['depois@exemplo.com']);
    const linha = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0];
    expect(linha.invited_email).toBe('depois@exemplo.com');
    expect(linha.invited_at).toEqual(expect.any(String));
    const avisos = fake.rowsOf('system_notifications');
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0].message)).toContain('depois@exemplo.com');
  });

  it('com o teto estourado, a remarcacao NAO convida o endereco novo', async () => {
    const fake = comConvitesGastos(GOOGLE_MEETING_DAILY_INVITE_LIMIT, row({
      status: 'update_pending',
      google_event_id: 'ev-1',
      meet_link: MEET,
      invitee_email: 'novo@exemplo.com',
      invited_at: null,
      invited_email: null,
    }));

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    const chamadaDaRemarcacao = patchEventMock.mock.calls[0][0];
    expect(chamadaDaRemarcacao.event.attendeeEmails).toEqual([]);
    const alvo = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE).find((linha) => linha.activity_id === ACTIVITY);
    expect(alvo?.invited_email).toBeNull();
    const avisoDoLimite = fake.rowsOf('system_notifications')
      .find((aviso) => String(aviso.title).includes('limite do dia'));
    expect(avisoDoLimite).toMatchObject({ severity: 'high' });
  });

  it('MESMO endereco ja convidado: remarcar nao consome teto nem gera aviso novo', async () => {
    const fake = comConvitesGastos(GOOGLE_MEETING_DAILY_INVITE_LIMIT, row({
      status: 'update_pending',
      google_event_id: 'ev-1',
      meet_link: MEET,
      invitee_email: 'Marina@Exemplo.com',
      invited_at: '2026-09-22T11:00:00.000Z',
      invited_email: 'marina@exemplo.com',
    }));

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    // O convidado continua no evento (o Google avisa a mudanca de horario para ele).
    expect(patchEventMock.mock.calls[0][0].event.attendeeEmails).toEqual(['Marina@Exemplo.com']);
    const alvo = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE).find((linha) => linha.activity_id === ACTIVITY);
    expect(alvo?.invited_at).toBe('2026-09-22T11:00:00.000Z');
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);
  });
});

describe('releitura do Meet nao para cedo demais', () => {
  it('resposta sem link mantem a releitura marcada, mesmo com link antigo na linha', async () => {
    patchEventMock.mockResolvedValue({ id: 'ev-1', status: 'confirmed', hangoutLink: null, conferenceStatus: 'pending' });
    const fake = seed([row({ status: 'update_pending', google_event_id: 'ev-1', meet_link: MEET })]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    const linha = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0];
    expect(linha.next_retry_at).toEqual(expect.any(String));
    expect(linha.meet_link).toBe(MEET);
  });
});

describe('sem credencial nao gira para sempre', () => {
  it('na ultima tentativa, cancelamento sem token vira falha com aviso de apagar na mao', async () => {
    getGoogleCalendarAccessTokenMock.mockResolvedValue(null);
    const fake = seed([row({
      status: 'cancel_pending',
      google_event_id: 'ev-1',
      attempts: MAX_GOOGLE_MEETING_ATTEMPTS - 1,
    })]);

    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.failed).toBe(1);
    const linha = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0];
    expect(linha).toMatchObject({ status: 'failed', next_retry_at: null });
    const aviso = fake.rowsOf('system_notifications')[0];
    expect(String(aviso.title)).toContain('evento ainda no Google');
    expect(String(aviso.message)).toContain('Apague na mão');
  });
});

describe('eventos orfaos: apagar a conversa no CRM nao deixa evento vivo na agenda', () => {
  function orfao(overrides: Record<string, unknown> = {}) {
    return {
      id: 'orfao-1',
      organization_id: ORG,
      owner_id: OWNER,
      google_calendar_id: 'primary',
      google_event_id: 'ev-1',
      source_activity_id: ACTIVITY,
      attempts: 0,
      next_retry_at: NOW,
      ...overrides,
    };
  }

  it('apaga no Google e some com a linha', async () => {
    const fake = createFakeSupabaseAdmin({ [GOOGLE_ORPHAN_EVENT_TABLE]: [orfao()] });

    const summary = await deleteOrphanGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary).toMatchObject({ due: 1, deleted: 1, failed: 0 });
    expect(deleteEventMock).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'primary', eventId: 'ev-1',
    }));
    expect(fake.rowsOf(GOOGLE_ORPHAN_EVENT_TABLE)).toHaveLength(0);
  });

  it('sem conexao do Google: para de tentar e guarda o motivo, sem sumir com o registro', async () => {
    getGoogleCalendarAccessTokenMock.mockResolvedValue(null);
    const fake = createFakeSupabaseAdmin({ [GOOGLE_ORPHAN_EVENT_TABLE]: [orfao()] });

    await deleteOrphanGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(deleteEventMock).not.toHaveBeenCalled();
    const linha = fake.rowsOf(GOOGLE_ORPHAN_EVENT_TABLE)[0];
    expect(linha.next_retry_at).toBeNull();
    expect(String(linha.last_error)).toContain('apague o evento na mão');
  });

  it('REGRESSAO: sem orfao nenhum, nao pede token nem fala com o Google', async () => {
    const fake = createFakeSupabaseAdmin({ [GOOGLE_ORPHAN_EVENT_TABLE]: [] });

    const summary = await deleteOrphanGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.due).toBe(0);
    expect(getGoogleCalendarAccessTokenMock).not.toHaveBeenCalled();
    expect(deleteEventMock).not.toHaveBeenCalled();
  });

  it('dois ticks concorrentes apagam uma vez so', async () => {
    const fake = createFakeSupabaseAdmin({ [GOOGLE_ORPHAN_EVENT_TABLE]: [orfao()] });

    await Promise.all([
      deleteOrphanGoogleCalendarEvents({ admin: fake as never, now: NOW }),
      deleteOrphanGoogleCalendarEvents({ admin: fake as never, now: NOW }),
    ]);

    expect(deleteEventMock).toHaveBeenCalledTimes(1);
  });
});

describe('reconectar o Google devolve as reunioes futuras para a fila', () => {
  it('so as FUTURAS e so as que nunca viraram evento', async () => {
    const fake = seed([
      row({ activity_id: 'futura', status: 'failed', google_event_id: null, next_retry_at: null, scheduled_at: SCHEDULED }),
      row({ activity_id: 'passada', status: 'failed', google_event_id: null, next_retry_at: null, scheduled_at: '2026-09-01T12:00:00.000Z' }),
      row({ activity_id: 'ja-criada', status: 'created', google_event_id: 'ev-9', next_retry_at: null, scheduled_at: SCHEDULED }),
    ]);

    const voltaram = await requeueFailedGoogleMeetingEvents({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, now: NOW,
    });

    expect(voltaram).toBe(1);
    const porId = Object.fromEntries(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE).map((linha) => [linha.activity_id, linha]));
    expect(porId.futura).toMatchObject({ status: 'pending', attempts: 0, next_retry_at: NOW });
    expect(porId.passada).toMatchObject({ status: 'failed', next_retry_at: null });
    expect(porId['ja-criada']).toMatchObject({ status: 'created' });
  });
});

describe('o teto conta CONVITES, nao linhas (achado alto da revisao dos consertos)', () => {
  /**
   * A remarcacao reusa a MESMA linha da fila. Contando linhas, o contador de uma conversa nunca
   * passava de 1: o lead informava um e-mail, remarcava, trocava o e-mail, remarcava de novo, e
   * cada volta disparava um convite real da conta Google da empresa para um endereco novo.
   */
  function remarcandoCom(email: string, jaConvidado: string | null, log: Record<string, unknown>[]) {
    return createFakeSupabaseAdmin({
      [GOOGLE_MEETING_EVENT_TABLE]: [row({
        status: 'update_pending',
        google_event_id: 'ev-1',
        meet_link: MEET,
        invitee_email: email,
        invited_at: jaConvidado ? '2026-09-22T10:00:00.000Z' : null,
        invited_email: jaConvidado,
      })],
      [GOOGLE_INVITE_LOG_TABLE]: log,
      channel_connections: [connectionConfig()],
    });
  }

  function logCom(quantidade: number) {
    return Array.from({ length: quantidade }, (_, index) => ({
      id: `log-${index}`,
      organization_id: ORG,
      owner_id: OWNER,
      invitee_email: `convidado${index}@exemplo.com`,
      source_activity_id: ACTIVITY,
      sent_at: '2026-09-22T09:00:00.000Z',
    }));
  }

  it('cada convite novo vira uma linha no log, com o endereco', async () => {
    const fake = remarcandoCom('primeiro@exemplo.com', null, []);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    const log = fake.rowsOf(GOOGLE_INVITE_LOG_TABLE);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      organization_id: ORG, owner_id: OWNER, invitee_email: 'primeiro@exemplo.com',
    });
  });

  it('MESMA conversa trocando de e-mail encosta no teto (era o buraco: contava 1 para sempre)', async () => {
    // 20 convites ja saíram desta conexao — todos a partir da MESMA activity.
    const fake = remarcandoCom('vigesimo-primeiro@exemplo.com', null, logCom(GOOGLE_MEETING_DAILY_INVITE_LIMIT));

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(patchEventMock.mock.calls[0][0].event.attendeeEmails).toEqual([]);
    expect(fake.rowsOf(GOOGLE_INVITE_LOG_TABLE)).toHaveLength(GOOGLE_MEETING_DAILY_INVITE_LIMIT);
    const aviso = fake.rowsOf('system_notifications').find((linha) => String(linha.title).includes('limite do dia'));
    expect(aviso).toMatchObject({ severity: 'high' });
  });

  it('convite de ontem nao conta: a janela e de 24 h', async () => {
    const antigos = logCom(GOOGLE_MEETING_DAILY_INVITE_LIMIT)
      .map((linha) => ({ ...linha, sent_at: '2026-09-20T09:00:00.000Z' }));
    const fake = remarcandoCom('novo@exemplo.com', null, antigos);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(patchEventMock.mock.calls[0][0].event.attendeeEmails).toEqual(['novo@exemplo.com']);
  });

  it('avisar o MESMO convidado nao gasta o teto nem escreve no log', async () => {
    const fake = remarcandoCom('marina@exemplo.com', 'marina@exemplo.com', logCom(3));

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(patchEventMock.mock.calls[0][0].event.attendeeEmails).toEqual(['marina@exemplo.com']);
    expect(fake.rowsOf(GOOGLE_INVITE_LOG_TABLE)).toHaveLength(3);
  });
});

describe('reconectar o Google NAO ressuscita recusa do anti-abuso', () => {
  it('linha `blocked` fica onde esta; so a `failed` volta para a fila', async () => {
    const fake = seed([
      row({ activity_id: 'falhou-no-google', status: 'failed', google_event_id: null, next_retry_at: null }),
      row({
        activity_id: 'barrada-pelo-limite',
        status: 'blocked',
        google_event_id: null,
        next_retry_at: null,
        last_error: 'Limite anti-abuso: ja existe um evento ativo no Google para este contato.',
      }),
    ]);

    const voltaram = await requeueFailedGoogleMeetingEvents({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, now: NOW,
    });

    expect(voltaram).toBe(1);
    const porId = Object.fromEntries(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE).map((linha) => [linha.activity_id, linha]));
    expect(porId['falhou-no-google']).toMatchObject({ status: 'pending' });
    expect(porId['barrada-pelo-limite']).toMatchObject({ status: 'blocked', next_retry_at: null });
  });

  it('o tick nao processa linha `blocked`', async () => {
    const fake = seed([row({ status: 'blocked', next_retry_at: NOW, google_event_id: null })]);

    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.due).toBe(0);
    expect(insertEventMock).not.toHaveBeenCalled();
  });
});

describe('409 que devolve evento CANCELADO nao e adotado', () => {
  it('trata como falha em vez de gravar `created` atras de um link que nunca vem', async () => {
    insertEventMock.mockRejectedValueOnce(new GoogleApiError('duplicate', 409, null));
    getEventMock.mockResolvedValue({ id: 'ev-1', status: 'cancelled', hangoutLink: null, conferenceStatus: null });
    const fake = seed([row({ attempts: 1 })]);

    const summary = await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(summary.failed).toBe(1);
    const linha = fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0];
    expect(linha.status).not.toBe('created');
    expect(String(linha.last_error)).toContain('apagado na agenda');
  });
});

describe('orfao que nao pode ser apagado vira aviso no sino', () => {
  it('sem conexao, avisa com severidade alta em vez de so gravar last_error', async () => {
    getGoogleCalendarAccessTokenMock.mockResolvedValue(null);
    const fake = createFakeSupabaseAdmin({
      [GOOGLE_ORPHAN_EVENT_TABLE]: [{
        id: 'orfao-1', organization_id: ORG, owner_id: OWNER, google_calendar_id: 'primary',
        google_event_id: 'ev-1', source_activity_id: ACTIVITY, attempts: 0, next_retry_at: NOW,
      }],
    });

    await deleteOrphanGoogleCalendarEvents({ admin: fake as never, now: NOW });

    const aviso = fake.rowsOf('system_notifications')[0];
    expect(aviso).toMatchObject({ severity: 'high', organization_id: ORG });
    expect(String(aviso.title)).toContain('continua na agenda');
    // Aviso de conexao leva para a tela de canais, nao para uma conversa que nao existe.
    expect(String(aviso.link)).toContain('/channels');
  });
});

describe('agenda de OBSERVACAO — avisa, nunca bloqueia (pedido do Junior, 22/09)', () => {
  const OUTRA = 'agenda-da-equipe@group.calendar.google.com';

  it('sem agenda de observacao: nao fala com o freeBusy nem grava aviso', async () => {
    const fake = seed([row()]);
    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(freeBusyMock).not.toHaveBeenCalled();
    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0]).toMatchObject({
      status: 'created', overlap_warning: null,
    });
  });

  it('com conflito: a reuniao NASCE do mesmo jeito e o aviso vai para a linha e para o sino', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue({ watchCalendarIds: [OUTRA], busyCalendarIds: [] });
    freeBusyMock.mockResolvedValue([{ start: SCHEDULED, end: '2026-09-23T17:40:00.000Z' }]);
    const fake = seed([row()]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    // O ponto da regra: o horario NAO foi bloqueado — o evento existe.
    expect(insertEventMock).toHaveBeenCalledTimes(1);
    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0]).toMatchObject({
      status: 'created', overlap_warning: OVERLAP_WARNING_TEXT,
    });
    const aviso = fake.rowsOf('system_notifications').find((n) => String(n.title).includes('por cima'));
    expect(aviso).toBeTruthy();
    expect(aviso!.severity).toBe('medium');
    // So o intervalo da propria reuniao e consultado, e so nas agendas observadas.
    expect(freeBusyMock).toHaveBeenCalledWith(expect.objectContaining({
      calendarIds: [OUTRA], timeMin: SCHEDULED, timeMax: '2026-09-23T17:40:00.000Z',
    }));
  });

  it('sem conflito: nao avisa, e limpa um aviso antigo da linha (remarcou para horario livre)', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue({ watchCalendarIds: [OUTRA], busyCalendarIds: [] });
    freeBusyMock.mockResolvedValue([]);
    const fake = seed([row({ overlap_warning: 'aviso velho' })]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0]).toMatchObject({ overlap_warning: null });
    expect(fake.rowsOf('system_notifications').some((n) => String(n.title).includes('por cima'))).toBe(false);
  });

  it('a agenda onde a IA escreve nunca entra na consulta de observacao', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue({ watchCalendarIds: ['primary'], busyCalendarIds: [] });
    const fake = seed([row()]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(freeBusyMock).not.toHaveBeenCalled();
  });

  it('REMARCACAO tambem recalcula: horario novo livre limpa o aviso do horario antigo', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue({ watchCalendarIds: [OUTRA], busyCalendarIds: [] });
    freeBusyMock.mockResolvedValue([]);
    const fake = seed([row({
      status: 'update_pending', google_event_id: 'ev-1', meet_link: MEET,
      overlap_warning: OVERLAP_WARNING_TEXT,
    })]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(patchEventMock).toHaveBeenCalledTimes(1);
    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0]).toMatchObject({ overlap_warning: null });
  });

  it('falha ao consultar a observacao nao derruba a reuniao ja criada', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue({ watchCalendarIds: [OUTRA], busyCalendarIds: [] });
    freeBusyMock.mockRejectedValue(new Error('Google fora do ar'));
    const fake = seed([row()]);

    await createDueGoogleCalendarEvents({ admin: fake as never, now: NOW });

    expect(fake.rowsOf(GOOGLE_MEETING_EVENT_TABLE)[0]).toMatchObject({
      status: 'created', meet_link: MEET,
    });
  });
});
