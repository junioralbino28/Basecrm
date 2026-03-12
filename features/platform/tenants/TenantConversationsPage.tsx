'use client';

import React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCheck,
  Clock3,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Phone,
  QrCode,
  RefreshCcw,
  Send,
  UserRound,
} from 'lucide-react';
import { useTenantDetail } from './useTenantDetail';
import { useAuth } from '@/context/AuthContext';
import { queryKeys } from '@/lib/query';
import { Modal } from '@/components/ui/Modal';
import type {
  ConversationMessage,
  ConversationMessageMetadata,
  ConversationMessageDirection,
  ConversationThreadAssignee,
  ConversationThreadListItem,
  ConversationsInboxSummary,
} from '@/lib/conversations/types';

type InboxResponse = {
  threads: ConversationThreadListItem[];
  assignees: ConversationThreadAssignee[];
  summary: ConversationsInboxSummary;
};

type MessagesResponse = {
  messages: ConversationMessage[];
};

type InboxFilter = 'all' | 'ai_active' | 'human_queue' | 'human_active' | 'resolved' | 'closed';

const FIELD_CLASS =
  'w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-white/10 dark:bg-slate-950 dark:text-white';

function buildDisplayName(profile: {
  nickname?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null | undefined) {
  if (!profile) return '';
  const nickname = profile.nickname?.trim();
  if (nickname) return nickname;
  const fullName = [profile.first_name?.trim(), profile.last_name?.trim()].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  const firstName = profile.first_name?.trim();
  if (firstName) return firstName;
  return profile.email?.split('@')[0] || '';
}

function formatDateTime(value: string | null) {
  if (!value) return 'Sem horario';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatRelative(value: string | null) {
  if (!value) return 'Sem atividade';

  const diffMs = new Date(value).getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

function statusTone(status: ConversationThreadListItem['status']) {
  if (status === 'ai_active') return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300';
  if (status === 'human_queue') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
  if (status === 'human_active') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
  if (status === 'resolved') return 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300';
  return 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-300';
}

function statusLabel(status: ConversationThreadListItem['status']) {
  if (status === 'ai_active') return 'IA ativa';
  if (status === 'human_queue') return 'Fila humana';
  if (status === 'human_active') return 'Humano atendendo';
  if (status === 'resolved') return 'Resolvido';
  return 'Fechada';
}

function routingLabel(thread: ConversationThreadListItem) {
  if (thread.status === 'human_active' && thread.assignee?.display_name) {
    return `Em atendimento humano por ${thread.assignee.display_name}`;
  }
  if (thread.status === 'human_queue') return 'Aguardando proximo atendente';
  if (thread.status === 'resolved') return 'Resolvida e liberada para IA no proximo contato';
  if (thread.status === 'closed') return 'Fechada manualmente';
  return 'IA pode responder';
}

function directionTone(direction: ConversationMessageDirection) {
  if (direction === 'outbound') {
    return 'ml-10 bg-[#d9fdd3] text-slate-900 shadow-sm dark:bg-emerald-500/15 dark:text-slate-100';
  }
  if (direction === 'internal') {
    return 'mx-6 border border-amber-200 bg-amber-50/90 text-slate-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-slate-100';
  }
  return 'mr-10 bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100';
}

function recalculateSummary(threads: ConversationThreadListItem[]): ConversationsInboxSummary {
  return threads.reduce<ConversationsInboxSummary>(
    (acc, thread) => {
      acc.total += 1;
      acc[thread.status] += 1;
      if (thread.unread_count > 0) acc.unread += 1;
      if (!thread.assigned_user_id) acc.unassigned += 1;
      if (thread.needs_attention) acc.needs_attention += 1;
      return acc;
    },
    {
      total: 0,
      ai_active: 0,
      human_queue: 0,
      human_active: 0,
      resolved: 0,
      closed: 0,
      unread: 0,
      unassigned: 0,
      needs_attention: 0,
    }
  );
}

function getThreadAvatar(thread: ConversationThreadListItem) {
  const base = (thread.contact_name || thread.title || '?').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function getMessageMeta(message: ConversationMessage): ConversationMessageMetadata {
  return (message.metadata || {}) as ConversationMessageMetadata;
}

function getDeliveryBadge(meta: ConversationMessageMetadata, direction: ConversationMessageDirection) {
  if (direction !== 'outbound') return null;
  if (meta.delivery_status === 'sent') {
    return {
      label: 'Enviada',
      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    };
  }
  if (meta.delivery_status === 'failed') {
    return {
      label: 'Falhou',
      className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    };
  }
  return {
    label: 'Registrada',
    className: 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-300',
  };
}

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

export const TenantConversationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { tenantId, tenant, access, reload } = useTenantDetail();
  const { profile } = useAuth();
  const canReply = access.canReplyConversations;
  const canAccessWhatsApp = access.canAccessWhatsApp;

  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<InboxFilter>('all');
  const [onlyUnread, setOnlyUnread] = React.useState(false);
  const [onlyUnassigned, setOnlyUnassigned] = React.useState(false);
  const [composer, setComposer] = React.useState({
    direction: 'outbound' as 'outbound' | 'internal',
    author_name: buildDisplayName(profile),
    content: '',
  });
  const [composerFeedback, setComposerFeedback] = React.useState<{
    kind: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = React.useState(false);
  const [activeConnectionId, setActiveConnectionId] = React.useState<string | null>(null);
  const [pairingConnectionId, setPairingConnectionId] = React.useState<string | null>(null);
  const [healthcheckConnectionId, setHealthcheckConnectionId] = React.useState<string | null>(null);
  const [whatsAppFeedback, setWhatsAppFeedback] = React.useState<{
    kind: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  React.useEffect(() => {
    setComposer(current => ({
      ...current,
      author_name: current.author_name || buildDisplayName(profile),
    }));
  }, [profile]);

  const inboxQuery = useQuery<InboxResponse>({
    queryKey: queryKeys.conversations.list({ tenantId }),
    queryFn: async () => {
      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao carregar conversas (HTTP ${res.status})`);
      return data as InboxResponse;
    },
    enabled: Boolean(tenantId),
    refetchInterval: 3000,
  });

  const selectedThread = React.useMemo(
    () => inboxQuery.data?.threads.find(thread => thread.id === selectedThreadId) || null,
    [inboxQuery.data?.threads, selectedThreadId]
  );

  React.useEffect(() => {
    if (!inboxQuery.data?.threads?.length) {
      setSelectedThreadId(null);
      return;
    }

    if (!selectedThreadId || !inboxQuery.data.threads.some(thread => thread.id === selectedThreadId)) {
      setSelectedThreadId(inboxQuery.data.threads[0].id);
    }
  }, [inboxQuery.data?.threads, selectedThreadId]);

  const messagesQuery = useQuery<MessagesResponse>({
    queryKey: queryKeys.conversations.messages(selectedThreadId || ''),
    queryFn: async () => {
      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations/${selectedThreadId}/messages`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao carregar mensagens (HTTP ${res.status})`);
      return data as MessagesResponse;
    },
    enabled: Boolean(tenantId && selectedThreadId),
    refetchInterval: selectedThreadId ? 3000 : false,
  });

  const updateInboxThread = React.useCallback((thread: ConversationThreadListItem) => {
    queryClient.setQueryData<InboxResponse | undefined>(
      queryKeys.conversations.list({ tenantId }),
      current => {
        if (!current) return current;

        const alreadyExists = current.threads.some(item => item.id === thread.id);
        const threads = alreadyExists
          ? current.threads.map(item => (item.id === thread.id ? thread : item))
          : [thread, ...current.threads];

        threads.sort((a, b) => {
          const aTime = new Date(a.last_message_sent_at || a.updated_at).getTime();
          const bTime = new Date(b.last_message_sent_at || b.updated_at).getTime();
          return bTime - aTime;
        });

        return {
          ...current,
          threads,
          summary: recalculateSummary(threads),
        };
      }
    );
  }, [queryClient, tenantId]);

  const updateThreadMutation = useMutation({
    mutationFn: async (payload: {
      threadId: string;
      body: {
        status?: ConversationThreadListItem['status'];
        assigned_user_id?: string | null;
        assign_next_human?: boolean;
        handoff_reason?: string | null;
        mark_as_read?: boolean;
      };
    }) => {
      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations/${payload.threadId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload.body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao atualizar conversa (HTTP ${res.status})`);
      return data as { ok: true; thread: ConversationThreadListItem };
    },
    onSuccess: data => {
      updateInboxThread(data.thread);
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations/${selectedThreadId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          ...composer,
          send_external: composer.direction === 'outbound',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao registrar mensagem (HTTP ${res.status})`);
      return data as { ok: true; message: ConversationMessage; thread: ConversationThreadListItem; warning?: string | null };
    },
    onSuccess: data => {
      queryClient.setQueryData<MessagesResponse | undefined>(
        queryKeys.conversations.messages(data.thread.id),
        current => ({
          messages: [...(current?.messages || []), data.message],
        })
      );
      updateInboxThread(data.thread);
      setComposer(current => ({
        ...current,
        content: '',
      }));
      setComposerFeedback(
        data.warning
          ? { kind: 'warning', text: `Mensagem registrada, mas o envio pela Evolution falhou: ${data.warning}` }
          : {
              kind: 'success',
              text: composer.direction === 'outbound'
                ? 'Mensagem enviada e registrada na conversa humana.'
                : 'Nota interna registrada.',
            }
      );
    },
    onError: error => {
      setComposerFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha ao registrar mensagem.',
      });
    },
  });

  const threads = inboxQuery.data?.threads || [];
  const assignees = inboxQuery.data?.assignees || [];

  const filteredThreads = React.useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return threads.filter(thread => {
      if (filter !== 'all' && thread.status !== filter) return false;
      if (onlyUnread && thread.unread_count === 0) return false;
      if (onlyUnassigned && thread.assigned_user_id) return false;

      if (!normalizedSearch) return true;

      const haystack = [
        thread.title,
        thread.contact_name,
        thread.contact_phone,
        thread.last_message_preview,
        thread.assignee?.display_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [filter, onlyUnread, onlyUnassigned, search, threads]);

  const channelConnections = tenant?.channel_connections || [];
  const activeConnection = React.useMemo(
    () => channelConnections.find(connection => connection.id === activeConnectionId) || channelConnections[0] || null,
    [channelConnections, activeConnectionId]
  );
  const activePairing = React.useMemo(
    () => extractPairingDisplay((activeConnection?.metadata || {}) as Record<string, unknown>),
    [activeConnection?.metadata]
  );

  React.useEffect(() => {
    if (!channelConnections.length) {
      setActiveConnectionId(null);
      return;
    }
    if (!activeConnectionId || !channelConnections.some(connection => connection.id === activeConnectionId)) {
      setActiveConnectionId(channelConnections[0].id);
    }
  }, [activeConnectionId, channelConnections]);

  async function runConnectionHealthcheck(connectionId: string) {
    setHealthcheckConnectionId(connectionId);
    setWhatsAppFeedback(null);
    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/channels/${connectionId}/healthcheck`, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao atualizar status (HTTP ${res.status})`);
      const webhookWarning = typeof data?.webhook?.warning === 'string' ? data.webhook.warning : null;
      setWhatsAppFeedback({
        kind: webhookWarning ? 'warning' : 'success',
        text: webhookWarning
          ? `Status atualizado: ${data?.healthcheck?.state || 'sem estado retornado'}. ${webhookWarning}`
          : `Status atualizado: ${data?.healthcheck?.state || 'sem estado retornado'}.`,
      });
      await reload();
    } catch (error) {
      setWhatsAppFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha ao atualizar status.',
      });
      await reload();
    } finally {
      setHealthcheckConnectionId(null);
    }
  }

  async function requestConnectionPairing(connectionId: string) {
    setPairingConnectionId(connectionId);
    setWhatsAppFeedback(null);
    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/channels/${connectionId}/connect`, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao gerar QR code (HTTP ${res.status})`);
      const webhookWarning = typeof data?.webhook?.warning === 'string' ? data.webhook.warning : null;
      setWhatsAppFeedback({
        kind: webhookWarning ? 'warning' : 'success',
        text: (() => {
          const base = data?.pairing?.pairingCode
            ? `QR code atualizado. Codigo de pareamento: ${data.pairing.pairingCode}.`
            : 'QR code solicitado com sucesso.';
          return webhookWarning ? `${base} ${webhookWarning}` : base;
        })(),
      });
      await reload();
    } catch (error) {
      setWhatsAppFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha ao gerar QR code.',
      });
      await reload();
    } finally {
      setPairingConnectionId(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 p-6">
      <div className="flex justify-end">
        {canAccessWhatsApp ? (
          <button
            type="button"
            onClick={() => {
              setWhatsAppFeedback(null);
              setIsWhatsAppModalOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-700 transition hover:border-emerald-300 hover:text-emerald-800 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-emerald-300"
          >
            <QrCode size={16} />
            Conectar WhatsApp
          </button>
        ) : null}
      </div>

      {inboxQuery.error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          {inboxQuery.error.message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-[2rem] border border-slate-800/80 bg-[#111b21] shadow-sm dark:border-white/10 dark:bg-[#111b21]">
          <div className="border-b border-slate-700 p-4 dark:border-white/10">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <MessagesSquare size={16} />
              Conversas
            </div>

            <div className="mt-3 space-y-3">
              <input
                className="w-full rounded-2xl border border-slate-700 bg-[#202c33] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Pesquisar ou comecar nova conversa..."
              />

              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'all', label: 'Todas' },
                  { id: 'ai_active', label: 'IA ativa' },
                  { id: 'human_queue', label: 'Fila humana' },
                  { id: 'human_active', label: 'Humano' },
                  { id: 'resolved', label: 'Resolvidas' },
                  { id: 'closed', label: 'Fechadas' },
                ].map(option => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFilter(option.id as InboxFilter)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      filter === option.id
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-[#202c33] text-slate-300 hover:bg-[#2a3942]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setOnlyUnread(current => !current)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    onlyUnread
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                      : 'bg-[#202c33] text-slate-300 hover:bg-[#2a3942]'
                  }`}
                >
                  So nao lidas
                </button>
                <button
                  type="button"
                  onClick={() => setOnlyUnassigned(current => !current)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    onlyUnassigned
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                      : 'bg-[#202c33] text-slate-300 hover:bg-[#2a3942]'
                  }`}
                >
                  So sem dono
                </button>
              </div>
            </div>

          </div>

          <div className="max-h-[76vh] space-y-1 overflow-y-auto bg-[#111b21] p-2 dark:bg-slate-950/40">
              {inboxQuery.isLoading ? (
                <div className="flex items-center gap-2 rounded-2xl px-3 py-4 text-sm text-slate-300 dark:text-slate-400">
                  <Loader2 size={16} className="animate-spin" />
                  Carregando inbox...
                </div>
              ) : filteredThreads.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-sm text-slate-300 dark:border-white/10 dark:text-slate-400">
                  Nenhuma conversa combina com os filtros atuais.
                </div>
              ) : (
                filteredThreads.map(thread => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => setSelectedThreadId(thread.id)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      selectedThreadId === thread.id
                        ? 'border-cyan-400 bg-[#202c33] shadow-md dark:border-cyan-500/50 dark:bg-slate-900'
                        : 'border-transparent bg-[#111b21] hover:bg-[#202c33]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-emerald-400 to-cyan-500 text-sm font-semibold text-white">
                        {getThreadAvatar(thread)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="truncate text-sm font-semibold text-white dark:text-white">
                            {thread.contact_name || thread.title}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-[11px] text-slate-400 dark:text-slate-400">
                              {formatRelative(thread.last_message_sent_at || thread.updated_at)}
                            </span>
                            {thread.unread_count > 0 ? (
                              <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white">
                                {thread.unread_count}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusTone(thread.status)}`}>
                            {statusLabel(thread.status)}
                          </span>
                          {thread.assignee?.display_name ? (
                            <span className="truncate text-[11px] text-slate-400 dark:text-slate-400">
                              {thread.assignee.display_name}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 line-clamp-1 text-xs text-slate-300 dark:text-slate-400">
                          {thread.last_message_preview || 'Sem mensagem ainda'}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">
                          {thread.contact_phone || 'Sem telefone'}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
          </div>
        </section>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
          {!selectedThread ? (
            <div className="flex min-h-[620px] flex-col items-center justify-center px-6 text-center">
              <MessageCircle size={32} className="text-slate-300 dark:text-slate-600" />
              <div className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
                Selecione uma conversa
              </div>
              <div className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
                Escolha uma thread na fila ao lado para triagem, atribuicao e registro operacional da conversa.
              </div>
            </div>
          ) : (
            <div className="flex min-h-[620px] flex-col">
              <div className="border-b border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-white/10 dark:bg-slate-900/90">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-emerald-400 to-cyan-500 text-sm font-semibold text-white">
                      {getThreadAvatar(selectedThread)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-white">
                          {selectedThread.contact_name || selectedThread.title}
                        </h2>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusTone(selectedThread.status)}`}>
                          {statusLabel(selectedThread.status)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {selectedThread.contact_phone || 'Sem telefone'} • {formatRelative(selectedThread.last_message_sent_at || selectedThread.updated_at)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void messagesQuery.refetch()}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:text-slate-200"
                    >
                      <RefreshCcw size={14} />
                      Atualizar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateThreadMutation.mutate({
                          threadId: selectedThread.id,
                          body: { mark_as_read: true },
                        })
                      }
                      disabled={selectedThread.unread_count === 0 || updateThreadMutation.isPending}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:text-slate-200"
                    >
                      <CheckCheck size={14} />
                      Marcar lida
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/5">
                    <label className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      <UserRound size={12} />
                      Responsavel
                    </label>
                    <select
                      className={FIELD_CLASS}
                      value={selectedThread.assigned_user_id || ''}
                      onChange={event =>
                        updateThreadMutation.mutate({
                          threadId: selectedThread.id,
                          body: {
                            assigned_user_id: event.target.value || null,
                          },
                        })
                      }
                      disabled={updateThreadMutation.isPending}
                    >
                      <option value="">Sem responsavel</option>
                      {assignees.map(assignee => (
                        <option key={assignee.id} value={assignee.id}>
                          {assignee.display_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/5">
                    <label className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      <AlertCircle size={12} />
                      Status
                    </label>
                    <select
                      className={FIELD_CLASS}
                      value={selectedThread.status}
                      onChange={event =>
                        updateThreadMutation.mutate({
                          threadId: selectedThread.id,
                          body: {
                            status: event.target.value as ConversationThreadListItem['status'],
                          },
                        })
                      }
                      disabled={updateThreadMutation.isPending}
                    >
                      <option value="ai_active">IA ativa</option>
                      <option value="human_queue">Fila humana</option>
                      <option value="human_active">Humano atendendo</option>
                      <option value="resolved">Resolvido</option>
                      <option value="closed">Fechado</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {routingLabel(selectedThread)}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateThreadMutation.mutate({
                        threadId: selectedThread.id,
                        body: {
                          status: 'human_queue',
                          assign_next_human: true,
                          handoff_reason: 'falar_com_humano',
                        },
                      })
                    }
                    disabled={updateThreadMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 px-4 py-2 text-sm font-medium text-amber-700 transition hover:border-amber-300 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-500/20 dark:text-amber-300"
                  >
                    <AlertCircle size={16} />
                    Falar com humano
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateThreadMutation.mutate({
                        threadId: selectedThread.id,
                        body: {
                          status: 'resolved',
                          mark_as_read: true,
                        },
                      })
                    }
                    disabled={updateThreadMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-2xl border border-violet-200 px-4 py-2 text-sm font-medium text-violet-700 transition hover:border-violet-300 hover:text-violet-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-500/20 dark:text-violet-300"
                  >
                    <CheckCheck size={16} />
                    Marcar como resolvido
                  </button>
                </div>

                {updateThreadMutation.error ? (
                  <div className="mt-3 text-sm text-rose-600 dark:text-rose-300">
                    {updateThreadMutation.error.message}
                  </div>
                ) : null}
              </div>

              <div className="flex-1 overflow-y-auto bg-[#efeae2] px-4 py-5 dark:bg-[linear-gradient(180deg,_rgba(15,23,42,1)_0%,_rgba(2,6,23,1)_100%)]">
                <div className="mx-auto flex max-w-5xl flex-col gap-3">
                {messagesQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <Loader2 size={16} className="animate-spin" />
                    Carregando mensagens...
                  </div>
                ) : messagesQuery.error ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                    {messagesQuery.error.message}
                  </div>
                ) : (messagesQuery.data?.messages || []).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                    Nenhuma mensagem registrada ainda nesta conversa.
                  </div>
                ) : (
                  (messagesQuery.data?.messages || []).map(message => (
                    (() => {
                      const meta = getMessageMeta(message);
                      const badge = getDeliveryBadge(meta, message.direction);

                      return (
                        <div
                          key={message.id}
                          className={`max-w-[85%] rounded-[1.5rem] px-4 py-3 text-sm ${directionTone(message.direction)} ${
                            message.direction === 'outbound'
                              ? 'self-end rounded-br-md'
                              : message.direction === 'internal'
                                ? 'self-center'
                                : 'self-start rounded-bl-md'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{message.author_name || message.direction}</span>
                              {badge ? (
                                <span className={`rounded-full px-2 py-0.5 font-semibold ${badge.className}`}>
                                  {badge.label}
                                </span>
                              ) : null}
                              {meta.delivery_provider ? (
                                <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                  {meta.delivery_provider}
                                </span>
                              ) : null}
                            </div>
                            <span>{formatDateTime(message.sent_at)}</span>
                          </div>
                          <div className="mt-2 whitespace-pre-wrap">{message.content}</div>
                          {meta.delivery_error ? (
                            <div className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                              Falha no envio: {meta.delivery_error}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()
                  ))
                )}
                </div>
              </div>

              <form
                className="border-t border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-white/10 dark:bg-slate-900/90"
                onSubmit={event => {
                  event.preventDefault();
                  setComposerFeedback(null);
                  sendMessageMutation.mutate();
                }}
              >
                <div className="grid gap-3 xl:grid-cols-[180px_180px_minmax(0,1fr)_auto]">
                  <div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Tipo de envio</label>
                      <select
                        className={FIELD_CLASS}
                        value={composer.direction}
                        onChange={event =>
                          setComposer(current => ({
                            ...current,
                            direction: event.target.value as 'outbound' | 'internal',
                          }))
                        }
                      >
                        <option value="outbound">Saida registrada</option>
                        <option value="internal">Nota interna</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Autor</label>
                    <input
                      className={FIELD_CLASS}
                      value={composer.author_name}
                      onChange={event => setComposer(current => ({ ...current, author_name: event.target.value }))}
                      placeholder="Recepcao, operador..."
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Mensagem</label>
                    <textarea
                      className={`${FIELD_CLASS} min-h-12 resize-y rounded-2xl px-4 py-3`}
                      value={composer.content}
                      onChange={event => setComposer(current => ({ ...current, content: event.target.value }))}
                      placeholder={
                        composer.direction === 'internal'
                          ? 'Contexto interno, handoff, observacao operacional...'
                          : 'Digite uma mensagem...'
                      }
                      required
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={sendMessageMutation.isPending || !composer.content.trim() || !canReply}
                      className="inline-flex h-12 items-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400"
                    >
                      {sendMessageMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      Enviar
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="max-w-xl text-xs text-slate-500 dark:text-slate-400">
                    Quando um atendente responde, a conversa entra em atendimento humano e a IA fica bloqueada ate ser marcada como resolvida.
                  </div>
                  {!canReply ? (
                    <div className="text-sm text-amber-600 dark:text-amber-300">
                      Seu usuario pode visualizar o inbox, mas nao tem permissao para responder.
                    </div>
                  ) : null}
                </div>
                {composerFeedback ? (
                  <div
                    className={`mt-2 text-sm ${
                      composerFeedback.kind === 'success'
                        ? 'text-emerald-600 dark:text-emerald-300'
                        : composerFeedback.kind === 'warning'
                          ? 'text-amber-600 dark:text-amber-300'
                          : 'text-rose-600 dark:text-rose-300'
                    }`}
                  >
                    {composerFeedback.text}
                  </div>
                ) : null}
              </form>
            </div>
          )}
        </section>
      </div>

      <Modal
        isOpen={isWhatsAppModalOpen}
        onClose={() => setIsWhatsAppModalOpen(false)}
        title="Conectar WhatsApp"
        size="lg"
      >
        {!channelConnections.length ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300">
              Esta clinica ainda nao tem nenhuma conexao cadastrada.
            </div>
            <Link
              href={`/platform/tenants/${tenantId}/whatsapp`}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:text-slate-200"
              onClick={() => setIsWhatsAppModalOpen(false)}
            >
              Ir para Conexoes
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Numero/Instancia
                </label>
                <select
                  className={FIELD_CLASS}
                  value={activeConnection?.id || ''}
                  onChange={event => setActiveConnectionId(event.target.value)}
                >
                  {channelConnections.map(connection => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name} ({connection.status})
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/5">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Status</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                  {activeConnection?.status === 'connected' ? 'Conectado' : activeConnection?.status === 'pending' ? 'Pendente' : activeConnection?.status === 'error' ? 'Erro' : 'Desconectado'}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {activeConnection?.last_healthcheck_at
                    ? `Ultima verificacao: ${formatDateTime(activeConnection.last_healthcheck_at)}`
                    : 'Sem verificacao recente'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => activeConnection && void runConnectionHealthcheck(activeConnection.id)}
                disabled={!activeConnection || Boolean(healthcheckConnectionId)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:text-slate-200"
              >
                {healthcheckConnectionId ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                Atualizar status
              </button>
              <button
                type="button"
                onClick={() => activeConnection && void requestConnectionPairing(activeConnection.id)}
                disabled={!activeConnection || Boolean(pairingConnectionId)}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:text-emerald-300"
              >
                {pairingConnectionId ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
                Gerar QR code
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Escaneie no WhatsApp do numero da clinica</div>
              <div className="grid gap-4 md:grid-cols-[260px_1fr]">
                <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950">
                  {activePairing.imageSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activePairing.imageSrc}
                      alt="QR code de conexao do WhatsApp"
                      className="h-56 w-56 rounded-lg object-contain"
                    />
                  ) : (
                    <div className="text-center text-xs text-slate-500 dark:text-slate-400">
                      Clique em "Gerar QR code" para carregar o codigo aqui.
                    </div>
                  )}
                </div>
                <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  <div>
                    <span className="font-medium text-slate-900 dark:text-white">Instancia:</span>{' '}
                    {String(activeConnection?.config?.instanceName || '-')}
                  </div>
                  <div>
                    <span className="font-medium text-slate-900 dark:text-white">Telefone:</span>{' '}
                    {String(activeConnection?.metadata?.phoneNumber || '-')}
                  </div>
                  <div>
                    <span className="font-medium text-slate-900 dark:text-white">Codigo de pareamento:</span>{' '}
                    {activePairing.pairingCode || '-'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Caminho rapido: WhatsApp do numero {'>'} Aparelhos conectados {'>'} Conectar aparelho {'>'} escanear QR.
                    Se o QR nao ler, use o codigo de pareamento exibido.
                  </div>
                </div>
              </div>
            </div>

            {whatsAppFeedback ? (
              <div
                className={`text-sm ${
                  whatsAppFeedback.kind === 'success'
                    ? 'text-emerald-600 dark:text-emerald-300'
                    : whatsAppFeedback.kind === 'warning'
                      ? 'text-amber-600 dark:text-amber-300'
                      : 'text-rose-600 dark:text-rose-300'
                }`}
              >
                {whatsAppFeedback.text}
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
};
