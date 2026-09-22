import { describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import {
  deleteGoogleCalendarConnection,
  getGoogleCalendarConnection,
  markGoogleCalendarConnectionIssue,
  readGoogleCalendarRefreshToken,
  writeGoogleCalendarConnection,
} from './connectionStore';

const ORG = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';

describe('connectionStore — ler/gravar google_calendar_connections e chamar o Vault via RPC', () => {
  it('le a conexao existente (metadado publico, nunca o token)', async () => {
    const fake = createFakeSupabaseAdmin({
      google_calendar_connections: [{
        id: 'conn-1', organization_id: ORG, owner_id: OWNER,
        google_account_email: 'cenourahub@gmail.com', google_calendar_id: 'primary',
        status: 'connected', scope: 'a b', last_error: null,
        connected_at: '2026-09-22T00:00:00.000Z', updated_at: '2026-09-22T00:00:00.000Z',
      }],
    });
    const connection = await getGoogleCalendarConnection({ admin: fake as never, organizationId: ORG, ownerId: OWNER });
    expect(connection).toMatchObject({ googleAccountEmail: 'cenourahub@gmail.com', status: 'connected' });
    expect(connection).not.toHaveProperty('refreshToken');
  });

  it('sem conexao para (org, owner), devolve null', async () => {
    const fake = createFakeSupabaseAdmin({ google_calendar_connections: [] });
    const connection = await getGoogleCalendarConnection({ admin: fake as never, organizationId: ORG, ownerId: OWNER });
    expect(connection).toBeNull();
  });

  it('write chama a RPC write_google_calendar_refresh_token com os parametros certos', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: 'conn-1', organization_id: ORG, owner_id: OWNER,
        google_account_email: 'cenourahub@gmail.com', google_calendar_id: 'primary',
        status: 'connected', scope: 'a b', last_error: null,
        connected_at: '2026-09-22T00:00:00.000Z', updated_at: '2026-09-22T00:00:00.000Z',
      },
      error: null,
    });
    const admin = { rpc } as never;

    const connection = await writeGoogleCalendarConnection({
      admin, organizationId: ORG, ownerId: OWNER,
      googleAccountEmail: 'cenourahub@gmail.com', googleCalendarId: 'primary',
      refreshToken: 'rt-1', scope: 'a b',
    });

    expect(rpc).toHaveBeenCalledWith('write_google_calendar_refresh_token', {
      p_organization_id: ORG,
      p_owner_id: OWNER,
      p_google_account_email: 'cenourahub@gmail.com',
      p_google_calendar_id: 'primary',
      p_refresh_token: 'rt-1',
      p_scope: 'a b',
    });
    expect(connection.status).toBe('connected');
  });

  it('read chama read_google_calendar_refresh_token e devolve o texto (ou null)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'rt-1', error: null });
    const admin = { rpc } as never;
    await expect(readGoogleCalendarRefreshToken({ admin, organizationId: ORG, ownerId: OWNER })).resolves.toBe('rt-1');
    expect(rpc).toHaveBeenCalledWith('read_google_calendar_refresh_token', { p_organization_id: ORG, p_owner_id: OWNER });
  });

  it('delete chama delete_google_calendar_refresh_token e devolve booleano', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const admin = { rpc } as never;
    await expect(deleteGoogleCalendarConnection({ admin, organizationId: ORG, ownerId: OWNER })).resolves.toBe(true);
  });

  it('propaga o erro da RPC como excecao (nunca engole silenciosamente)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const admin = { rpc } as never;
    await expect(readGoogleCalendarRefreshToken({ admin, organizationId: ORG, ownerId: OWNER })).rejects.toThrow('boom');
  });

  it('marca reconnect_required e grava last_error redigido sem derrubar nada', async () => {
    const fake = createFakeSupabaseAdmin({
      google_calendar_connections: [{
        id: 'conn-1', organization_id: ORG, owner_id: OWNER, status: 'connected', last_error: null,
      }],
    });
    await markGoogleCalendarConnectionIssue({
      admin: fake as never, organizationId: ORG, ownerId: OWNER,
      status: 'reconnect_required', lastError: 'Token has been expired or revoked.',
    });
    const row = fake.rowsOf('google_calendar_connections')[0];
    expect(row.status).toBe('reconnect_required');
    expect(row.last_error).toBe('Token has been expired or revoked.');
  });
});
