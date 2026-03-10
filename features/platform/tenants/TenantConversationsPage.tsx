'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, MessageCircle, PlusCircle, RefreshCcw, Send } from 'lucide-react';
import { useTenantDetail } from './useTenantDetail';

type Thread = {
  id: string;
  title: string;
  contact_name: string | null;
  contact_phone: string | null;
  status: 'open' | 'waiting' | 'closed';
  channel_connection_id: string | null;
  last_message_at: string | null;
  updated_at: string;
};

type Message = {
  id: string;
  direction: 'inbound' | 'outbound' | 'internal';
  author_name: string | null;
  content: string;
  sent_at: string;
};

const FIELD_CLASS =
  'w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-white/10 dark:bg-slate-950 dark:text-white';

export const TenantConversationsPage: React.FC = () => {
  const { tenantId, tenant } = useTenantDetail();
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loadingThreads, setLoadingThreads] = React.useState(true);
  const [loadingMessages, setLoadingMessages] = React.useState(false);
  const [savingThread, setSavingThread] = React.useState(false);
  const [sendingMessage, setSendingMessage] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = React.useState<'success' | 'error'>('success');
  const [threadForm, setThreadForm] = React.useState({
    title: '',
    contact_name: '',
    contact_phone: '',
    channel_connection_id: '',
  });
  const [messageForm, setMessageForm] = React.useState({
    direction: 'outbound' as Message['direction'],
    author_name: '',
    content: '',
  });

  const selectedThread = React.useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [threads, selectedThreadId]
  );

  const loadThreads = React.useCallback(async () => {
    if (!tenantId) return;
    setLoadingThreads(true);
    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao carregar conversas (HTTP ${res.status})`);
      const nextThreads = data?.threads || [];
      setThreads(nextThreads);
      setSelectedThreadId((current) => current || nextThreads[0]?.id || null);
    } catch (error) {
      setFeedbackKind('error');
      setFeedback(error instanceof Error ? error.message : 'Falha ao carregar conversas.');
    } finally {
      setLoadingThreads(false);
    }
  }, [tenantId]);

  const loadMessages = React.useCallback(async () => {
    if (!tenantId || !selectedThreadId) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations/${selectedThreadId}/messages`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao carregar mensagens (HTTP ${res.status})`);
      setMessages(data?.messages || []);
    } catch (error) {
      setFeedbackKind('error');
      setFeedback(error instanceof Error ? error.message : 'Falha ao carregar mensagens.');
    } finally {
      setLoadingMessages(false);
    }
  }, [tenantId, selectedThreadId]);

  React.useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  React.useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  async function createThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;

    setSavingThread(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          title: threadForm.title,
          contact_name: threadForm.contact_name,
          contact_phone: threadForm.contact_phone,
          channel_connection_id: threadForm.channel_connection_id || null,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao criar conversa (HTTP ${res.status})`);

      setFeedbackKind('success');
      setFeedback('Conversa criada.');
      setThreadForm({
        title: '',
        contact_name: '',
        contact_phone: '',
        channel_connection_id: '',
      });
      await loadThreads();
      setSelectedThreadId(data?.thread?.id || null);
    } catch (error) {
      setFeedbackKind('error');
      setFeedback(error instanceof Error ? error.message : 'Falha ao criar conversa.');
    } finally {
      setSavingThread(false);
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || !selectedThreadId) return;

    setSendingMessage(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations/${selectedThreadId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(messageForm),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao registrar mensagem (HTTP ${res.status})`);

      setFeedbackKind('success');
      setFeedback('Mensagem registrada.');
      setMessageForm({
        direction: 'outbound',
        author_name: '',
        content: '',
      });
      await loadMessages();
      await loadThreads();
    } catch (error) {
      setFeedbackKind('error');
      setFeedback(error instanceof Error ? error.message : 'Falha ao registrar mensagem.');
    } finally {
      setSendingMessage(false);
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
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Conversations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Base inicial de conversas da clinica para WhatsApp, handoff e historico operacional.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadThreads()}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
        >
          <RefreshCcw size={16} />
          Atualizar
        </button>
      </div>

      {feedback ? (
        <div className={feedbackKind === 'success' ? 'text-sm text-emerald-600 dark:text-emerald-300' : 'text-sm text-rose-600 dark:text-rose-300'}>
          {feedback}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <PlusCircle size={16} />
              Nova conversa
            </div>

            <form className="mt-5 space-y-4" onSubmit={createThread}>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Titulo</label>
                <input className={FIELD_CLASS} value={threadForm.title} onChange={(e) => setThreadForm((current) => ({ ...current, title: e.target.value }))} placeholder="WhatsApp - Avaliacao inicial" />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Nome do contato</label>
                  <input className={FIELD_CLASS} value={threadForm.contact_name} onChange={(e) => setThreadForm((current) => ({ ...current, contact_name: e.target.value }))} placeholder="Maria Souza" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Telefone</label>
                  <input className={FIELD_CLASS} value={threadForm.contact_phone} onChange={(e) => setThreadForm((current) => ({ ...current, contact_phone: e.target.value }))} placeholder="+55 11 99999-9999" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Conexao WhatsApp</label>
                <select
                  className={FIELD_CLASS}
                  value={threadForm.channel_connection_id}
                  onChange={(e) => setThreadForm((current) => ({ ...current, channel_connection_id: e.target.value }))}
                >
                  <option value="">Sem vinculo</option>
                  {(tenant?.channel_connections || []).map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={savingThread}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400"
              >
                {savingThread ? 'Criando...' : 'Criar conversa'}
              </button>
            </form>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <MessageCircle size={16} />
              Conversas abertas
            </div>

            <div className="mt-4 space-y-3">
              {loadingThreads ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">Carregando conversas...</div>
              ) : threads.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                  Nenhuma conversa registrada ainda.
                </div>
              ) : (
                threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => setSelectedThreadId(thread.id)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                      selectedThreadId === thread.id
                        ? 'border-cyan-400 bg-cyan-50 dark:border-cyan-500/50 dark:bg-cyan-500/10'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-white/10 dark:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{thread.title}</div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {thread.contact_name || 'Sem nome'} • {thread.contact_phone || 'Sem telefone'}
                        </div>
                      </div>
                      <div className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white dark:bg-white/10 dark:text-slate-200">
                        {thread.status}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{selectedThread?.title || 'Timeline da conversa'}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {selectedThread?.contact_name || 'Selecione uma conversa para ver as mensagens'}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {!selectedThread ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                Escolha uma conversa na coluna ao lado.
              </div>
            ) : loadingMessages ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">Carregando mensagens...</div>
            ) : messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                Nenhuma mensagem registrada ainda nesta conversa.
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    message.direction === 'outbound'
                      ? 'ml-8 bg-cyan-50 text-slate-800 dark:bg-cyan-500/10 dark:text-slate-100'
                      : message.direction === 'internal'
                        ? 'mr-8 bg-amber-50 text-slate-800 dark:bg-amber-500/10 dark:text-slate-100'
                        : 'mr-8 bg-slate-100 text-slate-800 dark:bg-white/5 dark:text-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>{message.author_name || message.direction}</span>
                    <span>{new Date(message.sent_at).toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap">{message.content}</div>
                </div>
              ))
            )}
          </div>

          {selectedThread ? (
            <form className="mt-6 space-y-4 border-t border-slate-200 pt-6 dark:border-white/10" onSubmit={sendMessage}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Direcao</label>
                  <select
                    className={FIELD_CLASS}
                    value={messageForm.direction}
                    onChange={(e) => setMessageForm((current) => ({ ...current, direction: e.target.value as Message['direction'] }))}
                  >
                    <option value="outbound">Saida</option>
                    <option value="inbound">Entrada</option>
                    <option value="internal">Interna</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Autor</label>
                  <input
                    className={FIELD_CLASS}
                    value={messageForm.author_name}
                    onChange={(e) => setMessageForm((current) => ({ ...current, author_name: e.target.value }))}
                    placeholder="Recepcao, IA, consultor..."
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Mensagem</label>
                <textarea
                  className={`${FIELD_CLASS} min-h-32 resize-y`}
                  value={messageForm.content}
                  onChange={(e) => setMessageForm((current) => ({ ...current, content: e.target.value }))}
                  placeholder="Registre aqui a troca de mensagens, handoff ou observacao interna..."
                />
              </div>

              <button
                type="submit"
                disabled={sendingMessage}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400"
              >
                <Send size={16} />
                {sendingMessage ? 'Registrando...' : 'Registrar mensagem'}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
};
