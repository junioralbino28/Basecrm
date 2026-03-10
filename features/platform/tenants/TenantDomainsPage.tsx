import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Globe, PlusCircle } from 'lucide-react';
import { useTenantDetail } from './useTenantDetail';

export const TenantDomainsPage: React.FC = () => {
  const { tenant, tenantId, loading, error, reload } = useTenantDetail();
  const [host, setHost] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const onCreate = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/domains`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          host,
          is_primary: tenant?.domains.length === 0,
          status: 'active',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao salvar dominio (HTTP ${res.status})`);
      setHost('');
      await reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Falha ao salvar dominio.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-8 max-w-5xl mx-auto">
      <Link href={`/platform/tenants/${tenantId}`} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">
        <ArrowLeft size={16} />
        Voltar para clinica
      </Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Dominios e subdominios</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Gerencie os hosts que resolvem esta clinica.</p>

        <div className="mt-6 flex gap-3">
          <input
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-white"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="clinica-exemplo.seudominio.com"
          />
          <button onClick={onCreate} disabled={saving || !host.trim()} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500 disabled:opacity-50">
            <PlusCircle size={16} />
            {saving ? 'Salvando...' : 'Adicionar'}
          </button>
        </div>

        {saveError ? <div className="mt-4 text-sm text-rose-600 dark:text-rose-300">{saveError}</div> : null}
        {loading ? <div className="mt-6 text-sm text-slate-500 dark:text-slate-400">Carregando dominios...</div> : null}
        {error ? <div className="mt-6 text-sm text-rose-600 dark:text-rose-300">{error}</div> : null}

        {tenant ? (
          <div className="mt-6 space-y-3">
            {tenant.domains.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                Nenhum host cadastrado ainda.
              </div>
            ) : (
              tenant.domains.map((domain) => (
                <div key={domain.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-white/10 dark:bg-white/5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                      <Globe size={16} className="text-slate-400" />
                      <span className="truncate">{domain.host}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {domain.is_primary ? 'primario' : 'secundario'} • {domain.status}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
