'use client';

import React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Bot,
  CheckCheck,
  Loader2,
  MessageCircle,
  MessagesSquare,
  MoreVertical,
  Phone,
  QrCode,
  RefreshCcw,
  Search,
  Send,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useTenantDetail } from './useTenantDetail';
import { useAuth } from '@/context/AuthContext';
import { queryKeys } from '@/lib/query';
import { Modal } from '@/components/ui/Modal';
import ConfirmModal from '@/components/ConfirmModal';
import { canManageClinicSettings } from '@/lib/auth/scope';
import { MessageBubble } from './conversations/MessageBubble';
import { useQuickScripts } from '@/features/inbox/hooks/useQuickScripts';
import { dealFilesService } from '@/lib/supabase/dealFiles';
import { ChevronDown, FileText, Filter, Image as ImageIcon, Mic, Plus, Zap } from 'lucide-react';
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

// Opções do filtro principal do inbox (viram um "box com switch" compacto, no lugar
// das 6 pills escritas por extenso que ocupavam duas linhas do cabeçalho).
const FILTER_OPTIONS: { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'Tudo' },
  { id: 'ai_active', label: 'Julia' },
  { id: 'human_queue', label: 'Fila humana' },
  { id: 'human_active', label: 'Humano' },
  { id: 'resolved', label: 'Resolvidas' },
  { id: 'closed', label: 'Fechadas' },
];

const FIELD_CLASS =
  'w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-white/10 dark:bg-card dark:text-white';

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

function formatConversationListTime(value: string | null) {
  if (!value) return '';

  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  return new Intl.DateTimeFormat('pt-BR', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit' }
  ).format(date);
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
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = React.useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = React.useState(false);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = React.useState(false);
  // Cabeçalho estilo WhatsApp: faixa do contato sempre visível + controles pesados
  // (atribuir/status/ações) colapsados atrás de "Ações ▾", fechados por padrão, pra
  // a janela de mensagens ficar grande e confortável.
  const [isThreadPanelOpen, setIsThreadPanelOpen] = React.useState(false);
  const [isScriptsOpen, setIsScriptsOpen] = React.useState(false);
  const documentInputRef = React.useRef<HTMLInputElement | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
  const { scripts: quickScripts, isLoading: scriptsLoading } = useQuickScripts();
  const [activeConnectionId, setActiveConnectionId] = React.useState<string | null>(null);
  const [pairingConnectionId, setPairingConnectionId] = React.useState<string | null>(null);
  const [healthcheckConnectionId, setHealthcheckConnectionId] = React.useState<string | null>(null);
  const [whatsAppFeedback, setWhatsAppFeedback] = React.useState<{
    kind: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const messagesViewportRef = React.useRef<HTMLDivElement | null>(null);
  const messagesBottomRef = React.useRef<HTMLDivElement | null>(null);

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
  const canDeleteLead = canManageClinicSettings(profile?.role);

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

  React.useEffect(() => {
    const viewport = messagesViewportRef.current;
    const bottom = messagesBottomRef.current;
    if (!viewport || !bottom || !selectedThreadId) return;

    requestAnimationFrame(() => {
      bottom.scrollIntoView({ block: 'end' });
    });
  }, [selectedThreadId, messagesQuery.data?.messages?.length]);

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

  // Envio de anexo: sobe o arquivo pro bucket deal-files (RLS por tenant) e POSTa
  // a mensagem com o ponteiro; o SERVIDOR gera o signed URL e chama a Evolution.
  const sendAttachmentMutation = useMutation({
    mutationFn: async (input: { kind: 'image' | 'video' | 'document' | 'audio'; file: File; caption?: string }) => {
      const dealId = selectedThread?.deal_id;
      if (!dealId) {
        throw new Error('Esta conversa ainda não tem oportunidade vinculada para anexar arquivos.');
      }
      const { data: uploaded, error: uploadError } = await dealFilesService.uploadFile(dealId, input.file);
      if (uploadError || !uploaded) {
        throw new Error(uploadError instanceof Error ? uploadError.message : 'Falha ao subir o arquivo.');
      }

      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations/${selectedThreadId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          direction: 'outbound',
          send_external: true,
          content: input.caption?.trim() || undefined,
          attachment: {
            kind: input.kind,
            file_path: uploaded.file_path,
            file_name: uploaded.file_name,
            mime_type: uploaded.mime_type ?? undefined,
            file_size: uploaded.file_size ?? undefined,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao enviar anexo (HTTP ${res.status})`);
      return data as { ok: true; message: ConversationMessage; thread: ConversationThreadListItem; warning?: string | null };
    },
    onSuccess: data => {
      queryClient.setQueryData<MessagesResponse | undefined>(
        queryKeys.conversations.messages(data.thread.id),
        current => ({ messages: [...(current?.messages || []), data.message] })
      );
      updateInboxThread(data.thread);
      setComposerFeedback(
        data.warning
          ? { kind: 'warning', text: `Anexo registrado, mas o envio pela Evolution falhou: ${data.warning}` }
          : { kind: 'success', text: 'Anexo enviado.' }
      );
    },
    onError: error => {
      setComposerFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha ao enviar anexo.',
      });
    },
  });

  function handleFilePicked(kind: 'image' | 'video' | 'document', event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setIsAttachMenuOpen(false);
    if (!file) return;
    setComposerFeedback(null);
    // imagem x vídeo: o input de "Foto e vídeo" decide pelo mime real.
    const realKind: 'image' | 'video' | 'document' =
      kind === 'image' ? (file.type.startsWith('video/') ? 'video' : 'image') : 'document';
    sendAttachmentMutation.mutate({ kind: realKind, file });
  }

  function handleInsertScript(content: string) {
    setComposer(current => ({ ...current, content: current.content ? `${current.content}\n${content}` : content }));
    setIsScriptsOpen(false);
    setIsAttachMenuOpen(false);
  }

  const deleteLeadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations/${threadId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao apagar lead (HTTP ${res.status})`);
      return data as {
        ok: true;
        deleted: {
          threadId: string;
          dealId: string | null;
          contactId: string | null;
        };
      };
    },
    onSuccess: async data => {
      queryClient.removeQueries({ queryKey: queryKeys.conversations.messages(data.deleted.threadId) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations.list({ tenantId }) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.deals.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all }),
      ]);
      setSelectedThreadId(current => (current === data.deleted.threadId ? null : current));
      setComposerFeedback({
        kind: 'success',
        text: 'Lead de teste apagado com sucesso. Conversa, contato e oportunidade foram removidos.',
      });
      await reload();
    },
    onError: error => {
      setComposerFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha ao apagar lead.',
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
    <div className="flex h-[calc(100dvh-7rem)] min-h-[720px] w-full flex-col overflow-hidden p-4 md:p-6">
      {inboxQuery.error ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          {inboxQuery.error.message}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-0 overflow-hidden rounded-[2rem] border border-slate-800/80 shadow-[0_30px_80px_rgba(2,6,23,0.45)] xl:grid-cols-[390px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden bg-[#111b21]">
          <div className="border-b border-slate-700 bg-[#202c33] p-4 dark:border-white/10">
            <div className="flex items-center justify-between gap-3 text-sm font-semibold text-white">
              <div className="flex items-center gap-2">
                <MessagesSquare size={16} />
                Conversas
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Mais opções"
              >
                <MoreVertical size={16} />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="w-full rounded-full border border-transparent bg-[#2a3942] px-10 py-2.5 text-sm text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Pesquisar ou começar nova conversa"
                />
              </div>

              {/* Filtro principal = um "box com switch" compacto (antes eram 6 pills
                  escritas por extenso em 2 linhas). Os toggles booleanos ficam ao lado. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsFilterMenuOpen(current => !current)}
                    aria-haspopup="listbox"
                    aria-expanded={isFilterMenuOpen}
                    className="inline-flex items-center gap-2 rounded-full bg-[#202c33] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-[#2a3942]"
                  >
                    <Filter size={13} className="text-slate-400" aria-hidden="true" />
                    {FILTER_OPTIONS.find(option => option.id === filter)?.label || 'Tudo'}
                    <ChevronDown size={14} className="text-slate-400" aria-hidden="true" />
                  </button>
                  {isFilterMenuOpen ? (
                    <>
                      <button
                        type="button"
                        aria-hidden="true"
                        tabIndex={-1}
                        className="fixed inset-0 z-30 cursor-default"
                        onClick={() => setIsFilterMenuOpen(false)}
                      />
                      <div
                        role="listbox"
                        className="absolute left-0 top-full z-40 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-slate-700 bg-[#202c33] p-1 shadow-xl"
                      >
                        {FILTER_OPTIONS.map(option => (
                          <button
                            key={option.id}
                            type="button"
                            role="option"
                            aria-selected={filter === option.id}
                            onClick={() => {
                              setFilter(option.id);
                              setIsFilterMenuOpen(false);
                            }}
                            className={`block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                              filter === option.id
                                ? 'bg-cyan-500 text-slate-950'
                                : 'text-slate-200 hover:bg-[#2a3942]'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => setOnlyUnread(current => !current)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    onlyUnread
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-[#202c33] text-slate-300 hover:bg-[#2a3942]'
                  }`}
                >
                  Não lidas
                </button>
                <button
                  type="button"
                  onClick={() => setOnlyUnassigned(current => !current)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    onlyUnassigned
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-[#202c33] text-slate-300 hover:bg-[#2a3942]'
                  }`}
                >
                  Sem dono
                </button>
              </div>
            </div>

          </div>

          <div className="flex-1 space-y-0.5 overflow-y-auto bg-[#111b21] p-2">
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
                        ? 'border-transparent bg-[#202c33] shadow-md'
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
                              {formatConversationListTime(thread.last_message_sent_at || thread.updated_at)}
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
                        <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-500">
                          <span className="truncate">{thread.contact_phone || 'Sem telefone'}</span>
                          {thread.assignee?.display_name ? (
                            <span className="truncate">{thread.assignee.display_name}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden bg-[#0b141a]">
          {!selectedThread ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.045)_1px,_transparent_1px)] [background-size:26px_26px] px-6 text-center">
              <MessageCircle size={32} className="text-slate-500" />
              <div className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
                Selecione uma conversa
              </div>
              <div className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
                Escolha uma thread na fila ao lado para triagem, atribuicao e registro operacional da conversa.
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-slate-800 bg-[#202c33] px-4 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-emerald-400 to-cyan-500 text-sm font-semibold text-white">
                      {getThreadAvatar(selectedThread)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-white">
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

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsThreadPanelOpen(current => !current)}
                      aria-expanded={isThreadPanelOpen}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500"
                    >
                      Ações
                      <ChevronDown
                        size={14}
                        className={`transition-transform ${isThreadPanelOpen ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>

                {isThreadPanelOpen ? (
                <div className="mt-3 border-t border-slate-800 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void messagesQuery.refetch()}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500"
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
                      className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <CheckCheck size={14} />
                      Marcar lida
                    </button>
                    {canAccessWhatsApp ? (
                      <button
                        type="button"
                        onClick={() => {
                          setWhatsAppFeedback(null);
                          setIsWhatsAppModalOpen(true);
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400"
                      >
                        <QrCode size={14} />
                        Conectar WhatsApp
                      </button>
                    ) : null}
                    {canDeleteLead ? (
                      <button
                        type="button"
                        onClick={() => {
                          setComposerFeedback(null);
                          setIsDeleteConfirmOpen(true);
                        }}
                        disabled={deleteLeadMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deleteLeadMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Apagar lead
                      </button>
                    ) : null}
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="min-w-[220px] rounded-full border border-slate-700 bg-[#111b21] px-3 py-1.5">
                    <label className="mb-0.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      <UserRound size={12} />
                      Responsável
                    </label>
                    <select
                      className="w-full bg-transparent text-sm text-slate-100 outline-none"
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

                  <div className="min-w-[220px] rounded-full border border-slate-700 bg-[#111b21] px-3 py-1.5">
                    <label className="mb-0.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      <AlertCircle size={12} />
                      Status
                    </label>
                    <select
                      className="w-full bg-transparent text-sm text-slate-100 outline-none"
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

                <div className="mt-2 text-sm font-medium text-slate-200">
                  {routingLabel(selectedThread)}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
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
                    className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:border-amber-400/40 disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:border-violet-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CheckCheck size={16} />
                    Marcar como resolvido
                  </button>
                  {/* Devolver pra Julia: libera a thread de volta pra IA (status ai_active). Reusa o modelo de handoff existente. */}
                  <button
                    type="button"
                    onClick={() =>
                      updateThreadMutation.mutate({
                        threadId: selectedThread.id,
                        body: { status: 'ai_active', mark_as_read: true },
                      })
                    }
                    disabled={updateThreadMutation.isPending || selectedThread.status === 'ai_active'}
                    className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Bot size={16} />
                    Devolver pra Julia
                  </button>
                  {selectedThread.contact_id ? (
                    <Link
                      href={`/platform/tenants/${tenantId}/contacts?contactId=${selectedThread.contact_id}`}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-500"
                    >
                      <UserRound size={16} />
                      Ficha do paciente
                    </Link>
                  ) : null}
                </div>

                {updateThreadMutation.error ? (
                  <div className="mt-3 text-sm text-rose-600 dark:text-rose-300">
                    {updateThreadMutation.error.message}
                  </div>
                ) : null}
                </div>
                ) : null}
              </div>

              <div
                ref={messagesViewportRef}
                className="flex-1 overflow-y-auto bg-[#0b141a] bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.045)_1px,_transparent_1px)] [background-size:26px_26px] px-4 py-5"
              >
                <div className="flex w-full flex-col gap-3">
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
                    <MessageBubble key={message.id} message={message} />
                  ))
                )}
                <div ref={messagesBottomRef} />
                </div>
              </div>

              <form
                className="shrink-0 border-t border-slate-800 bg-[#202c33] p-4"
                onSubmit={event => {
                  event.preventDefault();
                  setComposerFeedback(null);
                  sendMessageMutation.mutate();
                }}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    <button
                      type="button"
                      onClick={() =>
                        setComposer(current => ({
                          ...current,
                          direction: current.direction === 'outbound' ? 'internal' : 'outbound',
                        }))
                      }
                      className={`rounded-full px-3 py-1.5 transition ${
                        composer.direction === 'internal'
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-emerald-500/15 text-emerald-300'
                      }`}
                    >
                      {composer.direction === 'internal' ? 'Nota interna' : 'Mensagem externa'}
                    </button>
                    <span>{composer.author_name || 'Sem autor'}</span>
                  </div>
                </div>
                <div className="relative grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-end gap-3">
                  {/* Inputs ocultos: documento e foto/vídeo */}
                  <input
                    ref={documentInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf"
                    onChange={event => handleFilePicked('document', event)}
                  />
                  <input
                    ref={imageInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,video/*"
                    onChange={event => handleFilePicked('image', event)}
                  />

                  {/* Menu de anexo (mirror mockup: Documento / Foto e vídeo / Script da cadência) */}
                  {isAttachMenuOpen ? (
                    <div className="absolute bottom-14 left-0 z-30 w-60 overflow-hidden rounded-xl border border-slate-700 bg-[#202c33] shadow-xl">
                      <button
                        type="button"
                        onClick={() => documentInputRef.current?.click()}
                        className="inline-flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] font-medium text-slate-100 transition hover:bg-white/5"
                      >
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500/15 text-rose-300"><FileText size={16} /></span>
                        Documento
                      </button>
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        className="inline-flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] font-medium text-slate-100 transition hover:bg-white/5"
                      >
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/15 text-brand-300"><ImageIcon size={16} /></span>
                        Foto e vídeo
                      </button>
                      <button
                        type="button"
                        onClick={() => { setIsScriptsOpen(true); setIsAttachMenuOpen(false); }}
                        className="inline-flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] font-medium text-slate-100 transition hover:bg-white/5"
                      >
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gold-500/15 text-gold-300"><Zap size={16} /></span>
                        Script da cadência
                      </button>
                    </div>
                  ) : null}

                  {/* Painel de scripts F1-F9 (lê quick_scripts existentes) */}
                  {isScriptsOpen ? (
                    <div className="absolute bottom-14 left-0 z-30 max-h-72 w-80 overflow-y-auto rounded-xl border border-slate-700 bg-[#202c33] p-2 shadow-xl">
                      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Scripts da cadência</div>
                      {scriptsLoading ? (
                        <div className="flex items-center gap-2 px-2 py-3 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
                      ) : quickScripts.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-slate-400">Nenhum script cadastrado ainda.</div>
                      ) : (
                        quickScripts.map(script => (
                          <button
                            key={script.id}
                            type="button"
                            onClick={() => handleInsertScript(script.template)}
                            className="block w-full rounded-lg px-2 py-2 text-left transition hover:bg-white/5"
                          >
                            <div className="text-[12.5px] font-semibold text-slate-100">{script.title}</div>
                            <div className="line-clamp-2 text-[11px] text-slate-400">{script.template}</div>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => { setIsScriptsOpen(false); setIsAttachMenuOpen(current => !current); }}
                    disabled={!canReply || sendAttachmentMutation.isPending}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Anexar"
                  >
                    {sendAttachmentMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Plus size={20} />}
                  </button>
                  <div className="rounded-[1.75rem] bg-[#2a3942] px-4 py-2">
                    <textarea
                      className="min-h-8 w-full resize-none bg-transparent py-1 text-sm text-slate-100 outline-none placeholder:text-slate-400"
                      value={composer.content}
                      onChange={event => setComposer(current => ({ ...current, content: event.target.value }))}
                      onKeyDown={event => {
                        // Enter envia; Shift+Enter quebra linha. Ignora durante composição
                        // de IME (acentuação) pra não cortar a digitação no meio.
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          if (sendMessageMutation.isPending || !composer.content.trim() || !canReply) return;
                          setComposerFeedback(null);
                          sendMessageMutation.mutate();
                        }
                      }}
                      placeholder={
                        composer.direction === 'internal'
                          ? 'Escreva uma nota interna...'
                          : 'Digite uma mensagem'
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={sendMessageMutation.isPending || !composer.content.trim() || !canReply}
                      className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {sendMessageMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                  </div>
                  {/* Mic: gravação de áudio é v1.1 (atrito MediaRecorder↔Evolution não verificado ao vivo). */}
                  <div className="flex items-end">
                    <button
                      type="button"
                      disabled
                      title="Gravar áudio chega na v1.1 (recebimento de áudio já funciona)"
                      className="inline-flex h-12 w-12 cursor-not-allowed items-center justify-center rounded-full border border-slate-700 text-slate-500 opacity-60"
                      aria-label="Gravar áudio (em breve)"
                    >
                      <Mic size={18} />
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
                <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-card">
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

      <ConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={() => {
          if (selectedThreadId) {
            deleteLeadMutation.mutate(selectedThreadId);
          }
        }}
        title="Apagar lead de teste"
        message="Isso vai apagar a conversa, o lead e a oportunidade vinculada. Use essa acao apenas para limpeza de testes."
        confirmText="Apagar definitivamente"
        cancelText="Cancelar"
        variant="danger"
      />
    </div>
  );
};
