import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const user = {
  id: 'user-1',
  email: 'admin@clinica.test',
  user_metadata: {},
};

const fetchMock = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: async () => ({ data: true, error: null }),
    auth: {
      getSession: async () => ({ data: { session: { user } } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signOut: vi.fn(),
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({
          data: {
            id: user.id,
            email: user.email,
            role: 'clinic_admin',
            organization_id: 'org-1',
          },
          error: null,
        }),
      };
      return chain;
    },
  },
}));

function PermissionProbe() {
  const { loading, permissions } = useAuth();
  const finance = permissions?.['reports.finance'];

  return <div>{loading || permissions == null ? 'pending' : finance ? 'allowed' : 'denied'}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        role: 'clinic_admin',
        permissions: { 'reports.finance': false, 'contacts.view': true },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  );
});

describe('AuthProvider permissions', () => {
  it('carrega e expõe as permissões do usuário autenticado', async () => {
    render(
      <AuthProvider>
        <PermissionProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText('denied')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/me/permissions', {
      cache: 'no-store',
      credentials: 'include',
    });
  });

  it('falha fechado sem deixar o estado de permissões pendente', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    render(
      <AuthProvider>
        <PermissionProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText('denied')).toBeInTheDocument());
  });
});
