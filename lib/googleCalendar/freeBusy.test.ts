import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

const getGoogleCalendarConnectionMock = vi.fn();
const markGoogleCalendarConnectionIssueMock = vi.fn();
const getGoogleCalendarAccessTokenMock = vi.fn();
const queryGoogleFreeBusyMock = vi.fn();

vi.mock('./connectionStore', () => ({
  getGoogleCalendarConnection: (...args: unknown[]) => getGoogleCalendarConnectionMock(...args),
  markGoogleCalendarConnectionIssue: (...args: unknown[]) => markGoogleCalendarConnectionIssueMock(...args),
}));
vi.mock('./oauth', () => ({
  getGoogleCalendarAccessToken: (...args: unknown[]) => getGoogleCalendarAccessTokenMock(...args),
}));
vi.mock('./googleApiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./googleApiClient')>();
  return {
    ...actual,
    queryGoogleFreeBusy: (...args: unknown[]) => queryGoogleFreeBusyMock(...args),
  };
});

import { GoogleApiError } from './googleApiClient';
import { clearGoogleFreeBusyCache, loadGoogleBusyIntervals } from './freeBusy';

const ORG = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const TIME_MIN = '2026-09-21T00:00:00.000Z';
const TIME_MAX = '2026-09-22T00:00:00.000Z';

const CONNECTED = {
  id: 'conn-1', organizationId: ORG, ownerId: OWNER,
  googleAccountEmail: 'cenourahub@gmail.com', googleCalendarId: 'primary',
  status: 'connected' as const, scope: 'a b', lastError: null,
  connectedAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  clearGoogleFreeBusyCache();
});
afterEach(() => vi.restoreAllMocks());

describe('loadGoogleBusyIntervals — le o ocupado do Google sem derrubar a oferta', () => {
  it('sem ownerId, devolve [] sem tocar em nada', async () => {
    const fake = createFakeSupabaseAdmin();
    const result = await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: null, timeMin: TIME_MIN, timeMax: TIME_MAX,
    });
    expect(result).toEqual([]);
    expect(getGoogleCalendarConnectionMock).not.toHaveBeenCalled();
  });

  it('sem conexao para o responsavel, devolve [] sem chamar o googleApiClient (regressao)', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(null);
    const fake = createFakeSupabaseAdmin();
    const result = await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: TIME_MAX,
    });
    expect(result).toEqual([]);
    expect(getGoogleCalendarAccessTokenMock).not.toHaveBeenCalled();
    expect(queryGoogleFreeBusyMock).not.toHaveBeenCalled();
  });

  it('conexao existe mas nao esta "connected" (ex.: reconnect_required), devolve [] sem chamar o Google', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue({ ...CONNECTED, status: 'reconnect_required' });
    const fake = createFakeSupabaseAdmin();
    const result = await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: TIME_MAX,
    });
    expect(result).toEqual([]);
    expect(queryGoogleFreeBusyMock).not.toHaveBeenCalled();
  });

  it('sucesso: devolve os intervalos e cacheia por 60s (2a chamada nao bate no Google de novo)', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(CONNECTED);
    getGoogleCalendarAccessTokenMock.mockResolvedValue('at-1');
    queryGoogleFreeBusyMock.mockResolvedValue([{ start: '2026-09-21T12:00:00.000Z', end: '2026-09-21T13:00:00.000Z' }]);
    const fake = createFakeSupabaseAdmin();

    const first = await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: TIME_MAX,
    });
    const second = await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: TIME_MAX,
    });

    expect(first).toEqual([{ start: '2026-09-21T12:00:00.000Z', end: '2026-09-21T13:00:00.000Z' }]);
    expect(second).toEqual(first);
    expect(queryGoogleFreeBusyMock).toHaveBeenCalledTimes(1);
  });

  it('cache acerta com a janela andando alguns segundos (caso real: cada mensagem nasce de um `now` novo)', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(CONNECTED);
    getGoogleCalendarAccessTokenMock.mockResolvedValue('at-1');
    queryGoogleFreeBusyMock.mockResolvedValue([]);
    const fake = createFakeSupabaseAdmin();

    await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER,
      timeMin: '2026-09-21T00:00:00.123Z', timeMax: '2026-10-05T00:00:00.123Z',
    });
    await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER,
      timeMin: '2026-09-21T00:00:07.456Z', timeMax: '2026-10-05T00:00:07.456Z',
    });

    expect(queryGoogleFreeBusyMock).toHaveBeenCalledTimes(1);
  });

  it('cache NAO serve janela que vai muito alem da consultada, nem outro responsavel', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(CONNECTED);
    getGoogleCalendarAccessTokenMock.mockResolvedValue('at-1');
    queryGoogleFreeBusyMock.mockResolvedValue([]);
    const fake = createFakeSupabaseAdmin();

    await loadGoogleBusyIntervals({ admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: TIME_MAX });
    await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: '2026-09-23T00:00:00.000Z',
    });
    await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: '33333333-3333-4333-8333-333333333333', timeMin: TIME_MIN, timeMax: TIME_MAX,
    });

    expect(queryGoogleFreeBusyMock).toHaveBeenCalledTimes(3);
  });

  it('401 do Google: devolve [] e grava um aviso idempotente no sino (1x)', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(CONNECTED);
    getGoogleCalendarAccessTokenMock.mockResolvedValue('at-1');
    queryGoogleFreeBusyMock.mockRejectedValue(new GoogleApiError('Invalid Credentials', 401, null));
    const fake = createFakeSupabaseAdmin();

    const result = await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: TIME_MAX,
    });
    expect(result).toEqual([]);
    expect(markGoogleCalendarConnectionIssueMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, ownerId: OWNER, status: undefined,
    }));
    expect(fake.rowsOf('system_notifications')).toHaveLength(1);
    expect(fake.rowsOf('system_notifications')[0]).toMatchObject({ severity: 'medium', organization_id: ORG });
  });

  it('invalid_grant: marca reconnect_required (nao so grava o erro)', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(CONNECTED);
    getGoogleCalendarAccessTokenMock.mockResolvedValue('at-1');
    queryGoogleFreeBusyMock.mockRejectedValue(new GoogleApiError('Token has been expired or revoked.', 400, 'invalid_grant'));
    const fake = createFakeSupabaseAdmin();

    await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: TIME_MAX,
    });
    expect(markGoogleCalendarConnectionIssueMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'reconnect_required',
    }));
  });

  it('timeout (fetch abortado): devolve [] sem lancar', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(CONNECTED);
    getGoogleCalendarAccessTokenMock.mockResolvedValue('at-1');
    queryGoogleFreeBusyMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    const fake = createFakeSupabaseAdmin();

    await expect(loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: TIME_MAX,
    })).resolves.toEqual([]);
  });

  it('JSON ruim (o cliente lanca ao fazer parse): devolve [] sem lancar', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(CONNECTED);
    getGoogleCalendarAccessTokenMock.mockResolvedValue('at-1');
    queryGoogleFreeBusyMock.mockRejectedValue(new SyntaxError('Unexpected token n in JSON'));
    const fake = createFakeSupabaseAdmin();

    await expect(loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: TIME_MAX,
    })).resolves.toEqual([]);
  });

  it('sem access token (env desconfigurada em tempo de execucao), devolve [] sem chamar o freeBusy', async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue(CONNECTED);
    getGoogleCalendarAccessTokenMock.mockResolvedValue(null);
    const fake = createFakeSupabaseAdmin();

    const result = await loadGoogleBusyIntervals({
      admin: fake as never, organizationId: ORG, ownerId: OWNER, timeMin: TIME_MIN, timeMax: TIME_MAX,
    });
    expect(result).toEqual([]);
    expect(queryGoogleFreeBusyMock).not.toHaveBeenCalled();
  });
});
