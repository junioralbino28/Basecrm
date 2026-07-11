import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const loadOverridesMock = vi.fn();
let insertPayload: Record<string, any> | null = null;

vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/platform/adminTenantContext', () => ({
  requireAdminTenantContext: (...a: unknown[]) => authMock(...a),
}));
vi.mock('@/lib/auth/permissions.server', () => ({
  loadPermissionOverrides: (...a: unknown[]) => loadOverridesMock(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({}),
  createStaticAdminClient: () => ({
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        insertPayload = payload;
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'inv-1', token: 'tok-1', ...payload }, error: null }),
          }),
        };
      },
    }),
  }),
}));

import { POST } from './route';

function post(body: unknown) {
  return POST(
    new Request('https://app.local/api/admin/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  insertPayload = null;
  loadOverridesMock.mockResolvedValue({}); // ator sem override = usa defaults do cargo (clinic_admin = tudo)
  authMock.mockResolvedValue({
    me: { id: 'me-1', role: 'clinic_admin' },
    targetOrganizationId: 'org-A',
    managingOwnOrganization: true,
  });
});

describe('POST /api/admin/invites — convite granular', () => {
  it('rejeita convite sem email (agora obrigatório)', async () => {
    const res = await post({ role: 'clinic_staff', scope: 'clinic' });
    expect(res.status).toBe(400);
  });

  it('grava cargo + permission_overrides + email no convite', async () => {
    const overrides = { 'settings.finance': false, 'atendimentos.manage': true };
    const res = await post({
      role: 'clinic_staff',
      email: 'vitoria@clinica.com',
      cargo: 'Secretária',
      permissionOverrides: overrides,
      scope: 'clinic',
    });
    expect(res.status).toBe(201);
    expect(insertPayload?.email).toBe('vitoria@clinica.com');
    expect(insertPayload?.cargo).toBe('Secretária');
    expect(insertPayload?.permission_overrides).toEqual(overrides);
  });

  it('rejeita permissão inexistente no override (.strict)', async () => {
    const res = await post({
      role: 'clinic_staff',
      email: 'x@y.com',
      permissionOverrides: { 'chave.invalida': true },
    });
    expect(res.status).toBe(400);
  });

  it('clampa: ator sem a permissão NÃO consegue concedê-la (defesa em profundidade)', async () => {
    // ator é clinic_admin, mas foi restringido: settings.finance = false
    loadOverridesMock.mockResolvedValue({ 'settings.finance': false });
    const res = await post({
      role: 'clinic_staff',
      email: 'x@y.com',
      permissionOverrides: { 'settings.finance': true, 'atendimentos.manage': true },
    });
    expect(res.status).toBe(201);
    // settings.finance concedido como true, mas o ator não tem -> vira false
    expect(insertPayload?.permission_overrides['settings.finance']).toBe(false);
    // atendimentos.manage o ator tem -> passa
    expect(insertPayload?.permission_overrides['atendimentos.manage']).toBe(true);
  });
});
