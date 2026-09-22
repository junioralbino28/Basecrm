import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const VALID_STATE = '44444444-4444-4444-8444-444444444444';

const resolveGoogleCalendarOAuthEnvMock = vi.fn();
const exchangeGoogleCalendarAuthorizationCodeMock = vi.fn();
const fetchGoogleCalendarAccountEmailMock = vi.fn();
const peekGoogleOAuthStateMock = vi.fn();
const claimGoogleOAuthStateMock = vi.fn();
const writeGoogleCalendarConnectionMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => ({}) }));
vi.mock('@/lib/googleCalendar/oauth', () => ({
  buildGoogleCalendarRedirectUri: (origin: string) => `${origin}/api/integrations/google-calendar/callback`,
  exchangeGoogleCalendarAuthorizationCode: (...args: unknown[]) => exchangeGoogleCalendarAuthorizationCodeMock(...args),
  fetchGoogleCalendarAccountEmail: (...args: unknown[]) => fetchGoogleCalendarAccountEmailMock(...args),
  resolveGoogleCalendarOAuthEnv: () => resolveGoogleCalendarOAuthEnvMock(),
}));
vi.mock('@/lib/googleCalendar/oauthState', () => ({
  peekGoogleOAuthState: (...args: unknown[]) => peekGoogleOAuthStateMock(...args),
  claimGoogleOAuthState: (...args: unknown[]) => claimGoogleOAuthStateMock(...args),
}));
vi.mock('@/lib/googleCalendar/connectionStore', () => ({
  writeGoogleCalendarConnection: (...args: unknown[]) => writeGoogleCalendarConnectionMock(...args),
}));

import { GET } from './route';

const KNOWN_STATE_ROW = {
  state: VALID_STATE,
  organizationId: TENANT,
  channelConnectionId: CONNECTION,
  ownerId: OWNER,
  requestedBy: 'admin-1',
  redirectOrigin: 'http://localhost:3000',
  createdAt: '2026-09-22T00:00:00.000Z',
  expiresAt: '2026-09-22T00:10:00.000Z',
  consumedAt: null,
};

function callbackUrl(query: string) {
  return `http://localhost:3000/api/integrations/google-calendar/callback?${query}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveGoogleCalendarOAuthEnvMock.mockReturnValue({ clientId: 'client-1', clientSecret: 'secret-1' });
  peekGoogleOAuthStateMock.mockResolvedValue(KNOWN_STATE_ROW);
  claimGoogleOAuthStateMock.mockResolvedValue(KNOWN_STATE_ROW);
  exchangeGoogleCalendarAuthorizationCodeMock.mockResolvedValue({
    access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-1', scope: 'a b',
  });
  fetchGoogleCalendarAccountEmailMock.mockResolvedValue('cenourahub@gmail.com');
  writeGoogleCalendarConnectionMock.mockResolvedValue({ status: 'connected' });
});

describe('GET /api/integrations/google-calendar/callback', () => {
  it('state ausente: resposta generica, sem redirect (nao sabe pra onde mandar)', async () => {
    const response = await GET(new Request(callbackUrl('code=abc')));
    expect(response.status).toBe(400);
    expect(claimGoogleOAuthStateMock).not.toHaveBeenCalled();
  });

  it('state com formato invalido: resposta generica', async () => {
    const response = await GET(new Request(callbackUrl('code=abc&state=nao-e-uuid')));
    expect(response.status).toBe(400);
    expect(peekGoogleOAuthStateMock).not.toHaveBeenCalled();
  });

  it('state nunca existiu (peek nao acha): resposta generica', async () => {
    peekGoogleOAuthStateMock.mockResolvedValue(null);
    const response = await GET(new Request(callbackUrl(`code=abc&state=${VALID_STATE}`)));
    expect(response.status).toBe(400);
  });

  it('Google devolveu error (consentimento negado): redireciona para o tenant certo com google=erro, sem trocar o code', async () => {
    const response = await GET(new Request(callbackUrl(`error=access_denied&state=${VALID_STATE}`)));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`http://localhost:3000/platform/tenants/${TENANT}/channels?google=erro`);
    expect(claimGoogleOAuthStateMock).not.toHaveBeenCalled();
    expect(exchangeGoogleCalendarAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it('sem code: redireciona com google=erro', async () => {
    const response = await GET(new Request(callbackUrl(`state=${VALID_STATE}`)));
    expect(response.headers.get('location')).toContain('google=erro');
    expect(claimGoogleOAuthStateMock).not.toHaveBeenCalled();
  });

  it('state expirado ou ja consumido (claim devolve null): redireciona com google=erro', async () => {
    claimGoogleOAuthStateMock.mockResolvedValue(null);
    const response = await GET(new Request(callbackUrl(`code=abc&state=${VALID_STATE}`)));
    expect(response.headers.get('location')).toBe(`http://localhost:3000/platform/tenants/${TENANT}/channels?google=erro`);
    expect(exchangeGoogleCalendarAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it('state de outro tenant: usa o tenant DO STATE para redirecionar, nunca um vindo de fora', async () => {
    const outroState = { ...KNOWN_STATE_ROW, organizationId: OTHER_TENANT };
    peekGoogleOAuthStateMock.mockResolvedValue(outroState);
    claimGoogleOAuthStateMock.mockResolvedValue(null); // simula expirado/reusado
    const response = await GET(new Request(callbackUrl(`code=abc&state=${VALID_STATE}`)));
    expect(response.headers.get('location')).toContain(`/platform/tenants/${OTHER_TENANT}/channels`);
  });

  it('sem GOOGLE_OAUTH_CLIENT_ID/SECRET, redireciona com google=erro sem trocar o code', async () => {
    resolveGoogleCalendarOAuthEnvMock.mockReturnValue(null);
    const response = await GET(new Request(callbackUrl(`code=abc&state=${VALID_STATE}`)));
    expect(response.headers.get('location')).toContain('google=erro');
    expect(exchangeGoogleCalendarAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it('Google nao devolve refresh_token: nao grava conexao e redireciona com erro', async () => {
    exchangeGoogleCalendarAuthorizationCodeMock.mockResolvedValue({ access_token: 'at-1', expires_in: 3600 });
    const response = await GET(new Request(callbackUrl(`code=abc&state=${VALID_STATE}`)));
    expect(response.headers.get('location')).toContain('google=erro');
    expect(writeGoogleCalendarConnectionMock).not.toHaveBeenCalled();
  });

  it('userinfo falha (sem e-mail): nao grava conexao e redireciona com erro', async () => {
    fetchGoogleCalendarAccountEmailMock.mockResolvedValue(null);
    const response = await GET(new Request(callbackUrl(`code=abc&state=${VALID_STATE}`)));
    expect(response.headers.get('location')).toContain('google=erro');
    expect(writeGoogleCalendarConnectionMock).not.toHaveBeenCalled();
  });

  it('sucesso: troca o code, le o e-mail, grava a conexao (org/owner do STATE) e redireciona com google=ok', async () => {
    const response = await GET(new Request(callbackUrl(`code=abc&state=${VALID_STATE}`)));
    expect(response.headers.get('location')).toBe(`http://localhost:3000/platform/tenants/${TENANT}/channels?google=ok`);

    expect(exchangeGoogleCalendarAuthorizationCodeMock).toHaveBeenCalledWith(expect.objectContaining({
      code: 'abc',
      redirectUri: 'http://localhost:3000/api/integrations/google-calendar/callback',
    }));
    expect(writeGoogleCalendarConnectionMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: TENANT,
      ownerId: OWNER,
      googleAccountEmail: 'cenourahub@gmail.com',
      refreshToken: 'rt-1',
    }));
    // Nunca token nem code na URL de redirecionamento.
    expect(response.headers.get('location')).not.toMatch(/rt-1|at-1|abc/);
  });

  it('falha na troca do code: redireciona com erro sem vazar o code no log/URL', async () => {
    exchangeGoogleCalendarAuthorizationCodeMock.mockRejectedValue(new Error('invalid_grant'));
    const response = await GET(new Request(callbackUrl(`code=abc&state=${VALID_STATE}`)));
    expect(response.headers.get('location')).toBe(`http://localhost:3000/platform/tenants/${TENANT}/channels?google=erro`);
  });
});
