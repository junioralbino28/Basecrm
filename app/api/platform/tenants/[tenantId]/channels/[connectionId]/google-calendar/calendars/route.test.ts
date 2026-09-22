import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';

const ESCOPO_COMPLETO = 'openid email https://www.googleapis.com/auth/calendar.freebusy '
  + 'https://www.googleapis.com/auth/calendar.events '
  + 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const ESCOPO_ANTIGO = 'openid email https://www.googleapis.com/auth/calendar.freebusy '
  + 'https://www.googleapis.com/auth/calendar.events';

const requireTenantAccessMock = vi.fn();
const getGoogleCalendarConnectionMock = vi.fn();
const getAccessTokenMock = vi.fn();
const listCalendarsMock = vi.fn();
let connectionRow: { id: string; config: Record<string, unknown> | null } | null = null;

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/googleCalendar/connectionStore', () => ({
  getGoogleCalendarConnection: (...args: unknown[]) => getGoogleCalendarConnectionMock(...args),
}));
vi.mock('@/lib/googleCalendar/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/googleCalendar/oauth')>();
  return { ...actual, getGoogleCalendarAccessToken: (...args: unknown[]) => getAccessTokenMock(...args) };
});
vi.mock('@/lib/googleCalendar/googleApiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/googleCalendar/googleApiClient')>();
  return { ...actual, listGoogleCalendars: (...args: unknown[]) => listCalendarsMock(...args) };
});
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: connectionRow, error: null }) }),
        }),
      }),
    }),
  }),
}));

import { GoogleApiError } from '@/lib/googleCalendar/googleApiClient';
import { GET } from './route';

function conexaoGoogle(overrides: Record<string, unknown> = {}) {
  return {
    status: 'connected',
    googleAccountEmail: 'cenourahub@gmail.com',
    googleCalendarId: 'primary',
    googleCalendarSummary: null,
    busyCalendarIds: [],
    scope: ESCOPO_COMPLETO,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { id: 'admin-1', organization_id: TENANT } });
  getAccessTokenMock.mockResolvedValue('at-1');
  listCalendarsMock.mockResolvedValue([
    { id: 'primary', summary: 'cenourahub@gmail.com', primary: true, accessRole: 'owner', backgroundColor: null },
    { id: 'sdr@group.calendar.google.com', summary: 'Cenoura - SDR', primary: false, accessRole: 'owner', backgroundColor: '#f87000' },
    { id: 'compartilhada@group.calendar.google.com', summary: 'Sala de reunião', primary: false, accessRole: 'reader', backgroundColor: null },
  ]);
  connectionRow = {
    id: CONNECTION,
    config: {
      calendar: {
        enabled: true, timezone: 'America/Sao_Paulo', ownerId: OWNER,
        minimumNoticeMinutes: 60, schedulingHorizonDays: 7, humanConfirmationWeekdays: ['saturday'],
        weeklyHours: { monday: [{ start: '09:00', end: '18:00' }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
      },
    },
  };
});

function chamar() {
  return GET(new Request('http://localhost/google-calendar/calendars'), {
    params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }),
  });
}

describe('GET google-calendar/calendars', () => {
  it('devolve as agendas da conta, com o que esta escolhido hoje', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(conexaoGoogle({
      googleCalendarId: 'sdr@group.calendar.google.com',
      googleCalendarSummary: 'Cenoura - SDR',
      busyCalendarIds: ['primary'],
    }));

    const body = await (await chamar()).json();

    expect(body.connected).toBe(true);
    expect(body.needsReconnect).toBe(false);
    expect(body.writeCalendarId).toBe('sdr@group.calendar.google.com');
    expect(body.writeCalendarSummary).toBe('Cenoura - SDR');
    expect(body.busyCalendarIds).toEqual(['primary']);
    expect(body.calendars).toHaveLength(3);
    expect(body.calendars[1]).toMatchObject({ id: 'sdr@group.calendar.google.com', summary: 'Cenoura - SDR', accessRole: 'owner' });
    // Nunca vaza token nem e-mail de credencial no corpo.
    expect(JSON.stringify(body)).not.toContain('at-1');
  });

  it('CONEXAO ANTIGA (sem o escopo de listar): pede reconexao SEM falar com o Google', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(conexaoGoogle({ scope: ESCOPO_ANTIGO }));

    const body = await (await chamar()).json();

    expect(body).toMatchObject({ connected: true, needsReconnect: true, calendars: [] });
    expect(getAccessTokenMock).not.toHaveBeenCalled();
    expect(listCalendarsMock).not.toHaveBeenCalled();
  });

  it('403 do Google (permissao revogada depois) tambem vira pedido de reconexao', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(conexaoGoogle());
    listCalendarsMock.mockRejectedValue(new GoogleApiError('insufficient scope', 403, null));

    const response = await chamar();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ connected: true, needsReconnect: true, calendars: [] });
  });

  it('sem Google conectado devolve lista vazia, sem pedir reconexao', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(null);

    const body = await (await chamar()).json();

    expect(body).toMatchObject({ connected: false, needsReconnect: false, calendars: [] });
    expect(listCalendarsMock).not.toHaveBeenCalled();
  });

  it('falha de rede vira 502 com mensagem redigida, nunca com o token', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(conexaoGoogle());
    listCalendarsMock.mockRejectedValue(new Error('socket hang up at-1'));

    const response = await chamar();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(String(body.error)).not.toContain('at-1');
  });

  it('exige permissao de gerenciar conexao', async () => {
    requireTenantAccessMock.mockResolvedValue({ error: new Response('nao', { status: 403 }) });

    const response = await chamar();

    expect(response.status).toBe(403);
    expect(getGoogleCalendarConnectionMock).not.toHaveBeenCalled();
  });
});
