import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const TENANT = 'bd43a9bc-5bab-410a-a5a6-c214f3836f0e';
const estado = vi.hoisted(() => ({ role: 'agency_admin' as string }));

vi.mock('next/navigation', () => ({ usePathname: () => `/platform/tenants/${TENANT}/dashboard` }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: estado.role, organization_id: 'org' } }) }));
vi.mock('@/context/TenantContext', () => ({ useTenant: () => ({ tenant: null }) }));
// A API do cliente devolve todas as permissões ligadas: o item de agentes NÃO pode depender delas.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { access: { canAccessWhatsApp: true, canAccessConversations: true, canAccessAutomations: true }, tenant: { id: TENANT, channel_connections: [] } },
    isLoading: false,
  }),
}));

import { usePlatformTenantWorkspaceNav } from './usePlatformTenantWorkspaceNav';

describe('menu do cliente: Agentes só para a agência', () => {
  it.each([
    ['agency_admin', true],
    ['admin', true],
    ['agency_staff', false],
    ['clinic_admin', false],
    ['clinic_staff', false],
  ])('%s: item Agentes = %s, mesmo com todas as permissões da API ligadas', (role, temItem) => {
    estado.role = role;
    const { result } = renderHook(() => usePlatformTenantWorkspaceNav());
    expect(result.current.items.some((i) => i.id === 'tenant_agents')).toBe(temItem);
  });
});
