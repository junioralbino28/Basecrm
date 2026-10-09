import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSecondaryNav, getTenantWorkspaceNav } from './navConfig';

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

describe('item Modelos de agente no menu da agência (bloco 2)', () => {
  it('aparece só para a agência e aponta para a biblioteca', () => {
    expect(getSecondaryNav({ isAdmin: false }).map((i) => i.id)).not.toContain('platform_agent_templates');
    expect(getSecondaryNav({ isAdmin: true })).toContainEqual(
      expect.objectContaining({ id: 'platform_agent_templates', label: 'Modelos de agente', href: '/platform/agent-templates' }),
    );
  });

  it('a barra lateral da agência também tem o item, dentro da lista só de admin', () => {
    const fonte = readFileSync(resolve(process.cwd(), 'components/Layout.tsx'), 'utf8');
    const inicio = fonte.indexOf('const adminSidebarNav = isAdmin');
    const fim = fonte.indexOf(': [];', inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fonte.slice(inicio, fim)).toContain("{ to: '/platform/agent-templates', icon: Library, label: 'Modelos de agente'");
  });
});
