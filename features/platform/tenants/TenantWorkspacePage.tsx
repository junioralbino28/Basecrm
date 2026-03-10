import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Globe, Palette, MessageCircle, MessagesSquare, Sparkles } from 'lucide-react';
import { useTenantDetail } from './useTenantDetail';

export const TenantWorkspacePage: React.FC = () => {
  const { tenant, loading, error } = useTenantDetail();

  return (
    <div className="space-y-6 p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/platform/tenants"
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft size={16} />
            Voltar para clinicas
          </Link>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
            {tenant?.branding_config?.displayName || tenant?.name || 'Clinica'}
          </h1>
        </div>

        {tenant ? (
          <div className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-white/10 dark:text-slate-300">
            {tenant.edition_key || 'sem edition'}
          </div>
        ) : null}
      </div>

      {loading ? <div className="text-sm text-slate-500 dark:text-slate-400">Carregando clinica...</div> : null}
      {error ? <div className="text-sm text-rose-600 dark:text-rose-300">{error}</div> : null}

      {tenant ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Link
              href={`/platform/tenants/${tenant.id}/branding`}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Palette size={16} />
                Branding
              </div>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Editar nome exibido, cor principal e tema.
              </div>
            </Link>

            <Link
              href={`/platform/tenants/${tenant.id}/domains`}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Globe size={16} />
                Dominios
              </div>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Gerenciar subdominio e hosts da clinica.
              </div>
            </Link>

            <Link
              href={`/platform/tenants/${tenant.id}/whatsapp`}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <MessageCircle size={16} />
                WhatsApp
              </div>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Conectar numero, validar Evolution e operar o pareamento da clinica.
              </div>
            </Link>

            <Link
              href={`/platform/tenants/${tenant.id}/conversations`}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <MessagesSquare size={16} />
                Conversations
              </div>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Registrar threads, mensagens e handoff operacional da clinica.
              </div>
            </Link>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Sparkles size={16} />
                Provisionamento
              </div>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Ultimo status: {tenant.provisioning_runs?.[0]?.status || 'sem runs'}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Metadados da clinica</div>
              <div className="mt-4 grid gap-3 text-sm text-slate-600 dark:text-slate-300">
                <div>
                  <span className="font-medium text-slate-900 dark:text-white">Especialidade:</span>{' '}
                  {String(tenant.metadata?.specialty || '-')}
                </div>
                <div>
                  <span className="font-medium text-slate-900 dark:text-white">Canal principal:</span>{' '}
                  {String(tenant.metadata?.leadChannel || '-')}
                </div>
                <div>
                  <span className="font-medium text-slate-900 dark:text-white">Modelo de atendimento:</span>{' '}
                  {String(tenant.metadata?.serviceModel || '-')}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Hosts cadastrados</div>
                <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  {tenant.domains.length === 0 ? (
                    <div>Nenhum dominio cadastrado.</div>
                  ) : (
                    tenant.domains.map((domain) => (
                      <div key={domain.id} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/5">
                        <div className="font-medium text-slate-900 dark:text-white">{domain.host}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {domain.is_primary ? 'primario' : 'secundario'} • {domain.status}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">WhatsApp conectado</div>
                <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  {tenant.channel_connections.length === 0 ? (
                    <div>Nenhuma conexao ainda.</div>
                  ) : (
                    tenant.channel_connections.slice(0, 3).map((connection) => (
                      <div key={connection.id} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/5">
                        <div className="font-medium text-slate-900 dark:text-white">{connection.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {connection.provider} • {connection.status}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
