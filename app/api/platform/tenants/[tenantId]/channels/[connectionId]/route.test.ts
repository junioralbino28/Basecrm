import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveEvolutionCredentialsMock = vi.fn();
const logoutEvolutionInstanceMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
let deleteFilters: Array<[string, string]>;
let fromTables: string[];

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/auth/scope', () => ({ isAgencyAdminRole: () => false }));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  ensureTenantAgencyBinding: vi.fn(),
  resolveEvolutionCredentials: (...args: unknown[]) => resolveEvolutionCredentialsMock(...args),
}));
vi.mock('@/lib/channels/evolution', () => ({
  logoutEvolutionInstance: (...args: unknown[]) => logoutEvolutionInstanceMock(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: (table: string) => {
      fromTables.push(table);
      return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: {
                id: CONNECTION,
                provider: 'evolution',
                config: { instanceName: 'comercial-vitoria-a1b2c3d4' },
                metadata: {},
              },
              error: null,
            }),
          }),
        }),
      }),
      delete: () => ({
        eq: (column: string, value: string) => {
          deleteFilters.push([column, value]);
          return {
            eq: (nextColumn: string, nextValue: string) => {
              deleteFilters.push([nextColumn, nextValue]);
              return Promise.resolve({ error: null });
            },
          };
        },
      }),
      };
    },
  }),
}));

import { DELETE } from './route';

const ctx = {
  params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }),
};

function request() {
  return new Request(
    `http://localhost:3000/api/platform/tenants/${TENANT}/channels/${CONNECTION}`,
    { method: 'DELETE' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteFilters = [];
  fromTables = [];
  requireTenantAccessMock.mockResolvedValue({
    profile: { role: 'clinic_admin', organization_id: TENANT },
    canManageChannelConfig: true,
  });
  resolveEvolutionCredentialsMock.mockResolvedValue({
    apiUrl: 'https://evolution.example.com',
    apiKey: 'GLOBAL-KEY',
    source: 'agency_default',
  });
  logoutEvolutionInstanceMock.mockResolvedValue({ ok: true });
});

describe('DELETE channel connection', () => {
  it('faz logout e remove somente a conexao do tenant autorizado', async () => {
    const response = await DELETE(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireTenantAccessMock).toHaveBeenCalledWith(TENANT, {
      requiredPermissions: ['whatsapp.manage_connection'],
    });
    expect(logoutEvolutionInstanceMock).toHaveBeenCalledWith({
      apiUrl: 'https://evolution.example.com',
      apiKey: 'GLOBAL-KEY',
      instanceName: 'comercial-vitoria-a1b2c3d4',
    });
    expect(deleteFilters).toEqual([
      ['id', CONNECTION],
      ['organization_id', TENANT],
    ]);
    expect(fromTables).toEqual(['channel_connections', 'channel_connections']);
    expect(body).toMatchObject({ ok: true, deleted: { id: CONNECTION } });
  });

  it('continua removendo a row quando o logout externo falha', async () => {
    logoutEvolutionInstanceMock.mockRejectedValue(new Error('Evolution indisponivel'));

    const response = await DELETE(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(deleteFilters).toEqual([
      ['id', CONNECTION],
      ['organization_id', TENANT],
    ]);
    expect(body.warning).toMatch(/Evolution indisponivel/);
  });
});
