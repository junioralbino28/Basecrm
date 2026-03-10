import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save } from 'lucide-react';
import { useTenantDetail } from './useTenantDetail';

export const TenantBrandingPage: React.FC = () => {
  const { tenant, tenantId, loading, error, reload } = useTenantDetail();
  const [form, setForm] = React.useState({
    displayName: '',
    accentColor: '',
    themeMode: 'light' as 'light' | 'dark',
    logoUrl: '',
  });
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!tenant) return;
    setForm({
      displayName: tenant.branding_config?.displayName || tenant.name,
      accentColor: tenant.branding_config?.accentColor || '#0f766e',
      themeMode: tenant.branding_config?.themeMode || 'light',
      logoUrl: tenant.branding_config?.logoUrl || '',
    });
  }, [tenant]);

  const onSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/branding`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          displayName: form.displayName,
          accentColor: form.accentColor,
          themeMode: form.themeMode,
          logoUrl: form.logoUrl || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao salvar branding (HTTP ${res.status})`);
      await reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Falha ao salvar branding.');
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
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Branding da clinica</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Base de nome exibido, tema e cor principal.</p>

        {loading ? <div className="mt-6 text-sm text-slate-500 dark:text-slate-400">Carregando branding...</div> : null}
        {error ? <div className="mt-6 text-sm text-rose-600 dark:text-rose-300">{error}</div> : null}

        {tenant ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Nome exibido</span>
              <input className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-white" value={form.displayName} onChange={(e) => setForm((current) => ({ ...current, displayName: e.target.value }))} />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Cor principal</span>
              <input className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-white" value={form.accentColor} onChange={(e) => setForm((current) => ({ ...current, accentColor: e.target.value }))} />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Tema</span>
              <select className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-white" value={form.themeMode} onChange={(e) => setForm((current) => ({ ...current, themeMode: e.target.value as 'light' | 'dark' }))}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Logo URL</span>
              <input className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-white" value={form.logoUrl} onChange={(e) => setForm((current) => ({ ...current, logoUrl: e.target.value }))} />
            </label>
          </div>
        ) : null}

        {saveError ? <div className="mt-4 text-sm text-rose-600 dark:text-rose-300">{saveError}</div> : null}

        <div className="mt-6 flex justify-end">
          <button onClick={onSave} disabled={saving || loading || !tenant} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500 disabled:opacity-50">
            <Save size={16} />
            {saving ? 'Salvando...' : 'Salvar branding'}
          </button>
        </div>
      </div>
    </div>
  );
};
