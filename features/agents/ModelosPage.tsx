'use client';

import React from 'react';
import Link from 'next/link';
import { Library, Loader2, Plus, RefreshCcw } from 'lucide-react';
import { AccessDenied } from '@/components/AccessDenied';
import { PageLoader } from '@/components/PageLoader';
import { useAuth } from '@/context/AuthContext';
import { isAgencyAdminRole } from '@/lib/auth/scope';
import type { ModeloNaLista } from '@/lib/agents/tiposDoEditor';
import { agentesApi } from './agentesApi';
import { formatarDataHora } from './formatos';

/** Central de Agentes, bloco 2: a biblioteca de modelos da agência. Só agency_admin e o legado admin (a API também recusa). */
export function ModelosPage() {
  const { profile, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAgencyAdminRole(profile?.role)) {
    return <AccessDenied message="Os modelos de agente são da agência. Fale com quem administra a sua conta." />;
  }
  return <ListaDeModelos />;
}

type Estado = { carregando: boolean; erro: string | null; modelos: ModeloNaLista[] };

function ListaDeModelos() {
  const [arquivados, setArquivados] = React.useState(false);
  const [estado, setEstado] = React.useState<Estado>({ carregando: true, erro: null, modelos: [] });

  const carregar = React.useCallback(async () => {
    setEstado((atual) => ({ ...atual, carregando: true, erro: null }));
    try {
      const r = await agentesApi.modelos.listar(arquivados);
      setEstado({ carregando: false, erro: null, modelos: r.modelos });
    } catch (erro) {
      setEstado({ carregando: false, erro: erro instanceof Error ? erro.message : 'Falha ao carregar os modelos.', modelos: [] });
    }
  }, [arquivados]);

  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Central de Agentes</p>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Modelos de agente</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Textos prontos com lacunas entre colchetes, como [Nome da empresa]. Ao criar um agente a partir de um modelo, você responde
            cada lacuna. Mudar um modelo não mexe nos agentes que já nasceram dele.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void carregar()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-brand-400 dark:border-white/10 dark:bg-card dark:text-slate-200"
          >
            <RefreshCcw size={16} aria-hidden="true" />
            Atualizar
          </button>
          <Link
            href="/platform/agent-templates/novo"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-500"
          >
            <Plus size={16} aria-hidden="true" />
            Novo modelo
          </Link>
        </div>
      </header>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={arquivados} onChange={(e) => setArquivados(e.target.checked)} />
        Mostrar arquivados
      </label>

      {estado.carregando ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 size={20} className="animate-spin text-slate-500" aria-label="Carregando" />
        </div>
      ) : estado.erro ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {estado.erro}
        </div>
      ) : estado.modelos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-600 dark:border-white/15 dark:text-slate-300">
          Nenhum modelo ainda. Crie um em branco com Novo modelo, ou abra um agente publicado e use Salvar como modelo.
        </div>
      ) : (
        <ul className="space-y-3">
          {estado.modelos.map((m) => (
            <li key={m.id}>
              <Link
                href={`/platform/agent-templates/${m.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-400 hover:shadow-md dark:border-white/10 dark:bg-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                    <Library size={18} aria-hidden="true" />
                    {m.nome}
                  </span>
                  {m.arquivado ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200">
                      Arquivado
                    </span>
                  ) : null}
                </div>
                {m.descricao ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{m.descricao}</p> : null}
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {m.lacunas.length === 0 ? 'Sem lacunas' : `Lacunas: ${m.lacunas.join(', ')}`} ·{' '}
                  {m.agentesCriados === 1 ? 'usado em 1 agente' : `usado em ${m.agentesCriados} agentes`} · atualizado em{' '}
                  {formatarDataHora(m.atualizadoEm)}
                  {m.atualizadoPor ? ` por ${m.atualizadoPor}` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
