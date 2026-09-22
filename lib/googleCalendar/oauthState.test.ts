import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { claimGoogleOAuthState, createGoogleOAuthState, peekGoogleOAuthState } from './oauthState';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG_OUTRO = '99999999-9999-4999-8999-999999999999';
const CONN = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const REQUESTER = '44444444-4444-4444-8444-444444444444';

describe('oauthState — state de uso unico, amarrado a tenant/conexao/responsavel', () => {
  it('cria o state com expiracao futura e nao consumido', async () => {
    const fake = createFakeSupabaseAdmin();
    const created = await createGoogleOAuthState({
      admin: fake as never, organizationId: ORG, channelConnectionId: CONN, ownerId: OWNER,
      requestedBy: REQUESTER, redirectOrigin: 'https://crm.basea2.com',
    });
    expect(created.organizationId).toBe(ORG);
    expect(created.consumedAt).toBeNull();
    expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('claim tem sucesso uma vez e falha na segunda tentativa (uso unico)', async () => {
    const fake = createFakeSupabaseAdmin();
    const created = await createGoogleOAuthState({
      admin: fake as never, organizationId: ORG, channelConnectionId: CONN, ownerId: OWNER,
      requestedBy: REQUESTER, redirectOrigin: 'https://crm.basea2.com',
    });

    const first = await claimGoogleOAuthState({ admin: fake as never, state: created.state });
    expect(first?.state).toBe(created.state);
    expect(first?.consumedAt).not.toBeNull();

    const second = await claimGoogleOAuthState({ admin: fake as never, state: created.state });
    expect(second).toBeNull();
  });

  it('claim falha quando o state expirou', async () => {
    const fake = createFakeSupabaseAdmin({
      google_oauth_states: [{
        state: 'expirado-1', organization_id: ORG, channel_connection_id: CONN, owner_id: OWNER,
        requested_by: REQUESTER, redirect_origin: 'https://crm.basea2.com',
        created_at: '2026-09-01T00:00:00.000Z', expires_at: '2026-09-01T00:10:00.000Z', consumed_at: null,
      }],
    });
    const claimed = await claimGoogleOAuthState({ admin: fake as never, state: 'expirado-1' });
    expect(claimed).toBeNull();
  });

  it('claim falha para state inexistente', async () => {
    const fake = createFakeSupabaseAdmin();
    const claimed = await claimGoogleOAuthState({ admin: fake as never, state: 'nunca-existiu' });
    expect(claimed).toBeNull();
  });

  it('peek acha o state mesmo ja consumido (para saber onde redirecionar em caso de erro)', async () => {
    const fake = createFakeSupabaseAdmin({
      google_oauth_states: [{
        state: 'consumido-1', organization_id: ORG_OUTRO, channel_connection_id: CONN, owner_id: OWNER,
        requested_by: REQUESTER, redirect_origin: 'https://crm.basea2.com',
        created_at: '2026-09-22T00:00:00.000Z', expires_at: '2026-09-22T00:10:00.000Z',
        consumed_at: '2026-09-22T00:05:00.000Z',
      }],
    });
    const found = await peekGoogleOAuthState({ admin: fake as never, state: 'consumido-1' });
    expect(found?.organizationId).toBe(ORG_OUTRO);
    expect(found?.consumedAt).not.toBeNull();
  });

  it('o state carrega o tenant/conexao/responsavel de origem — nunca aceita um de outro tenant por fora', async () => {
    const fake = createFakeSupabaseAdmin({
      google_oauth_states: [{
        state: 'de-outro-tenant', organization_id: ORG_OUTRO, channel_connection_id: CONN, owner_id: OWNER,
        requested_by: REQUESTER, redirect_origin: 'https://crm.basea2.com',
        created_at: '2026-09-22T00:00:00.000Z', expires_at: '2026-09-25T00:00:00.000Z', consumed_at: null,
      }],
    });
    const claimed = await claimGoogleOAuthState({ admin: fake as never, state: 'de-outro-tenant' });
    // A organizacao usada para gravar a conexao vem SEMPRE do state, nunca de um tenantId
    // vindo de fora — aqui o proprio state e de ORG_OUTRO, entao e isso que ele devolve.
    expect(claimed?.organizationId).toBe(ORG_OUTRO);
  });
});
