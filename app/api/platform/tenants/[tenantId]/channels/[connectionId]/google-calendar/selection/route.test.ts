import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';

const requireTenantAccessMock = vi.fn();
const getGoogleCalendarConnectionMock = vi.fn();
const clearCacheMock = vi.fn();
let connectionRow: { id: string; config: Record<string, unknown> | null } | null = null;
/** O que a rota gravou em google_calendar_connections (a checagem que importa). */
let gravado: Record<string, unknown> | null = null;
let erroDeGravacao: string | null = null;

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/googleCalendar/connectionStore', () => ({
  getGoogleCalendarConnection: (...args: unknown[]) => getGoogleCalendarConnectionMock(...args),
}));
vi.mock('@/lib/googleCalendar/freeBusy', () => ({
  clearGoogleFreeBusyCache: () => clearCacheMock(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: connectionRow, error: null }) }),
        }),
      }),
      update: (valores: Record<string, unknown>) => {
        if (tabela === 'google_calendar_connections') gravado = valores;
        return {
          eq: () => ({
            eq: () => ({
              select: () => Promise.resolve(
                erroDeGravacao
                  ? { data: null, error: { message: erroDeGravacao } }
                  : { data: [{ organization_id: TENANT }], error: null },
              ),
            }),
          }),
        };
      },
    }),
  }),
}));

import { PUT } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  gravado = null;
  erroDeGravacao = null;
  requireTenantAccessMock.mockResolvedValue({ profile: { id: 'admin-1', organization_id: TENANT } });
  getGoogleCalendarConnectionMock.mockResolvedValue({
    status: 'connected', googleCalendarId: 'primary', busyCalendarIds: [], scope: 'x',
  });
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

function chamar(corpo: unknown) {
  return PUT(
    new Request('http://localhost/google-calendar/selection', {
      method: 'PUT', body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) },
  );
}

describe('PUT google-calendar/selection', () => {
  it('grava a agenda de escrita e as que contam como ocupado', async () => {
    const response = await chamar({
      writeCalendarId: 'sdr@group.calendar.google.com',
      writeCalendarSummary: 'Cenoura - SDR',
      busyCalendarIds: ['primary', 'pessoal@gmail.com'],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(gravado).toMatchObject({
      google_calendar_id: 'sdr@group.calendar.google.com',
      google_calendar_summary: 'Cenoura - SDR',
      busy_calendar_ids: ['primary', 'pessoal@gmail.com'],
    });
  });

  it('o ocupado em cache e limpo: a troca vale na hora, nao daqui a alguns minutos', async () => {
    await chamar({ writeCalendarId: 'primary' });
    expect(clearCacheMock).toHaveBeenCalledTimes(1);
  });

  it('a agenda de escrita nao se repete na lista de ocupado (ela ja conta sempre)', async () => {
    const body = await (await chamar({
      writeCalendarId: 'sdr@group.calendar.google.com',
      busyCalendarIds: ['sdr@group.calendar.google.com', 'pessoal@gmail.com', 'pessoal@gmail.com'],
    })).json();

    expect(body.busyCalendarIds).toEqual(['pessoal@gmail.com']);
    expect(gravado?.busy_calendar_ids).toEqual(['pessoal@gmail.com']);
  });

  it('corpo invalido nao grava nada', async () => {
    for (const corpo of [
      {},
      { writeCalendarId: '' },
      { writeCalendarId: 'primary', busyCalendarIds: Array.from({ length: 21 }, (_, i) => `a${i}`) },
      { writeCalendarId: 'primary', campoInventado: 1 },
    ]) {
      const response = await chamar(corpo);
      expect(response.status).toBe(400);
    }
    expect(gravado).toBeNull();
  });

  it('sem Google conectado responde 409 em vez de gravar', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(null);

    const response = await chamar({ writeCalendarId: 'primary' });

    expect(response.status).toBe(409);
    expect(gravado).toBeNull();
  });

  it('falha do banco vira 500 e nao limpa o cache', async () => {
    erroDeGravacao = 'coluna inexistente';

    const response = await chamar({ writeCalendarId: 'primary' });

    expect(response.status).toBe(500);
    expect(clearCacheMock).not.toHaveBeenCalled();
  });

  it('exige permissao de gerenciar conexao', async () => {
    requireTenantAccessMock.mockResolvedValue({ error: new Response('nao', { status: 403 }) });

    const response = await chamar({ writeCalendarId: 'primary' });

    expect(response.status).toBe(403);
    expect(gravado).toBeNull();
  });
});
