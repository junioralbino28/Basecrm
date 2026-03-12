'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Link2, RefreshCcw, Smartphone, Wifi, Activity, QrCode, PlugZap, Plug2, Send, Plus } from 'lucide-react';
import { useTenantDetail } from './useTenantDetail';
import { useAuth } from '@/context/AuthContext';
import { isAgencyAdminRole } from '@/lib/auth/scope';
import { Modal, ModalForm } from '@/components/ui/Modal';

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
  sendMode: 'auto' | 'number_text' | 'number_textMessage' | 'number_message' | 'number_body';
  phoneNumber: string;
  apiKeyLast4: string;
  notes: string;
};

type AgencyEvolutionDefaults = {
  apiUrl: string;
  hasApiKey: boolean;
  apiKeyLast4: string;
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
  sendMode: 'auto',
  phoneNumber: '',
  apiKeyLast4: '',
  notes: '',
};

function isLikelyHttpUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeHttpUrlInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

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
  const pathname = usePathname();
  const { profile } = useAuth();
  const { tenantId, tenant, access, loading, error, reload } = useTenantDetail();
  const canManageChannelConfig = access.canManageChannelConfig;
  const canAccessWhatsApp = access.canAccessWhatsApp;
  const isAgencyAdmin = isAgencyAdminRole(profile?.role);
  const isTechnicalRoute = pathname.endsWith('/channels');
  const canManageInfrastructure = canManageChannelConfig && isAgencyAdmin && isTechnicalRoute;
  const [browserOrigin, setBrowserOrigin] = React.useState('');
  const [form, setForm] = React.useState<ChannelFormState>(INITIAL_FORM);
  const [editingConnectionId, setEditingConnectionId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [checkingConnectionId, setCheckingConnectionId] = React.useState<string | null>(null);
  const [pairingConnectionId, setPairingConnectionId] = React.useState<string | null>(null);
  const [disconnectingConnectionId, setDisconnectingConnectionId] = React.useState<string | null>(null);
  const [sendingTestConnectionId, setSendingTestConnectionId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageKind, setMessageKind] = React.useState<'success' | 'warning' | 'error'>('success');
  const [testDrafts, setTestDrafts] = React.useState<Record<string, { phone: string; text: string }>>({});
  const [webhookUrlError, setWebhookUrlError] = React.useState<string | null>(null);
  const [isCreateInstanceModalOpen, setIsCreateInstanceModalOpen] = React.useState(false);
  const [agencyDefaults, setAgencyDefaults] = React.useState<AgencyEvolutionDefaults>({
    apiUrl: '',
    hasApiKey: false,
    apiKeyLast4: '',
  });
  const [agencyDefaultsDraft, setAgencyDefaultsDraft] = React.useState<{ apiUrl: string; apiKey: string }>({
    apiUrl: '',
    apiKey: '',
  });
  const [loadingAgencyDefaults, setLoadingAgencyDefaults] = React.useState(false);
  const [savingAgencyDefaults, setSavingAgencyDefaults] = React.useState(false);

  const onChange = <K extends keyof ChannelFormState>(key: K, value: ChannelFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'webhookUrl') {
      const normalized = String(value || '');
      if (!isLikelyHttpUrl(normalized)) {
        setWebhookUrlError('Informe uma URL valida (http:// ou https://).');
      } else {
        setWebhookUrlError(null);
      }
    }
  };

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      setBrowserOrigin(window.location.origin);
    }
  }, []);

  React.useEffect(() => {
    if (!canManageInfrastructure) return;

    let ignore = false;
    setLoadingAgencyDefaults(true);

    const loadAgencyDefaults = async () => {
      try {
        const res = await fetch('/api/platform/agency/evolution', {
          method: 'GET',
          credentials: 'include',
          headers: { accept: 'application/json' },
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || `Falha ao carregar credencial global (HTTP ${res.status})`);
        }

        if (ignore) return;
        const defaults = {
          apiUrl: String(data?.defaults?.apiUrl || ''),
          hasApiKey: Boolean(data?.defaults?.hasApiKey),
          apiKeyLast4: String(data?.defaults?.apiKeyLast4 || ''),
        };
        setAgencyDefaults(defaults);
        setAgencyDefaultsDraft((current) => ({
          apiUrl: defaults.apiUrl || current.apiUrl,
          apiKey: '',
        }));
      } catch (loadError) {
        if (ignore) return;
        setMessageKind('error');
        setMessage(
          loadError instanceof Error
            ? loadError.message
            : 'Falha ao carregar credencial global da Evolution.'
        );
      } finally {
        if (!ignore) setLoadingAgencyDefaults(false);
      }
    };

    void loadAgencyDefaults();

    return () => {
      ignore = true;
    };
  }, [canManageInfrastructure]);

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
      sendMode: (connection.config?.sendMode as ChannelFormState['sendMode']) || 'auto',
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

  function openCreateInstanceModal() {
    setEditingConnectionId(null);
    setForm(INITIAL_FORM);
    setMessage(null);
    setWebhookUrlError(null);
    setIsCreateInstanceModalOpen(true);
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

  function getCrmWebhookUrl(connection: NonNullable<typeof tenant>['channel_connections'][number]) {
    const secret = String(connection.config?.webhookSecret || '').trim();
    if (!browserOrigin || !secret) return null;
    return `${browserOrigin}/api/public/channels/evolution/${connection.id}/webhook?secret=${encodeURIComponent(secret)}`;
  }

  async function saveAgencyDefaults(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedApiUrl = normalizeHttpUrlInput(agencyDefaultsDraft.apiUrl);

    if (normalizedApiUrl && !isLikelyHttpUrl(normalizedApiUrl)) {
      setMessageKind('error');
      setMessage('API URL global invalida. Use uma URL iniciando com http:// ou https://');
      return;
    }

    setSavingAgencyDefaults(true);
    setMessage(null);

    try {
      const payload: Record<string, string> = {};
      payload.apiUrl = normalizedApiUrl;
      if (agencyDefaultsDraft.apiKey.trim()) {
        payload.apiKey = agencyDefaultsDraft.apiKey.trim();
      }

      const res = await fetch('/api/platform/agency/evolution', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao salvar credencial global (HTTP ${res.status})`);

      const defaults = {
        apiUrl: String(data?.defaults?.apiUrl || ''),
        hasApiKey: Boolean(data?.defaults?.hasApiKey),
        apiKeyLast4: String(data?.defaults?.apiKeyLast4 || ''),
      };
      setAgencyDefaults(defaults);
      setAgencyDefaultsDraft({
        apiUrl: defaults.apiUrl,
        apiKey: '',
      });
      setMessageKind('success');
      setMessage('Credencial global da Evolution salva no painel da agencia.');
    } catch (saveError) {
      setMessageKind('error');
      setMessage(
        saveError instanceof Error
          ? saveError.message
          : 'Falha ao salvar credencial global da Evolution.'
      );
    } finally {
      setSavingAgencyDefaults(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;
    const isEditing = Boolean(editingConnectionId);
    const normalizedApiUrl = normalizeHttpUrlInput(form.apiUrl);
    if (!isLikelyHttpUrl(normalizedApiUrl)) {
      setMessageKind('error');
      setMessage('API URL invalida. Use uma URL iniciando com http:// ou https://');
      return;
    }

    const normalizedWebhookUrl = normalizeHttpUrlInput(form.webhookUrl);
    const hasExternalWebhookInput = normalizedWebhookUrl.length > 0;
    const hasValidExternalWebhook = isLikelyHttpUrl(normalizedWebhookUrl);
    const externalWebhookWasIgnored = hasExternalWebhookInput && !hasValidExternalWebhook;

    if (hasExternalWebhookInput && !hasValidExternalWebhook) {
      // Nao bloqueia a conexao principal do WhatsApp por causa de webhook externo opcional.
      setWebhookUrlError('Webhook externo ignorado: use http:// ou https:// se quiser ativar automacoes externas.');
    } else {
      setWebhookUrlError(null);
    }

    setSaving(true);
    setMessage(null);

    const payload = {
      ...(isEditing ? {} : { provider: form.provider, channel_type: form.channel_type }),
      name: form.name,
      status: form.status,
      config: {
        apiUrl: normalizedApiUrl,
        instanceName: form.instanceName,
        webhookUrl: hasValidExternalWebhook ? normalizedWebhookUrl : '',
        apiKey: form.apiKey,
        sendMode: form.sendMode,
      },
      metadata: {
        phoneNumber: form.phoneNumber,
        apiKeyLast4: form.apiKeyLast4,
        notes: form.notes,
      },
    };

    try {
      const res = await fetch(
        isEditing
          ? `/api/platform/tenants/${tenantId}/channels/${editingConnectionId}`
          : `/api/platform/tenants/${tenantId}/channels`,
        {
          method: isEditing ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao salvar conexao (HTTP ${res.status})`);

      if (externalWebhookWasIgnored) {
        setMessageKind('warning');
        setMessage(
          `${isEditing ? 'Conexao atualizada' : 'Conexao registrada'} com sucesso. O webhook externo foi ignorado por estar invalido; a URL do webhook CRM ja esta disponivel no card da conexao.`
        );
      } else {
        setMessageKind('success');
        setMessage(isEditing ? 'Conexao atualizada na clinica.' : 'Conexao registrada na clinica.');
      }
      setEditingConnectionId(null);
      setForm(INITIAL_FORM);
      if (!isEditing) {
        setIsCreateInstanceModalOpen(false);
      }
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

  async function disconnectConnection(connectionId: string) {
    setDisconnectingConnectionId(connectionId);
    setMessage(null);

    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/channels/${connectionId}/disconnect`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
        },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao desconectar (HTTP ${res.status})`);

      setMessageKind('success');
      setMessage('Numero desconectado com sucesso.');
      await reload();
    } catch (disconnectError) {
      setMessageKind('error');
      setMessage(disconnectError instanceof Error ? disconnectError.message : 'Falha ao desconectar numero.');
      await reload();
    } finally {
      setDisconnectingConnectionId(null);
    }
  }

  function getTestDraft(connection: NonNullable<typeof tenant>['channel_connections'][number]) {
    return testDrafts[connection.id] || {
      phone: String(connection.metadata?.phoneNumber || ''),
      text: 'Teste outbound via Basecrm',
    };
  }

  function updateTestDraft(connectionId: string, field: 'phone' | 'text', value: string) {
    setTestDrafts(current => ({
      ...current,
      [connectionId]: {
        ...(current[connectionId] || { phone: '', text: 'Teste outbound via Basecrm' }),
        [field]: value,
      },
    }));
  }

  async function sendTestMessage(connectionId: string) {
    if (!tenantId) return;

    const connection = tenant?.channel_connections.find(item => item.id === connectionId);
    if (!connection) return;

    const draft = getTestDraft(connection);
    setSendingTestConnectionId(connectionId);
    setMessage(null);

    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/channels/${connectionId}/send-test`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          phone: draft.phone,
          text: draft.text,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao testar envio (HTTP ${res.status})`);

      setMessageKind('success');
      setMessage(`Teste enviado com sucesso via ${data?.send_test?.attempt || 'modo configurado'}.`);
      await reload();
    } catch (sendError) {
      setMessageKind('error');
      setMessage(sendError instanceof Error ? sendError.message : 'Falha ao testar envio.');
      await reload();
    } finally {
      setSendingTestConnectionId(null);
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
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Conexoes da clinica</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure o canal da clinica, valide a Evolution e acompanhe o pareamento em um unico lugar.
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

      {tenant && canAccessWhatsApp ? (
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
                        {canManageInfrastructure ? (
                          <button
                            type="button"
                            onClick={() => startEditing(connection)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200"
                          >
                            Editar conexao
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => void runHealthcheck(connection.id)}
                          disabled={checkingConnectionId === connection.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200"
                        >
                          <Activity size={14} />
                          {checkingConnectionId === connection.id ? 'Atualizando...' : 'Atualizar status'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void requestPairing(connection.id)}
                          disabled={pairingConnectionId === connection.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200"
                        >
                          {connection.status === 'connected' ? <PlugZap size={14} /> : <QrCode size={14} />}
                          {pairingConnectionId === connection.id
                            ? 'Gerando...'
                            : connection.status === 'connected'
                              ? 'Reconectar'
                              : 'Gerar QR code'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void sendTestMessage(connection.id)}
                          disabled={sendingTestConnectionId === connection.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-slate-950 dark:text-emerald-300 dark:hover:border-emerald-500/50 dark:hover:text-emerald-200"
                        >
                          <Send size={14} />
                          {sendingTestConnectionId === connection.id ? 'Enviando teste...' : 'Testar envio'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void disconnectConnection(connection.id)}
                          disabled={disconnectingConnectionId === connection.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-slate-950 dark:text-rose-300 dark:hover:border-rose-500/50 dark:hover:text-rose-200"
                        >
                          <Plug2 size={14} />
                          {disconnectingConnectionId === connection.id ? 'Desconectando...' : 'Desconectar'}
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
                      {canManageInfrastructure ? (<>
                        <div className="md:col-span-2">
                          <span className="font-medium text-slate-900 dark:text-white">API URL:</span>{' '}
                          {String(connection.config?.apiUrl || agencyDefaults.apiUrl || '-')}
                          {!connection.config?.apiUrl && agencyDefaults.apiUrl ? ' (global agencia)' : ''}
                        </div>
                      </>) : null}
                      {canManageInfrastructure ? (<>
                        <div className="md:col-span-2">
                          <span className="font-medium text-slate-900 dark:text-white">Webhook externo:</span>{' '}
                          {String(connection.config?.webhookUrl || '-')}
                        </div>
                      </>) : null}
                      {canManageInfrastructure ? (
                        <div className="md:col-span-2">
                          <span className="font-medium text-slate-900 dark:text-white">Webhook CRM:</span>{' '}
                          {getCrmWebhookUrl(connection) || '-'}
                        </div>
                      ) : null}
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Ultimo healthcheck:</span>{' '}
                        {connection.last_healthcheck_at
                          ? new Date(connection.last_healthcheck_at).toLocaleString('pt-BR')
                          : 'nao executado'}
                      </div>
                      {canManageInfrastructure ? (<>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Chave:</span>{' '}
                        {connection.metadata?.apiKeyLast4 ? `••••${String(connection.metadata.apiKeyLast4)}` : '-'}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Modo de envio:</span>{' '}
                        {String(connection.config?.sendMode || 'auto')}
                      </div>
                      </>) : null}
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Estado retornado:</span>{' '}
                        {String(connection.metadata?.lastHealthcheckState || connection.metadata?.lastHealthcheckError || '-')}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Pareamento:</span>{' '}
                        {String(connection.metadata?.lastPairingCode || connection.metadata?.lastPairingError || '-')}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">Ultimo inbound:</span>{' '}
                        {String(connection.metadata?.lastInboundPreview || '-')}
                      </div>
                      {typeof connection.metadata?.lastPairingRequestedAt === 'string' ? (
                        <div className="md:col-span-2">
                          <span className="font-medium text-slate-900 dark:text-white">Ultima solicitacao:</span>{' '}
                          {new Date(String(connection.metadata.lastPairingRequestedAt)).toLocaleString('pt-BR')}
                        </div>
                      ) : null}
                      {typeof connection.metadata?.lastSendTestAt === 'string' ? (
                        <div className="md:col-span-2">
                          <span className="font-medium text-slate-900 dark:text-white">Ultimo teste de envio:</span>{' '}
                          {new Date(String(connection.metadata.lastSendTestAt)).toLocaleString('pt-BR')} â€¢{' '}
                          {String(connection.metadata?.lastSendTestStatus || '-')} â€¢{' '}
                          {String(connection.metadata?.lastSendTestAttempt || '-')}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">Teste de envio</div>
                      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1.4fr_auto]">
                        <input
                          className={FIELD_CLASS}
                          value={getTestDraft(connection).phone}
                          onChange={(e) => updateTestDraft(connection.id, 'phone', e.target.value)}
                          placeholder="+55 11 99999-9999"
                        />
                        <input
                          className={FIELD_CLASS}
                          value={getTestDraft(connection).text}
                          onChange={(e) => updateTestDraft(connection.id, 'text', e.target.value)}
                          placeholder="Mensagem de teste..."
                        />
                        <button
                          type="button"
                          onClick={() => void sendTestMessage(connection.id)}
                          disabled={sendingTestConnectionId === connection.id}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Send size={15} />
                          Enviar teste
                        </button>
                      </div>
                      {connection.metadata?.lastSendTestError ? (
                        <div className="mt-3 text-xs text-rose-600 dark:text-rose-300">
                          Ultima falha: {String(connection.metadata.lastSendTestError)}
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

                    {canManageInfrastructure && getCrmWebhookUrl(connection) ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">Webhook do CRM</div>
                          <button
                            type="button"
                            onClick={() => void copyText('Webhook do CRM', getCrmWebhookUrl(connection)!)}
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200"
                          >
                            Copiar URL
                          </button>
                        </div>

                        <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                          <div className="break-all rounded-2xl bg-slate-50 px-3 py-3 font-mono text-xs dark:bg-white/5">
                            {getCrmWebhookUrl(connection)}
                          </div>
                          <div>
                            Configure esta URL na Evolution para que mensagens reais caiam em <strong className="font-semibold text-slate-900 dark:text-white">Conversations</strong>.
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
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Smartphone size={16} />
                {canManageInfrastructure
                  ? editingConnectionId
                    ? 'Editar numero WhatsApp'
                    : 'Conectar novo numero'
                  : 'Conectar WhatsApp'}
              </div>
              {canManageInfrastructure ? (
                <button
                  type="button"
                  onClick={openCreateInstanceModal}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
                >
                  <Plus size={14} />
                  Instancia +
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {canManageInfrastructure
                ? editingConnectionId
                  ? 'Atualize numero e instancia da clinica. API URL/token so sao necessarios se for sobrescrever a credencial global.'
                  : 'Use esta tela para registrar a infraestrutura da clinica. Se a credencial global da agencia estiver salva, basta instancia + numero.'
                : 'Aqui na clinica, mantenha o fluxo rapido: gerar QR code, reconectar e testar envio.'}
            </p>
            {isAgencyAdmin && !isTechnicalRoute ? (
              <Link
                href={`/platform/tenants/${tenantId}/channels`}
                className="mt-3 inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200"
              >
                Abrir configuracao tecnica no Painel Agencia
              </Link>
            ) : null}
            {canManageInfrastructure ? (
              <form onSubmit={saveAgencyDefaults} className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Credencial global Evolution (agencia)
                  </div>
                  {loadingAgencyDefaults ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">Carregando...</span>
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Token: {agencyDefaults.hasApiKey ? `••••${agencyDefaults.apiKeyLast4}` : 'nao configurado'}
                    </span>
                  )}
                </div>

                <div className="mt-3 grid gap-3">
                  <input
                    className={FIELD_CLASS}
                    value={agencyDefaultsDraft.apiUrl}
                    onChange={(e) =>
                      setAgencyDefaultsDraft((current) => ({ ...current, apiUrl: e.target.value }))
                    }
                    onBlur={(e) =>
                      setAgencyDefaultsDraft((current) => ({
                        ...current,
                        apiUrl: normalizeHttpUrlInput(e.target.value),
                      }))
                    }
                    placeholder="API URL global (ex.: https://evolution.seudominio.com)"
                    autoComplete="off"
                    inputMode="url"
                  />
                  <input
                    type="password"
                    className={FIELD_CLASS}
                    value={agencyDefaultsDraft.apiKey}
                    onChange={(e) =>
                      setAgencyDefaultsDraft((current) => ({ ...current, apiKey: e.target.value }))
                    }
                    placeholder="Token global (deixe vazio para manter o atual)"
                  />
                </div>

                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Com esta credencial salva, cada clinica precisa informar apenas instancia e numero para gerar QR code.
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingAgencyDefaults}
                    className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400"
                  >
                    {savingAgencyDefaults ? 'Salvando...' : 'Salvar credencial global'}
                  </button>
                </div>
              </form>
            ) : null}

            {canManageInfrastructure ? (
            editingConnectionId ? (
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
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">API URL (opcional)</label>
                  <input
                    className={FIELD_CLASS}
                    value={form.apiUrl}
                    onChange={(e) => onChange('apiUrl', e.target.value)}
                    onBlur={(e) => onChange('apiUrl', normalizeHttpUrlInput(e.target.value))}
                    placeholder="https://evolution.seudominio.com (usa global se vazio)"
                    autoComplete="off"
                    inputMode="url"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Instance name</label>
                  <input className={FIELD_CLASS} value={form.instanceName} onChange={(e) => onChange('instanceName', e.target.value)} placeholder="Clinica Dra Maria" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Modo preferido de envio</label>
                <select className={FIELD_CLASS} value={form.sendMode} onChange={(e) => onChange('sendMode', e.target.value as ChannelFormState['sendMode'])}>
                  <option value="auto">Auto (testa formatos comuns)</option>
                  <option value="number_text">number + text</option>
                  <option value="number_textMessage">number + textMessage.text</option>
                  <option value="number_message">number + message</option>
                  <option value="number_body">number + body</option>
                </select>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Depois de validar na interface, deixe aqui o formato que sua Evolution aceitou melhor.
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
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Webhook externo (opcional)</label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="url"
                    className={`${FIELD_CLASS} pl-9 ${webhookUrlError ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' : ''}`}
                    value={form.webhookUrl}
                    onChange={(e) => onChange('webhookUrl', e.target.value)}
                    onBlur={(e) => onChange('webhookUrl', normalizeHttpUrlInput(e.target.value))}
                    placeholder="https://n8n.seudominio.com/webhook/..."
                    autoComplete="off"
                    inputMode="url"
                  />
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Pode deixar em branco. Para Conversations, use a URL do Webhook CRM exibida no card da conexao.
                </div>
                {webhookUrlError ? (
                  <div className="mt-1 text-xs text-rose-600 dark:text-rose-300">{webhookUrlError}</div>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Token da Evolution (opcional)</label>
                <input
                  type="password"
                  className={FIELD_CLASS}
                  value={form.apiKey}
                  onChange={(e) => onChange('apiKey', e.target.value)}
                  placeholder={editingConnectionId ? 'Preencha apenas se quiser sobrescrever o token global' : 'Cole um token apenas se esta clinica usar credencial propria'}
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
                <div
                  className={
                    messageKind === 'success'
                      ? 'text-sm text-emerald-600 dark:text-emerald-300'
                      : messageKind === 'warning'
                        ? 'text-sm text-amber-600 dark:text-amber-300'
                        : 'text-sm text-rose-600 dark:text-rose-300'
                  }
                >
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
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300">
                Clique em <strong className="font-semibold text-slate-900 dark:text-white">Instancia +</strong> para cadastrar um novo numero no perfil tecnico da agencia.
              </div>
            )
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300">
                A configuração técnica (API e webhook) fica no Painel Agência. Aqui na clínica, use os botões
                operacionais para gerar QR code, reconectar e validar o número.
              </div>
            )}
          </div>
          <Modal
            isOpen={canManageInfrastructure && isCreateInstanceModalOpen}
            onClose={() => setIsCreateInstanceModalOpen(false)}
            title="Nova instancia"
            size="lg"
          >
            <ModalForm onSubmit={submit}>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Nome *
                </label>
                <input
                  className={FIELD_CLASS}
                  value={form.name}
                  onChange={(e) => onChange('name', e.target.value)}
                  placeholder="WhatsApp principal"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Canal
                </label>
                <input className={FIELD_CLASS} value="Evolution" readOnly />
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Modo assistido: com credencial global da agencia, preencha apenas instancia e numero.
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    API URL (opcional)
                  </label>
                  <input
                    className={FIELD_CLASS}
                    value={form.apiUrl}
                    onChange={(e) => onChange('apiUrl', e.target.value)}
                    onBlur={(e) => onChange('apiUrl', normalizeHttpUrlInput(e.target.value))}
                    placeholder="https://evolution.seudominio.com (usa global se vazio)"
                    autoComplete="off"
                    inputMode="url"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Instance name *
                  </label>
                  <input
                    className={FIELD_CLASS}
                    value={form.instanceName}
                    onChange={(e) => onChange('instanceName', e.target.value)}
                    placeholder="Clinica-Dra-Jessica"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Token (opcional)
                  </label>
                  <input
                    type="password"
                    className={FIELD_CLASS}
                    value={form.apiKey}
                    onChange={(e) => onChange('apiKey', e.target.value)}
                    placeholder="Cole apenas se quiser sobrescrever o token global"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Numero
                  </label>
                  <input
                    className={FIELD_CLASS}
                    value={form.phoneNumber}
                    onChange={(e) => onChange('phoneNumber', e.target.value)}
                    placeholder="+55 11 99999-9999"
                  />
                </div>
              </div>

              {message ? (
                <div
                  className={
                    messageKind === 'success'
                      ? 'text-sm text-emerald-600 dark:text-emerald-300'
                      : messageKind === 'warning'
                        ? 'text-sm text-amber-600 dark:text-amber-300'
                        : 'text-sm text-rose-600 dark:text-rose-300'
                  }
                >
                  {message}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateInstanceModalOpen(false)}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:text-slate-200 dark:hover:border-white/20 dark:hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </ModalForm>
          </Modal>
        </div>
      ) : tenant ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-6 py-5 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          Seu usuario ainda nao tem permissao para operar o modulo de WhatsApp desta clinica.
        </div>
      ) : null}
    </div>
  );
};
