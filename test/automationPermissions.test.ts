// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenantWorkspaceNav } from '@/components/navigation/navConfig';

const mocks = vi.hoisted(() => ({
  requireTenantAccess: vi.fn(),
  createStaticAdminClient: vi.fn(),
  loadAutomationWorkspace: vi.fn(),
}));

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: mocks.requireTenantAccess,
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: mocks.createStaticAdminClient,
}));
vi.mock('@/lib/automations/workspace', () => ({
  loadAutomationWorkspace: mocks.loadAutomationWorkspace,
}));

import { GET as listAutomations } from '@/app/api/platform/tenants/[tenantId]/automations/route';

describe('gate de operação das automações', () => {
  beforeEach(() => {
    mocks.requireTenantAccess.mockReset();
    mocks.createStaticAdminClient.mockReset();
    mocks.loadAutomationWorkspace.mockReset();
  });

  it('não inclui Automações na navegação sem a permissão', () => {
    const withoutPermission = getTenantWorkspaceNav({
      tenantId: 'tenant-a',
      canAccessConversations: true,
      canAccessAutomations: false,
    });
    const withPermission = getTenantWorkspaceNav({
      tenantId: 'tenant-a',
      canAccessAutomations: true,
    });

    expect(withoutPermission.map(({ id }) => id)).not.toContain('tenant_automations');
    expect(withPermission.map(({ id }) => id)).toContain('tenant_automations');
  });

  it('exige automation.operate no endpoint de listagem', async () => {
    mocks.requireTenantAccess.mockResolvedValue({
      error: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await listAutomations(
      new Request('http://localhost/api/platform/tenants/tenant-a/automations'),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.requireTenantAccess).toHaveBeenCalledWith('tenant-a', {
      requiredPermissions: ['automation.operate'],
    });
    expect(mocks.loadAutomationWorkspace).not.toHaveBeenCalled();
  });

  it('permite o endpoint quando um override resolveu a permissão', async () => {
    mocks.requireTenantAccess.mockResolvedValue({
      profile: { id: 'user-a' },
      permissions: {
        'automation.edit': false,
        'automation.operate': true,
      },
    });
    mocks.createStaticAdminClient.mockReturnValue({ local: true });
    mocks.loadAutomationWorkspace.mockResolvedValue({
      automations: [],
      templates: [],
    });

    const response = await listAutomations(
      new Request('http://localhost/api/platform/tenants/tenant-a/automations'),
      { params: Promise.resolve({ tenantId: 'tenant-a' }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access: { canEdit: false, canOperate: true },
    });
  });
});
