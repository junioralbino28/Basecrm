import { describe, expect, it } from 'vitest';
import { getTenantWorkspaceNav } from './navConfig';

describe('item Agentes no menu do cliente', () => {
  it('aparece só com canAccessAgents e aponta para a lista do cliente', () => {
    const sem = getTenantWorkspaceNav({ tenantId: 't1', canAccessConversations: true });
    expect(sem.map((i) => i.id)).not.toContain('tenant_agents');

    const so = getTenantWorkspaceNav({ tenantId: 't1', canAccessAgents: true });
    expect(so).toEqual([expect.objectContaining({ id: 'tenant_agents', label: 'Agentes', href: '/platform/tenants/t1/agents' })]);
  });

  it('fica logo depois de Automações', () => {
    const todos = getTenantWorkspaceNav({
      tenantId: 't1', canAccessAgents: true, canAccessAutomations: true, canAccessConversations: true, canAccessWhatsapp: true,
    });
    expect(todos.map((i) => i.id)).toEqual(['tenant_automations', 'tenant_agents', 'tenant_conversations', 'tenant_whatsapp_connect']);
  });
});
