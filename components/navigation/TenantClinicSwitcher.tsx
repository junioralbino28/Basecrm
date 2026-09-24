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
        if (!response.ok) throw new Error(payload?.error || 'Falha ao carregar clientes.');
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
    tenant.brandingConfig?.displayName || tenant.organizationName || 'Cliente ativo';
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
        throw new Error(payload?.error || 'Falha ao trocar cliente.');
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

  const handleGoToAgencyPanel = async () => {
    setSwitchingTenantId('platform');
    try {
      await fetch('/api/platform/tenant/current', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ tenantId: null }),
      });
    } finally {
      setIsOpen(false);
      setSwitchingTenantId(null);
      router.push('/platform');
    }
  };

  return (
    // `min-w-0` tambem AQUI: `truncate` so encolhe quando todo item flex da cadeia pode encolher.
    // Sem isto no wrapper, o botao interno ja tinha `min-w-0` e o nome continuava estourando.
    <div className={`relative min-w-0 ${className || ''}`}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        // O minimo so vale a partir de sm. Num celular de 320px o `min-w-[280px]` nao cabia ao
        // lado do botao "Area da clinica": o nome da clinica estourava o cabecalho em 153px e
        // era cortado, com o sino de notificacao caindo por cima (medido em 24/09/2026).
        className={`group inline-flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-left text-sm text-ink transition hover:border-brand-400 hover:text-brand-700 ${compact ? 'sm:min-w-[220px]' : 'sm:min-w-[280px]'}`}
        aria-label="Trocar cliente ativo"
      >
        <Building2 size={16} className="text-faint transition group-hover:text-brand-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{currentTenantName}</div>
          {!compact ? (
            <div className="text-xs text-muted">
              {switchingTenantId ? 'Trocando cliente...' : 'Cliente ativo'}
            </div>
          ) : null}
        </div>
        <ChevronsUpDown size={15} className="text-faint" />
      </button>

      {isOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Fechar troca de cliente"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-card shadow-2xl">
            <div className="border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Trocar cliente
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => void handleGoToAgencyPanel()}
                disabled={switchingTenantId === 'platform'}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-ink transition hover:bg-surface disabled:cursor-wait disabled:opacity-70"
              >
                <div className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">Painel da agencia</div>
                  <div className="text-xs text-muted">
                    {switchingTenantId === 'platform' ? 'Abrindo...' : 'Voltar para modo plataforma'}
                  </div>
                </div>
              </button>
              <div className="my-1 border-t border-line" />
              {isLoading ? (
                <div className="px-4 py-3 text-sm text-muted">
                  Carregando clientes...
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
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition ${isCurrent ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'text-ink hover:bg-surface'} disabled:cursor-wait disabled:opacity-70`}
                    >
                      <div className={`h-2.5 w-2.5 rounded-full ${isCurrent ? 'bg-brand-500' : 'bg-line'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{displayName}</div>
                        <div className="text-xs text-muted">
                          {isCurrent ? 'Cliente atual' : isSwitching ? 'Abrindo...' : 'Abrir workspace deste cliente'}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <div className="border-t border-line px-4 py-3">
              <a
                href={targetHref}
                className="text-xs font-medium text-muted hover:text-brand-700"
              >
                Permanecer no cliente atual
              </a>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
