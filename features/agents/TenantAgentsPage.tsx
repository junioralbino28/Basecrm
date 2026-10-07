'use client';

import React from 'react';
import Link from 'next/link';
import { Bot, Loader2, RefreshCcw } from 'lucide-react';
import { AccessDenied } from '@/components/AccessDenied';
import { PageLoader } from '@/components/PageLoader';
import { useAuth } from '@/context/AuthContext';
import { isAgencyAdminRole } from '@/lib/auth/scope';
import type { AgenteNaLista } from '@/lib/agents/tiposDoEditor';
import { agentesApi } from './agentesApi';
import { descreverVersao } from './formatos';

/** Central de Agentes: os agentes de um cliente. Só agency_admin e o legado admin (a API também recusa os outros). */
export function TenantAgentsPage({ tenantId }: { tenantId: string }) {
  const { profile, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAgencyAdminRole(profile?.role)) {
    return <AccessDenied message="A Central de Agentes é da agência. Fale com quem administra a sua conta." />;
  }
  return <ListaDeAgentes tenantId={tenantId} />;
}

type Estado = { carregando: boolean; erro: string | null; cliente: string | null; agentes: AgenteNaLista[] };

function ListaDeAgentes({ tenantId }: { tenantId: string }) {
  const [estado, setEstado] = React.useState<Estado>({ carregando: true, erro: null, cliente: null, agentes: [] });

  const carregar = React.useCallback(async () => {
    setEstado((atual) => ({ ...atual, carregando: true, erro: null }));
    try {
      const r = await agentesApi.listar(tenantId);
      setEstado({ carregando: false, erro: null, cliente: r.cliente.nome, agentes: r.agentes });
    } catch (erro) {
      setEstado({ carregando: false, erro: erro instanceof Error ? erro.message : 'Falha ao carregar os agentes.', cliente: null, agentes: [] });
    }
  }, [tenantId]);

  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Central de Agentes{estado.cliente ? ` · ${estado.cliente}` : ''}
          </p>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Agentes do cliente</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Cada agente responde pelos números ligados a ele. Edite, publique e volte versões sem publicar código.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void carregar()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-brand-400 dark:border-white/10 dark:bg-card dark:text-slate-200"
        >
          <RefreshCcw size={16} aria-hidden="true" />
          Atualizar
        </button>
      </header>

      {estado.carregando ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 size={20} className="animate-spin text-slate-500" aria-label="Carregando" />
        </div>
      ) : estado.erro ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {estado.erro}
        </div>
      ) : estado.agentes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-600 dark:border-white/15 dark:text-slate-300">
          Nenhum agente neste cliente ainda. Por enquanto, os agentes chegam pela migração do prompt de hoje; criar pela biblioteca vem na fase 2.
        </div>
      ) : (
        <ul className="space-y-3">
          {estado.agentes.map((agente) => (
            <li key={agente.id}>
              <Link
                href={`/platform/tenants/${tenantId}/agents/${agente.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-400 hover:shadow-md dark:border-white/10 dark:bg-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                    <Bot size={18} aria-hidden="true" />
                    {agente.nome}
                  </span>
                  {agente.rascunhoPendente ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                      Rascunho com mudanças
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {agente.publicada ? descreverVersao(agente.publicada) : 'Sem versão publicada'}
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {agente.numeros.length === 0 ? 'Nenhum número ligado' : `Números: ${agente.numeros.map((n) => n.nome).join(', ')}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
