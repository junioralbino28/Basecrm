import React from 'react';
import Link from 'next/link';
import { Building2, CircleDot, PlusCircle } from 'lucide-react';

type TenantRow = {
  id: string;
  name: string;
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

const statusTone: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  running: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  pending: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200',
};

export const TenantsPage: React.FC = () => {
  const [tenants, setTenants] = React.useState<TenantRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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
        if (!res.ok) throw new Error(data?.error || `Falha ao carregar tenants (HTTP ${res.status})`);
        if (!active) return;
        setTenants(data?.tenants || []);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Falha ao carregar tenants.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6 p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Tenants</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Clinicas e ultimos runs de provisionamento.
          </p>
        </div>

        <Link
          href="/platform/tenants/new"
          className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500"
        >
          <PlusCircle size={16} />
          Nova Clinica
        </Link>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="grid grid-cols-[1.8fr_0.8fr_1fr_1fr] gap-4 border-b border-slate-200 px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-white/10 dark:text-slate-400">
          <div>Tenant</div>
          <div>Edition</div>
          <div>Ultimo status</div>
          <div>Board inicial</div>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-sm text-slate-500 dark:text-slate-400">Carregando tenants...</div>
        ) : error ? (
          <div className="px-6 py-12 text-sm text-rose-600 dark:text-rose-300">{error}</div>
        ) : tenants.length === 0 ? (
          <div className="px-6 py-12 text-sm text-slate-500 dark:text-slate-400">
            Nenhum tenant provisionado ainda.
          </div>
        ) : (
          tenants.map((tenant) => (
            <div
              key={tenant.id}
              className="grid grid-cols-[1.8fr_0.8fr_1fr_1fr] gap-4 border-b border-slate-100 px-6 py-5 text-sm last:border-b-0 dark:border-white/5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                  <Building2 size={16} className="text-slate-400" />
                  <span className="truncate">{tenant.name}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {new Date(tenant.created_at).toLocaleString('pt-BR')}
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
            </div>
          ))
        )}
      </div>
    </div>
  );
};
