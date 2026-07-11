import { describe, it, expect, vi, beforeEach } from 'vitest';

const createUser = vi.fn();
const deleteUser = vi.fn();
let inviteRow: Record<string, unknown> | null;
let profilesError: { message: string } | null = null;
let permError: { message: string } | null = null;
const profilesUpserts: Array<Record<string, unknown>> = [];
const permUpserts: Array<Record<string, unknown>> = [];

vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    auth: { admin: { createUser, deleteUser } },
    from: (table: string) => {
      if (table === 'organization_invites') {
        return {
          select: () => ({
            eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: inviteRow, error: inviteRow ? null : { message: 'not found' } }) }) }),
          }),
          update: () => ({ eq: () => ({ is: () => Promise.resolve({ error: null }) }) }),
        };
      }
      if (table === 'profiles') {
        return { upsert: (payload: Record<string, unknown>) => { profilesUpserts.push(payload); return Promise.resolve({ error: profilesError }); } };
      }
      if (table === 'profile_permissions') {
        return { upsert: (payload: Record<string, unknown>) => { permUpserts.push(payload); return Promise.resolve({ error: permError }); } };
      }
      return {};
    },
  }),
}));

import { POST } from './route';

function accept(body: unknown) {
  return POST(
    new Request('https://app.local/api/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  profilesUpserts.length = 0;
  permUpserts.length = 0;
  profilesError = null;
  permError = null;
  createUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  inviteRow = {
    id: 'inv-1',
    token: 'tok-1',
    email: 'vitoria@clinica.com',
    role: 'clinic_staff',
    cargo: 'Secretária',
    organization_id: 'org-A',
    expires_at: null,
    used_at: null,
    permission_overrides: { 'settings.finance': false, 'atendimentos.manage': true, 'chave.invalida': true },
  };
});

describe('POST /api/invites/accept — aplica cargo + permissões do convite', () => {
  it('grava o cargo no profile', async () => {
    const res = await accept({ token: 'tok-1', email: 'vitoria@clinica.com', password: '123456' });
    expect(res.status).toBe(200);
    expect(profilesUpserts[0].cargo).toBe('Secretária');
  });

  it('aplica só as chaves válidas do override, com a org DO CONVITE e valores certos', async () => {
    await accept({ token: 'tok-1', email: 'vitoria@clinica.com', password: '123456' });
    const keys = permUpserts.map((p) => p.permission_key);
    expect(keys).toContain('settings.finance');
    expect(keys).toContain('atendimentos.manage');
    expect(keys).not.toContain('chave.invalida'); // filtrada pela whitelist APP_PERMISSIONS
    expect(permUpserts.every((p) => p.organization_id === 'org-A')).toBe(true);
    expect(permUpserts.find((p) => p.permission_key === 'settings.finance')?.enabled).toBe(false);
    expect(permUpserts.find((p) => p.permission_key === 'atendimentos.manage')?.enabled).toBe(true);
  });

  it('mantém o lock de email (email diferente do convite = 400)', async () => {
    const res = await accept({ token: 'tok-1', email: 'outro@x.com', password: '123456' });
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejeita convite legado SEM email (evita takeover)', async () => {
    inviteRow = { ...(inviteRow as object), email: null } as Record<string, unknown>;
    const res = await accept({ token: 'tok-1', email: 'qualquer@x.com', password: '123456' });
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejeita convite expirado (400) sem criar usuário', async () => {
    inviteRow = { ...(inviteRow as object), expires_at: '2020-01-01T00:00:00.000Z' } as Record<string, unknown>;
    const res = await accept({ token: 'tok-1', email: 'vitoria@clinica.com', password: '123456' });
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rollback: falha ao gravar profile -> deleteUser + 400', async () => {
    profilesError = { message: 'db down' };
    const res = await accept({ token: 'tok-1', email: 'vitoria@clinica.com', password: '123456' });
    expect(res.status).toBe(400);
    expect(deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('rollback: falha ao gravar permissão -> deleteUser + 400', async () => {
    permError = { message: 'db down' };
    const res = await accept({ token: 'tok-1', email: 'vitoria@clinica.com', password: '123456' });
    expect(res.status).toBe(400);
    expect(deleteUser).toHaveBeenCalledWith('user-1');
  });
});
