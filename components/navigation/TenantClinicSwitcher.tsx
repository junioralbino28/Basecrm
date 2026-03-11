'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, ChevronsUpDown } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import { isAgencyAdminRole } from '@/lib/auth/scope';
import {
  getTenantWorkspaceHref,
  getTenantWorkspaceRelativeHref,
  isTenantWorkspacePath,
} from '@/lib/tenancy/workspaceRoutes';

type TenantListItem = {
  id: string;
  name: string;
  branding_config?: {
    displayName?: string;
  };
};

type TenantListResponse = {
  tenants?: TenantListItem[];
  error?: string;
};

interface TenantClinicSwitcherProps {
  className?: string;
  compact?: boolean;
}

export function TenantClinicSwitcher({
  className,
  compact = false,
}: TenantClinicSwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const isAgencyAdmin = isAgencyAdminRole(profile?.role);
  const [tenants, setTenants] = React.useState<TenantListItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [switchingTenantId, setSwitchingTenantId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isAgencyAdmin) return;

    let active = true;
    setIsLoading(true);

    const load = async () => {
      try {
        const response = await fetch('/api/platform/tenants', {
          method: 'GET',
          credentials: 'include',
          headers: { accept: 'application/json' },
        });
        const payload = (await response.json().catch(() => null)) as TenantListResponse | null;
        if (!response.ok) throw new Error(payload?.error || 'Falha ao carregar clinicas.');
        if (!active) return;
        setTenants(payload?.tenants || []);
      } catch {
        if (!active) return;
        setTenants([]);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [isAgencyAdmin]);

  if (!isAgencyAdmin || !tenant?.organizationId) return null;

  const currentTenantName =
    tenant.brandingConfig?.displayName || tenant.organizationName || 'Clinica ativa';
  const targetHref = isTenantWorkspacePath(pathname)
    ? getTenantWorkspaceHref(getTenantWorkspaceRelativeHref(pathname), tenant.organizationId)
    : `/platform/tenants/${tenant.organizationId}/dashboard`;

  const handleSelectTenant = async (tenantId: string) => {
    if (!tenantId || tenantId === tenant.organizationId) {
      setIsOpen(false);
      return;
    }

    setSwitchingTenantId(tenantId);
    try {
      const response = await fetch('/api/platform/tenant/current', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ tenantId }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || 'Falha ao trocar clinica.');
      }

      const nextPath = isTenantWorkspacePath(pathname)
        ? getTenantWorkspaceHref(getTenantWorkspaceRelativeHref(pathname), tenantId)
        : `/platform/tenants/${tenantId}/dashboard`;
      router.push(nextPath);
      setIsOpen(false);
    } catch {
      setIsOpen(false);
    } finally {
      setSwitchingTenantId(null);
    }
  };

  return (
    <div className={`relative ${className || ''}`}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={`group inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-left text-sm text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200 ${compact ? 'min-w-[220px]' : 'min-w-[280px]'}`}
        aria-label="Trocar clinica ativa"
      >
        <Building2 size={16} className="text-slate-400 transition group-hover:text-cyan-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{currentTenantName}</div>
          {!compact ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {switchingTenantId ? 'Trocando clinica...' : 'Clinica ativa'}
            </div>
          ) : null}
        </div>
        <ChevronsUpDown size={15} className="text-slate-400" />
      </button>

      {isOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Fechar troca de clinica"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-white/10 dark:text-slate-400">
              Trocar clinica
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {isLoading ? (
                <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                  Carregando clinicas...
                </div>
              ) : (
                tenants.map((item) => {
                  const displayName = item.branding_config?.displayName || item.name;
                  const isCurrent = item.id === tenant.organizationId;
                  const isSwitching = item.id === switchingTenantId;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void handleSelectTenant(item.id)}
                      disabled={isSwitching}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition ${isCurrent ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-200' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5'} disabled:cursor-wait disabled:opacity-70`}
                    >
                      <div className={`h-2.5 w-2.5 rounded-full ${isCurrent ? 'bg-cyan-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{displayName}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {isCurrent ? 'Clinica atual' : isSwitching ? 'Abrindo...' : 'Abrir workspace desta clinica'}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <div className="border-t border-slate-200 px-4 py-3 dark:border-white/10">
              <a
                href={targetHref}
                className="text-xs font-medium text-slate-500 hover:text-cyan-700 dark:text-slate-400 dark:hover:text-cyan-200"
              >
                Permanecer na clinica atual
              </a>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
