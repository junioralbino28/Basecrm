import React from 'react';
import { useParams } from 'next/navigation';

export type TenantDetail = {
  id: string;
  name: string;
  created_at: string;
  edition_key: string | null;
  branding_config: {
    displayName?: string;
    logoUrl?: string | null;
    themeMode?: 'light' | 'dark';
    accentColor?: string;
  };
  enabled_modules: string[];
  metadata: Record<string, unknown>;
  domains: Array<{
    id: string;
    host: string;
    is_primary: boolean;
    status: string;
    created_at: string;
  }>;
  channel_connections: Array<{
    id: string;
    provider: 'evolution';
    channel_type: 'whatsapp';
    name: string;
    status: 'pending' | 'connected' | 'disconnected' | 'error';
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    last_healthcheck_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
  provisioning_runs: Array<{
    id: string;
    status: string;
    input_payload?: Record<string, unknown>;
    result_payload?: Record<string, unknown>;
    created_at: string;
  }>;
};

export function useTenantDetail() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = String(params?.tenantId || '');
  const [tenant, setTenant] = React.useState<TenantDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao carregar tenant (HTTP ${res.status})`);
      setTenant(data?.tenant || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar tenant.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return {
    tenantId,
    tenant,
    loading,
    error,
    reload: load,
  };
}
