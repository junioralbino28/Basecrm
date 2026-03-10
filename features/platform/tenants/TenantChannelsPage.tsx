'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Link2, RefreshCcw, Smartphone, Wifi, Activity, QrCode } from 'lucide-react';
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
  apiKey: string;
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
  apiKey: '',
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

function collectPairingCandidates(value: unknown, acc: string[] = []): string[] {
  if (!value) return acc;

  if (typeof value === 'string') {
    acc.push(value);
    return acc;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectPairingCandidates(item, acc);
    return acc;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('qr') ||
        lower.includes('base64') ||
        lower.includes('code') ||
        lower.includes('pairing')
      ) {
        collectPairingCandidates(nested, acc);
      } else if (typeof nested === 'object') {
        collectPairingCandidates(nested, acc);
      }
    }
  }

  return acc;
}

function extractPairingDisplay(metadata?: Record<string, unknown>) {
  const payload = metadata?.lastPairingPayload;
  const values = collectPairingCandidates(payload);
  const firstImageLike = values.find((value) => {
    const trimmed = value.trim();
    return (
      trimmed.startsWith('data:image') ||
      trimmed.startsWith('/9j/') ||
      trimmed.startsWith('iVBOR') ||
      trimmed.startsWith('PHN2Zy')
    );
  });

  const imageSrc = firstImageLike
    ? firstImageLike.startsWith('data:image')
      ? firstImageLike
      : firstImageLike.startsWith('PHN2Zy')
        ? `data:image/svg+xml;base64,${firstImageLike}`
        : `data:image/png;base64,${firstImageLike}`
    : null;

  const pairingCode =
    typeof metadata?.lastPairingCode === 'string' && metadata.lastPairingCode.trim()
      ? metadata.lastPairingCode.trim()
      : values.find((value) => value.trim().length > 4 && value.trim().length < 40) || null;

  return {
    imageSrc,
    pairingCode,
  };
}

export const TenantChannelsPage: React.FC = () => {
  const { tenantId, tenant, loading, error, reload } = useTenantDetail();
  const [form, setForm] = React.useState<ChannelFormState>(INITIAL_FORM);
  const [editingConnectionId, setEditingConnectionId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [checkingConnectionId, setCheckingConnectionId] = React.useState<string | null>(null);
  const [pairingConnectionId, setPairingConnectionId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageKind, setMessageKind] = React.useState<'success' | 'error'>('success');

  const onChange = <K extends keyof ChannelFormState>(key: K, value: ChannelFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  function startEditing(connection: NonNullable<typeof tenant>['channel_connections'][number]) {
    setEditingConnectionId(connection.id);
    setForm({
      name: connection.name || INITIAL_FORM.name,
      provider: 'evolution',
      channel_type: 'whatsapp',
      status: connection.status,
      apiUrl: String(connection.config?.apiUrl || ''),
      instanceName: String(connection.config?.instanceName || ''),
      webhookUrl: String(connection.config?.webhookUrl || ''),
      apiKey: '',
      phoneNumber: String(connection.metadata?.phoneNumber || ''),
      apiKeyLast4: String(connection.metadata?.apiKeyLast4 || ''),
      notes: String(connection.metadata?.notes || ''),
    });
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEditing() {
    setEditingConnectionId(null);
    setForm(INITIAL_FORM);
    setMessage(null);
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessageKind('success');
      setMessage(`${label} copiado.`);
    } catch {
      setMessageKind('error');
      setMessage(`Nao foi possivel copiar ${label.toLowerCase()}.`);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(
        editingConnectionId
          ? `/api/platform/tenants/${tenantId}/channels/${editingConnectionId}`
          : `/api/platform/tenants/${tenantId}/channels`,
        {
          method: editingConnectionId ? 'PATCH' : 'POST',
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
              apiKey: form.apiKey,
            },
            metadata: {
              phoneNumber: form.phoneNumber,
              apiKeyLast4: form.apiKeyLast4,
              notes: form.notes,
            },
          }),
        }
      );

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao salvar conexao (HTTP ${res.status})`);

      setMessageKind('success');
      setMessage(editingConnectionId ? 'Conexao atualizada na clinica.' : 'Conexao registrada na clinica.');
      setEditingConnectionId(null);
      setForm(INITIAL_FORM);
      await reload();
    } catch (submitError) {
      setMessageKind('error');
      setMessage(submitError instanceof Error ? submitError.message : 'Falha ao registrar conexao.');
    } finally {
      setSaving(false);
    }
  }

  async function runHealthcheck(connectionId: string) {
    setCheckingConnectionId(connectionId);
    setMessage(null);

    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/channels/${connectionId}/healthcheck`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
        },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha no healthcheck (HTTP ${res.status})`);

      setMessageKind('success');
      setMessage(`Healthcheck concluido: ${data?.healthcheck?.state || 'sem estado retornado'}.`);
      await reload();
    } catch (healthcheckError) {
      setMessageKind('error');
      setMessage(healthcheckError instanceof Error ? healthcheckError.message : 'Falha ao testar conexao.');
      await reload();
    } finally {
      setCheckingConnectionId(null);
    }
  }

  async function requestPairing(connectionId: string) {
    setPairingConnectionId(connectionId);
    setMessage(null);

    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/channels/${connectionId}/connect`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
        },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao gerar pareamento (HTTP ${res.status})`);

      setMessageKind('success');
      setMessage(`Pareamento solicitado${data?.pairing?.pairingCode ? `: ${data.pairing.pairingCode}` : '.'}`);
      await reload();
    } catch (pairingError) {
      setMessageKind('error');
      setMessage(pairingError instanceof Error ? pairingError.message : 'Falha ao gerar pareamento.');
      await reload();
    } finally {
      setPairingConnectionId(null);
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
            Voltar para clinica
          </Link>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">WhatsApp da clinica</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure o numero da clinica, valide a Evolution e acompanhe o pareamento em um unico lugar.
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
              Numeros e conexoes
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
                    {(() => {
                      const pairingDisplay = extractPairingDisplay(connection.metadata);

                      return (
                        <>
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

                    <div className="mt-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEditing(connection)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200"
                        >
                          Editar conexao
                        </button>

                        <button
                          type="button"
                          onClick={() => void runHealthcheck(connection.id)}
                          disabled={checkingConnectionId === connection.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200"
                        >
                          <Activity size={14} />
                          {checkingConnectionId === connection.id ? 'Testando...' : 'Testar conexao'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void requestPairing(connection.id)}
                          disabled={pairingConnectionId === connection.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200"
                        >
                          <QrCode size={14} />
                          {pairingConnectionId === connection.id ? 'Gerando...' : 'Gerar pareamento'}
                        </button>
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
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Estado retornado:</span>{' '}
                        {String(connection.metadata?.lastHealthcheckState || connection.metadata?.lastHealthcheckError || '-')}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Pareamento:</span>{' '}
                        {String(connection.metadata?.lastPairingCode || connection.metadata?.lastPairingError || '-')}
                      </div>
                      {typeof connection.metadata?.lastPairingRequestedAt === 'string' ? (
                        <div className="md:col-span-2">
                          <span className="font-medium text-slate-900 dark:text-white">Ultima solicitacao:</span>{' '}
                          {new Date(String(connection.metadata.lastPairingRequestedAt)).toLocaleString('pt-BR')}
                        </div>
                      ) : null}
                    </div>

                    {pairingDisplay.imageSrc || pairingDisplay.pairingCode ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">Pareamento visual</div>
                          {pairingDisplay.pairingCode ? (
                            <button
                              type="button"
                              onClick={() => void copyText('Codigo de pareamento', pairingDisplay.pairingCode!)}
                              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200"
                            >
                              Copiar codigo
                            </button>
                          ) : null}
                        </div>

                        <div className="mt-3 grid gap-4 md:grid-cols-[180px_1fr]">
                          <div className="flex min-h-44 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5">
                            {pairingDisplay.imageSrc ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={pairingDisplay.imageSrc}
                                alt="Pareamento Evolution"
                                className="max-h-40 max-w-full rounded-lg object-contain"
                              />
                            ) : (
                              <div className="text-center text-xs text-slate-500 dark:text-slate-400">
                                QR visual nao retornado pela Evolution.
                              </div>
                            )}
                          </div>

                          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                            <div>
                              <span className="font-medium text-slate-900 dark:text-white">Codigo:</span>{' '}
                              {pairingDisplay.pairingCode || '-'}
                            </div>
                            <div>
                              <span className="font-medium text-slate-900 dark:text-white">Orientacao:</span>{' '}
                              abra o WhatsApp do numero da clinica e use este pareamento para concluir a conexao.
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                        </>
                      );
                    })()}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Smartphone size={16} />
              {editingConnectionId ? 'Editar numero WhatsApp' : 'Conectar novo numero'}
            </div>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {editingConnectionId
                ? 'Atualize numero, instancia, URL ou chave da Evolution sem recriar o registro.'
                : 'Use esta tela para registrar a infraestrutura da clinica. O segredo completo pode continuar fora do CRM nesta fase.'}
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
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">API key da Evolution</label>
                <input
                  type="password"
                  className={FIELD_CLASS}
                  value={form.apiKey}
                  onChange={(e) => onChange('apiKey', e.target.value)}
                  placeholder={editingConnectionId ? 'Preencha apenas se quiser trocar a API key' : 'Cole a API key completa para habilitar o healthcheck'}
                />
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

              <div className="flex gap-3">
                {editingConnectionId ? (
                  <button
                    type="button"
                    onClick={cancelEditing}
                    className="inline-flex flex-1 items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:text-slate-200 dark:hover:border-white/20 dark:hover:text-white"
                  >
                    Cancelar
                  </button>
                ) : null}

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex flex-1 items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400"
                >
                  {saving ? 'Salvando...' : editingConnectionId ? 'Salvar ajustes' : 'Registrar conexao'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
