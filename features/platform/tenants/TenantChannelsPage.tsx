'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Link2, RefreshCcw, Smartphone, Wifi } from 'lucide-react';
import { useTenantDetail } from './useTenantDetail';

const FIELD_CLASS =
  'w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-white/10 dark:bg-slate-950 dark:text-white';

type ChannelFormState = {
  name: string;
  provider: 'evolution';
  channel_type: 'whatsapp';
  status: 'pending' | 'connected' | 'disconnected' | 'error';
  apiUrl: string;
  instanceName: string;
  webhookUrl: string;
  phoneNumber: string;
  apiKeyLast4: string;
  notes: string;
};

const INITIAL_FORM: ChannelFormState = {
  name: 'WhatsApp principal',
  provider: 'evolution',
  channel_type: 'whatsapp',
  status: 'pending',
  apiUrl: '',
  instanceName: '',
  webhookUrl: '',
  phoneNumber: '',
  apiKeyLast4: '',
  notes: '',
};

const STATUS_LABELS: Record<ChannelFormState['status'], string> = {
  pending: 'Pendente',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Erro',
};

export const TenantChannelsPage: React.FC = () => {
  const { tenantId, tenant, loading, error, reload } = useTenantDetail();
  const [form, setForm] = React.useState<ChannelFormState>(INITIAL_FORM);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageKind, setMessageKind] = React.useState<'success' | 'error'>('success');

  const onChange = <K extends keyof ChannelFormState>(key: K, value: ChannelFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/channels`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          provider: form.provider,
          channel_type: form.channel_type,
          name: form.name,
          status: form.status,
          config: {
            apiUrl: form.apiUrl,
            instanceName: form.instanceName,
            webhookUrl: form.webhookUrl,
          },
          metadata: {
            phoneNumber: form.phoneNumber,
            apiKeyLast4: form.apiKeyLast4,
            notes: form.notes,
          },
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao salvar conexao (HTTP ${res.status})`);

      setMessageKind('success');
      setMessage('Conexao registrada no tenant.');
      setForm(INITIAL_FORM);
      await reload();
    } catch (submitError) {
      setMessageKind('error');
      setMessage(submitError instanceof Error ? submitError.message : 'Falha ao registrar conexao.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Link
            href={`/platform/tenants/${tenantId}`}
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft size={16} />
            Voltar para tenant
          </Link>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Canais e conexoes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Registry interno de conexoes WhatsApp do tenant, com foco inicial em Evolution.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
        >
          <RefreshCcw size={16} />
          Atualizar
        </button>
      </div>

      {loading ? <div className="text-sm text-slate-500 dark:text-slate-400">Carregando canais...</div> : null}
      {error ? <div className="text-sm text-rose-600 dark:text-rose-300">{error}</div> : null}

      {tenant ? (
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Wifi size={16} />
              Conexoes registradas
            </div>
            <div className="mt-4 space-y-3">
              {tenant.channel_connections.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                  Nenhuma conexao cadastrada ainda para esta clinica.
                </div>
              ) : (
                tenant.channel_connections.map((connection) => (
                  <div
                    key={connection.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{connection.name}</div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {connection.provider} • {connection.channel_type}
                        </div>
                      </div>

                      <div className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white dark:bg-cyan-500/20 dark:text-cyan-200">
                        {STATUS_LABELS[connection.status]}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-2">
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Instance:</span>{' '}
                        {String(connection.config?.instanceName || '-')}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Telefone:</span>{' '}
                        {String(connection.metadata?.phoneNumber || '-')}
                      </div>
                      <div className="md:col-span-2">
                        <span className="font-medium text-slate-900 dark:text-white">API URL:</span>{' '}
                        {String(connection.config?.apiUrl || '-')}
                      </div>
                      <div className="md:col-span-2">
                        <span className="font-medium text-slate-900 dark:text-white">Webhook:</span>{' '}
                        {String(connection.config?.webhookUrl || '-')}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Ultimo healthcheck:</span>{' '}
                        {connection.last_healthcheck_at
                          ? new Date(connection.last_healthcheck_at).toLocaleString('pt-BR')
                          : 'nao executado'}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Chave:</span>{' '}
                        {connection.metadata?.apiKeyLast4 ? `••••${String(connection.metadata.apiKeyLast4)}` : '-'}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Smartphone size={16} />
              Nova conexao WhatsApp
            </div>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Use esta tela para registrar a infraestrutura da clinica. O segredo completo pode continuar fora do CRM nesta fase.
            </p>

            <form className="mt-5 space-y-4" onSubmit={submit}>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Nome</label>
                <input className={FIELD_CLASS} value={form.name} onChange={(e) => onChange('name', e.target.value)} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Provider</label>
                  <input className={FIELD_CLASS} value="Evolution" readOnly />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Status</label>
                  <select className={FIELD_CLASS} value={form.status} onChange={(e) => onChange('status', e.target.value as ChannelFormState['status'])}>
                    <option value="pending">Pendente</option>
                    <option value="connected">Conectado</option>
                    <option value="disconnected">Desconectado</option>
                    <option value="error">Erro</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">API URL</label>
                  <input className={FIELD_CLASS} value={form.apiUrl} onChange={(e) => onChange('apiUrl', e.target.value)} placeholder="https://evolution.seudominio.com" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Instance name</label>
                  <input className={FIELD_CLASS} value={form.instanceName} onChange={(e) => onChange('instanceName', e.target.value)} placeholder="Clinica Dra Maria" />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Telefone</label>
                  <input className={FIELD_CLASS} value={form.phoneNumber} onChange={(e) => onChange('phoneNumber', e.target.value)} placeholder="+55 11 99999-9999" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Ultimos 4 da API key</label>
                  <input className={FIELD_CLASS} value={form.apiKeyLast4} onChange={(e) => onChange('apiKeyLast4', e.target.value)} placeholder="A1B2" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Webhook URL</label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input className={`${FIELD_CLASS} pl-9`} value={form.webhookUrl} onChange={(e) => onChange('webhookUrl', e.target.value)} placeholder="https://n8n.seudominio.com/webhook/..." />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Notas</label>
                <textarea
                  className={`${FIELD_CLASS} min-h-24 resize-y`}
                  value={form.notes}
                  onChange={(e) => onChange('notes', e.target.value)}
                  placeholder="Observacoes de implantacao, numero usado, responsavel, janela de troca..."
                />
              </div>

              {message ? (
                <div className={messageKind === 'success' ? 'text-sm text-emerald-600 dark:text-emerald-300' : 'text-sm text-rose-600 dark:text-rose-300'}>
                  {message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={saving}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400"
              >
                {saving ? 'Salvando...' : 'Registrar conexao'}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
