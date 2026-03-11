'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

type TenantState = {
  organizationId: string;
  organizationName: string;
  editionKey: string | null;
  brandingConfig: {
    displayName?: string;
    logoUrl?: string | null;
    themeMode?: 'light' | 'dark';
    accentColor?: string;
  };
  enabledModules: string[];
  source: 'domain' | 'profile_fallback' | 'selected';
};

type TenantContextValue = {
  tenant: TenantState | null;
  loading: boolean;
  refreshTenant: () => Promise<void>;
};

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant, setTenant] = useState<TenantState | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  const loadTenant = async () => {
    try {
      const res = await fetch('/api/platform/tenant/current', {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTenant(null);
        return;
      }

      setTenant(data?.tenant || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTenant();
  }, []);

  useEffect(() => {
    const routeMatch = pathname.match(/^\/platform\/tenants\/([^/]+)(?:\/|$)/);
    const routeTenantId = routeMatch?.[1] ?? null;

    if (!routeTenantId || routeTenantId === tenant?.organizationId) return;

    let active = true;

    const syncTenantFromRoute = async () => {
      try {
        await fetch('/api/platform/tenant/current', {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ tenantId: routeTenantId }),
        });

        if (!active) return;
        await loadTenant();
      } catch {
        // Best effort: explicit tenant routes continue funcionando mesmo sem sync.
      }
    };

    void syncTenantFromRoute();

    return () => {
      active = false;
    };
  }, [pathname, tenant?.organizationId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!tenant?.brandingConfig?.accentColor) return;

    document.documentElement.style.setProperty('--tenant-accent-color', tenant.brandingConfig.accentColor);
  }, [tenant?.brandingConfig?.accentColor]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!tenant?.brandingConfig?.displayName) return;

    document.title = tenant.brandingConfig.displayName;
  }, [tenant?.brandingConfig?.displayName]);

  const value = useMemo<TenantContextValue>(
    () => ({
      tenant,
      loading,
      refreshTenant: loadTenant,
    }),
    [tenant, loading]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenant must be used within a TenantProvider');
  return context;
}
