import React from 'react';
import Link from 'next/link';
import { Building2, PlusCircle } from 'lucide-react';

export const PlatformPage: React.FC = () => {
  return (
    <div className="space-y-6 p-8 max-w-6xl mx-auto">
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-teal-800 p-8 text-white shadow-xl">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              <Building2 size={14} />
              Platform Admin
            </div>
            <h1 className="text-3xl font-semibold">Operacao de implantacao</h1>
            <p className="max-w-2xl text-sm text-white/80">
              Painel interno para criar tenants, provisionar novas clinicas e acompanhar a linha de produto.
            </p>
          </div>

          <Link
            href="/platform/tenants/new"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100"
          >
            <PlusCircle size={16} />
            Nova Clinica
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/platform/tenants"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-white/10 dark:bg-slate-900"
        >
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Tenants</div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Lista de clinicas provisionadas e status do ultimo setup.
          </div>
        </Link>

        <Link
          href="/platform/tenants/new"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-white/10 dark:bg-slate-900"
        >
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Provisionar nova clinica</div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Cria a organization, edition e board inicial usando a seed invisivel com suporte da IA.
          </div>
        </Link>
      </div>
    </div>
  );
};
