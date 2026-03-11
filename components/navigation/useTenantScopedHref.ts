'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { getTenantIdFromPathname, getTenantWorkspaceHref, isTenantWorkspacePath } from '@/lib/tenancy/workspaceRoutes';

export function useTenantScopedHrefBuilder(): (href: string) => string {
  const pathname = usePathname();
  const { tenant } = useTenant();

  return useMemo(() => {
    const routeTenantId = getTenantIdFromPathname(pathname);
    const tenantId = routeTenantId ?? tenant?.organizationId ?? null;
    const shouldScopeToTenant = Boolean(tenantId);

    return (href: string) => (shouldScopeToTenant ? getTenantWorkspaceHref(href, tenantId) : href);
  }, [pathname, tenant?.organizationId]);
}

export function useTenantScopedHref(href: string): string {
  const getScopedHref = useTenantScopedHrefBuilder();
  return useMemo(() => getScopedHref(href), [getScopedHref, href]);
}
