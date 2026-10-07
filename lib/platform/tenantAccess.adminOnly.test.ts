// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ role: 'clinic_admin', org: 'org-a' }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        single: async () => ({ data: { id: 'u1', role: estado.role, organization_id: estado.org }, error: null }),
      };
      return consulta;
    },
  }),
}));
vi.mock('@/lib/auth/permissions.server', () => ({ loadPermissionOverrides: async () => ({}) }));

import { requireTenantAccess } from './tenantAccess';

describe('requireTenantAccess com adminOnly', () => {
  it.each(['clinic_admin', 'clinic_staff', 'agency_staff'])('%s do próprio cliente recebe 403', async (role) => {
    estado.role = role;
    estado.org = 'org-a';
    const r = await requireTenantAccess('org-a', { adminOnly: true });
    expect('error' in r ? r.error.status : 200).toBe(403);
  });

  it.each(['agency_admin', 'admin'])('%s entra em qualquer cliente', async (role) => {
    estado.role = role;
    estado.org = 'org-agencia';
    const r = await requireTenantAccess('org-a', { adminOnly: true });
    expect('error' in r).toBe(false);
  });
});
