import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshGoogleAccessTokenMock = vi.fn();
const readGoogleCalendarRefreshTokenMock = vi.fn();

vi.mock('./googleApiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./googleApiClient')>();
  return {
    ...actual,
    refreshGoogleAccessToken: (...args: unknown[]) => refreshGoogleAccessTokenMock(...args),
  };
});
vi.mock('./connectionStore', () => ({
  readGoogleCalendarRefreshToken: (...args: unknown[]) => readGoogleCalendarRefreshTokenMock(...args),
}));

import {
  buildGoogleCalendarAuthUrl,
  buildGoogleCalendarRedirectUri,
  clearGoogleCalendarAccessTokenCache,
  getGoogleCalendarAccessToken,
  isAllowedGoogleOAuthOrigin,
  resolveGoogleCalendarOAuthEnv,
} from './oauth';

const ORG = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';

describe('oauth — URL de consentimento, origem permitida e cache de access token', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    clearGoogleCalendarAccessTokenCache();
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-1';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret-1';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('monta a URL de consentimento com offline, consent, include_granted_scopes, escopos minimos e o state', () => {
    const url = new URL(buildGoogleCalendarAuthUrl({
      clientId: 'client-1',
      redirectUri: 'https://crm.basea2.com/api/integrations/google-calendar/callback',
      state: 'state-1',
    }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://crm.basea2.com/api/integrations/google-calendar/callback');
    const scopes = String(url.searchParams.get('scope')).split(' ');
    expect(scopes).toEqual(expect.arrayContaining([
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.freebusy',
      'https://www.googleapis.com/auth/calendar.events',
    ]));
  });

  it('so aceita os 3 redirect origins cadastrados no Google Cloud; rejeita qualquer outro', () => {
    expect(isAllowedGoogleOAuthOrigin('https://crm.basea2.com')).toBe(true);
    expect(isAllowedGoogleOAuthOrigin('https://teste.crm.basea2.com')).toBe(true);
    expect(isAllowedGoogleOAuthOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedGoogleOAuthOrigin('https://dominio-nao-cadastrado.com')).toBe(false);
  });

  it('redirect_uri e sempre o callback fixo, por origem', () => {
    expect(buildGoogleCalendarRedirectUri('https://crm.basea2.com'))
      .toBe('https://crm.basea2.com/api/integrations/google-calendar/callback');
    expect(buildGoogleCalendarRedirectUri('http://localhost:3000'))
      .toBe('http://localhost:3000/api/integrations/google-calendar/callback');
  });

  it('sem GOOGLE_OAUTH_CLIENT_ID/SECRET, configured e null (o botao nao aparece)', () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(resolveGoogleCalendarOAuthEnv()).toBeNull();
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-1';
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(resolveGoogleCalendarOAuthEnv()).toBeNull();
  });

  it('renova o access token a partir do refresh token do Vault e cacheia em memoria por (org, owner)', async () => {
    readGoogleCalendarRefreshTokenMock.mockResolvedValue('rt-1');
    refreshGoogleAccessTokenMock.mockResolvedValue({ access_token: 'at-1', expires_in: 3600 });

    const admin = {} as never;
    const token1 = await getGoogleCalendarAccessToken({ admin, organizationId: ORG, ownerId: OWNER });
    const token2 = await getGoogleCalendarAccessToken({ admin, organizationId: ORG, ownerId: OWNER });

    expect(token1).toBe('at-1');
    expect(token2).toBe('at-1');
    expect(refreshGoogleAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it('sem refresh token guardado (sem conexao conectada), devolve null sem chamar o Google', async () => {
    readGoogleCalendarRefreshTokenMock.mockResolvedValue(null);
    const admin = {} as never;
    const token = await getGoogleCalendarAccessToken({ admin, organizationId: ORG, ownerId: OWNER });
    expect(token).toBeNull();
    expect(refreshGoogleAccessTokenMock).not.toHaveBeenCalled();
  });

  it('sem as env vars configuradas, devolve null sem sequer consultar o Vault', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const admin = {} as never;
    const token = await getGoogleCalendarAccessToken({ admin, organizationId: ORG, ownerId: OWNER });
    expect(token).toBeNull();
    expect(readGoogleCalendarRefreshTokenMock).not.toHaveBeenCalled();
  });

  it('invalid_grant do refresh propaga para o chamador decidir (reconnect_required)', async () => {
    readGoogleCalendarRefreshTokenMock.mockResolvedValue('rt-morta');
    refreshGoogleAccessTokenMock.mockRejectedValue(Object.assign(new Error('Token has been expired or revoked.'), { code: 'invalid_grant' }));
    const admin = {} as never;
    await expect(getGoogleCalendarAccessToken({ admin, organizationId: ORG, ownerId: OWNER }))
      .rejects.toMatchObject({ code: 'invalid_grant' });
  });
});
