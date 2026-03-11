'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import { getTenantWorkspaceNav, type SecondaryNavItem } from './navConfig';
import { isAgencyAdminRole } from '@/lib/auth/scope';

type ChannelConnectionRecord = {
  channel_type?: string | null;
  status?: string | null;
};

type TenantNavApiResponse = {
  error?: string;
  access?: {
    canAccessWhatsApp?: boolean;
    canAccessConversations?: boolean;
  };
  tenant?: {
    id: string;
    channel_connections?: ChannelConnectionRecord[] | null;
  };
};

function getTenantIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/platform\/tenants\/([^/]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

export function usePlatformTenantWorkspaceNav(): {
  items: SecondaryNavItem[];
  tenantId: string | null;
  hasConnectedWhatsapp: boolean;
  isLoading: boolean;
} {
  const pathname = usePathname();
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const isAgencyAdmin = isAgencyAdminRole(profile?.role);

  const routeTenantId = useMemo(() => getTenantIdFromPathname(pathname), [pathname]);
  const tenantId = routeTenantId ?? tenant?.organizationId ?? null;

  const tenantQuery = useQuery({
    queryKey: ['platform-tenant-workspace-nav', tenantId],
    enabled: !!profile?.organization_id && !!tenantId,
    queryFn: async () => {
      const response = await fetch(`/api/platform/tenants/${tenantId}`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });

      const payload = (await response.json().catch(() => null)) as TenantNavApiResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load tenant navigation');
      }

      return payload;
    },
    staleTime: 60_000,
  });

  const hasConnectedWhatsapp = useMemo(() => {
    const connections = tenantQuery.data?.tenant?.channel_connections ?? [];
    return connections.some(
      (connection) => connection.channel_type === 'whatsapp' && connection.status === 'connected'
    );
  }, [tenantQuery.data]);

  const canAccessWhatsapp = Boolean(tenantQuery.data?.access?.canAccessWhatsApp) || (Boolean(tenantId) && isAgencyAdmin);
  const canAccessConversations = Boolean(tenantQuery.data?.access?.canAccessConversations) || (Boolean(tenantId) && isAgencyAdmin);

  return {
    items: getTenantWorkspaceNav({
      tenantId,
      hasConnectedWhatsapp,
      canAccessWhatsapp,
      canAccessConversations,
    }),
    tenantId,
    hasConnectedWhatsapp,
    isLoading: tenantQuery.isLoading,
  };
}
