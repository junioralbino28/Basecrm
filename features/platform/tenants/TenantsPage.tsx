import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Building2, CircleDot, Pencil, PlusCircle } from 'lucide-react';

type TenantRow = {
  id: string;
  name: string;
  branding_config?: {
    displayName?: string;
  };
  created_at: string;
  edition_key: string | null;
  last_run: {
    id: string;
    status: string;
    created_at: string;
    result_payload?: {
      boardName?: string;
    };
  } | null;
};

type TenantProvisioningMode = 'full' | 'empty';

const statusTone: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  running: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  pending: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200',
};

export const TenantsPage: React.FC = () => {
  const router = useRouter();
  const [tenants, setTenants] = React.useState<TenantRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectingTenantId, setSelectingTenantId] = React.useState<string | null>(null);
  const [isCreatingTestTenant, setIsCreatingTestTenant] = React.useState(false);
  const [isCreatingEmptyTenant, setIsCreatingEmptyTenant] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const res = await fetch('/api/platform/tenants', {
          method: 'GET',
          credentials: 'include',
          headers: { accept: 'application/json' },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Falha ao carregar clinicas (HTTP ${res.status})`);
        if (!active) return;
        setTenants(data?.tenants || []);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Falha ao carregar clinicas.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const handleOpenTenant = React.useCallback(
    async (tenantId: string) => {
      setSelectingTenantId(tenantId);
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
        if (!response.ok) throw new Error(payload?.error || 'Falha ao selecionar clinica.');
        router.push(`/platform/tenants/${tenantId}/dashboard`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Falha ao selecionar clinica.');
      } finally {
        setSelectingTenantId(null);
      }
    },
    [router]
  );

  const handleCreateTenant = React.useCallback(async (mode: TenantProvisioningMode) => {
    if (mode === 'empty') {
      setIsCreatingEmptyTenant(true);
    } else {
      setIsCreatingTestTenant(true);
    }
    setError(null);

    const suffix = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').toLowerCase();
    const payload = {
      companyName: mode === 'empty' ? `Clinica Migracao ${suffix}` : `Clinica Teste ${suffix}`,
      subdomain: (mode === 'empty' ? `clinica-migracao-${suffix}` : `clinica-teste-${suffix}`).slice(0, 48),
      specialty: 'Odontologia',
      primaryGoal:
        mode === 'empty'
          ? 'Receber migracao segura do tenant legado sem board inicial'
          : 'Validar o fluxo multi-clinica e o atendimento operacional no CRM',
      serviceModel:
        mode === 'empty'
          ? 'Tenant limpo para migracao de dados legados'
          : 'Avaliacao inicial e atendimento comercial via WhatsApp',
      leadChannel: 'WhatsApp',
      notes:
        mode === 'empty'
          ? 'Conta limpa criada para receber migracao do tenant legado sem provisioning de board inicial.'
          : 'Conta de validacao criada para separar dados legados da agencia e testar o modelo novo.',
      provisioningMode: mode,
    };

    try {
      const response = await fetch('/api/platform/tenants', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.error || (mode === 'empty' ? 'Falha ao criar clinica limpa.' : 'Falha ao criar clinica teste.')
        );
      }

      const tenantId = data?.tenant?.organizationId as string | undefined;
      if (!tenantId) {
        throw new Error(mode === 'empty'
          ? 'Clinica limpa criada sem organizationId retornado.'
          : 'Clinica teste criada sem organizationId retornado.');
      }

      await handleOpenTenant(tenantId);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : mode === 'empty'
            ? 'Falha ao criar clinica limpa.'
            : 'Falha ao criar clinica teste.'
      );
    } finally {
      if (mode === 'empty') {
        setIsCreatingEmptyTenant(false);
      } else {
        setIsCreatingTestTenant(false);
      }
    }
  }, [handleOpenTenant]);

  return (
    <div className="space-y-6 p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Clinicas</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Clinicas e ultimos runs de provisionamento.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCreateTenant('empty')}
            disabled={isCreatingEmptyTenant || isCreatingTestTenant}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-70 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:border-amber-500/40 dark:hover:bg-amber-500/15"
          >
            <Building2 size={16} />
            {isCreatingEmptyTenant ? 'Criando clinica limpa...' : 'Criar Clinica Limpa'}
          </button>

          <button
            type="button"
            onClick={() => void handleCreateTenant('full')}
            disabled={isCreatingTestTenant}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-700 disabled:cursor-wait disabled:opacity-70 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-500/40 dark:hover:text-teal-200"
          >
            <Building2 size={16} />
            {isCreatingTestTenant ? 'Criando teste...' : 'Criar Clinica Teste'}
          </button>

          <Link
            href="/platform/tenants/new"
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500"
          >
            <PlusCircle size={16} />
            Nova Clinica
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="grid grid-cols-[1.8fr_0.8fr_1fr_1fr_0.8fr] gap-4 border-b border-slate-200 px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-white/10 dark:text-slate-400">
          <div>Clinica</div>
          <div>Edicao</div>
          <div>Ultimo status</div>
          <div>Funil inicial</div>
          <div>Acoes</div>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-sm text-slate-500 dark:text-slate-400">Carregando clinicas...</div>
        ) : error ? (
          <div className="px-6 py-12 text-sm text-rose-600 dark:text-rose-300">{error}</div>
        ) : tenants.length === 0 ? (
          <div className="px-6 py-12 text-sm text-slate-500 dark:text-slate-400">
            Nenhuma clinica provisionada ainda.
          </div>
        ) : (
          tenants.map((tenant) => {
            const displayName = tenant.branding_config?.displayName || tenant.name;
            const isSelecting = selectingTenantId === tenant.id;

            return (
              <button
                key={tenant.id}
                type="button"
                onClick={() => void handleOpenTenant(tenant.id)}
                disabled={isSelecting}
                className="grid w-full cursor-pointer grid-cols-[1.8fr_0.8fr_1fr_1fr_0.8fr] gap-4 border-b border-slate-100 px-6 py-5 text-left text-sm transition hover:bg-slate-50 hover:shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)] disabled:cursor-wait disabled:opacity-70 last:border-b-0 dark:border-white/5 dark:hover:bg-white/5"
                title={`Abrir clinica ${displayName}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                    <Building2 size={16} className="text-slate-400" />
                    <span className="truncate">{displayName}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(tenant.created_at).toLocaleString('pt-BR')}
                  </div>
                  <div className="mt-2 text-xs font-medium text-cyan-700 dark:text-cyan-300">
                    Clique para abrir o workspace desta clinica
                  </div>
                </div>

                <div className="text-slate-700 dark:text-slate-200">{tenant.edition_key || '-'}</div>

                <div>
                  {tenant.last_run ? (
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${statusTone[tenant.last_run.status] || statusTone.pending}`}>
                      <CircleDot size={12} />
                      {tenant.last_run.status}
                    </span>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">-</span>
                  )}
                </div>

                <div className="text-slate-700 dark:text-slate-200">
                  {tenant.last_run?.result_payload?.boardName || '-'}
                </div>

                <div className="flex items-center justify-end gap-2">
                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-white/10 dark:text-slate-200">
                    <ArrowRight size={14} />
                    {isSelecting ? 'Abrindo...' : 'Abrir'}
                  </span>
                  <Link
                    href={`/platform/tenants/${tenant.id}/branding`}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-teal-300 hover:text-teal-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-teal-500/40 dark:hover:text-teal-200"
                  >
                    <Pencil size={14} />
                    Editar
                  </Link>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
