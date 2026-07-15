import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadPermissionOverridesMock = vi.fn();
let authUser: { id: string } | null;

vi.mock('@/lib/auth/permissions.server', () => ({
  loadPermissionOverrides: (...args: unknown[]) => loadPermissionOverridesMock(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: authUser } }),
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({
          data: {
            id: 'user-1',
            role: 'clinic_admin',
            organization_id: 'org-1',
          },
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  authUser = { id: 'user-1' };
  loadPermissionOverridesMock.mockResolvedValue({ 'reports.finance': false });
});

describe('GET /api/me/permissions', () => {
  it('retorna o mapa resolvido do próprio usuário', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      role: 'clinic_admin',
      permissions: {
        'reports.finance': false,
        'contacts.view': true,
      },
    });
    expect(loadPermissionOverridesMock).toHaveBeenCalledWith('user-1');
  });

  it('retorna 401 quando não há usuário autenticado', async () => {
    authUser = null;

    const response = await GET();

    expect(response.status).toBe(401);
    expect(loadPermissionOverridesMock).not.toHaveBeenCalled();
  });
});
