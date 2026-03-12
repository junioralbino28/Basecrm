'use client';

import React, { useMemo, useState } from 'react';
import { Copy, Loader2, Pencil, RotateCcw, SlidersHorizontal, ToggleLeft, ToggleRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import { useCRM } from '@/context/CRMContext';
import { useToast } from '@/context/ToastContext';
import { canManageClinicSettings } from '@/lib/auth/scope';
import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';

type FeatureItem = {
  key: string;
  title: string;
  description: string;
  promptKey?: string;
};

const FEATURES: FeatureItem[] = [
  {
    key: 'ai_chat_agent',
    title: 'Chat do agente (Pilot)',
    description: 'Chat principal com ferramentas do CRM.',
    promptKey: 'agent_crm_base_instructions',
  },
  {
    key: 'ai_sales_script',
    title: 'Script de vendas',
    description: 'Geração de script (Inbox / ações).',
    promptKey: 'task_inbox_sales_script',
  },
  {
    key: 'ai_daily_briefing',
    title: 'Briefing diário',
    description: 'Resumo diário de prioridades.',
    promptKey: 'task_inbox_daily_briefing',
  },
  {
    key: 'ai_deal_analyze',
    title: 'Análise de deal (coach)',
    description: 'Sugere próxima ação e urgência.',
    promptKey: 'task_deals_analyze',
  },
  {
    key: 'ai_email_draft',
    title: 'Rascunho de e-mail',
    description: 'Gera email profissional para o deal.',
    promptKey: 'task_deals_email_draft',
  },
  {
    key: 'ai_objection_responses',
    title: 'Objeções (3 respostas)',
    description: 'Gera alternativas para contornar objeções.',
    promptKey: 'task_deals_objection_responses',
  },
  {
    key: 'ai_conversation_auto_reply',
    title: 'Atendimento WhatsApp',
    description: 'Resposta automática da Julia nas conversas inbound do WhatsApp.',
    promptKey: 'task_conversations_whatsapp_auto_reply',
  },
  {
    key: 'ai_board_generate_structure',
    title: 'Boards: gerar estrutura',
    description: 'Cria estágios e automações sugeridas.',
    promptKey: 'task_boards_generate_structure',
  },
  {
    key: 'ai_board_generate_strategy',
    title: 'Boards: gerar estratégia',
    description: 'Define meta/KPI/persona do board.',
    promptKey: 'task_boards_generate_strategy',
  },
  {
    key: 'ai_board_refine',
    title: 'Boards: refinar com IA',
    description: 'Refina o board via chat/instruções.',
    promptKey: 'task_boards_refine',
  },
];

export const AIFeaturesSection: React.FC = () => {
  const { profile } = useAuth();
  const isAdmin = canManageClinicSettings(profile?.role);
  const { aiFeatureFlags, setAIFeatureFlag } = useCRM();
  const { showToast } = useToast();

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [editingFeature, setEditingFeature] = useState<FeatureItem | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptResetting, setPromptResetting] = useState(false);

  const items = useMemo(() => FEATURES, []);
  const catalogMap = useMemo(() => getPromptCatalogMap(), []);

  const getEnabled = (key: string) => {
    const value = aiFeatureFlags?.[key];
    return value !== false;
  };

  const toggle = async (key: string, enabled: boolean) => {
    if (!isAdmin) return;

    setSavingKey(key);
    try {
      await setAIFeatureFlag(key, enabled);
      showToast(enabled ? 'Função ativada' : 'Função desativada', 'success');
    } catch (error: any) {
      showToast(error?.message || 'Falha ao salvar', 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const openPromptEditor = async (feature: FeatureItem) => {
    if (!isAdmin || !feature.promptKey) return;

    setEditingFeature(feature);
    setPromptEditorOpen(true);
    setPromptLoading(true);

    try {
      const response = await fetch(`/api/settings/ai-prompts/${encodeURIComponent(feature.promptKey)}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `Falha ao carregar prompt (HTTP ${response.status})`);
      }

      const activeContent = (data?.active?.content as string | undefined) || '';
      const fallbackDefault = catalogMap?.[feature.promptKey]?.defaultTemplate || '';
      const nextPrompt = activeContent.trim().length > 0 ? activeContent : fallbackDefault;
      setPromptDraft(nextPrompt || '');
    } catch (error: any) {
      showToast(error?.message || 'Falha ao carregar prompt', 'error');
      setPromptDraft('');
    } finally {
      setPromptLoading(false);
    }
  };

  const closePromptEditor = () => {
    if (promptSaving) return;

    setPromptEditorOpen(false);
    setEditingFeature(null);
    setPromptDraft('');
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copiado!', 'success');
    } catch {
      showToast('Falha ao copiar', 'error');
    }
  };

  const savePromptOverride = async () => {
    if (!editingFeature?.promptKey) return;

    setPromptSaving(true);
    try {
      const response = await fetch('/api/settings/ai-prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key: editingFeature.promptKey, content: promptDraft }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `Falha ao salvar prompt (HTTP ${response.status})`);
      }

      showToast('Prompt salvo!', 'success');
      closePromptEditor();
    } catch (error: any) {
      showToast(error?.message || 'Falha ao salvar prompt', 'error');
    } finally {
      setPromptSaving(false);
    }
  };

  const resetPromptOverride = async () => {
    if (!editingFeature?.promptKey) return;

    setPromptResetting(true);
    try {
      const response = await fetch(`/api/settings/ai-prompts/${encodeURIComponent(editingFeature.promptKey)}`, {
        method: 'DELETE',
        headers: { accept: 'application/json' },
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `Falha ao resetar prompt (HTTP ${response.status})`);
      }

      showToast('Prompt resetado (voltou ao padrão)', 'success');
      closePromptEditor();
    } catch (error: any) {
      showToast(error?.message || 'Falha ao resetar prompt', 'error');
    } finally {
      setPromptResetting(false);
    }
  };

  return (
    <div id="ai-features" className="mb-12 scroll-mt-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <SlidersHorizontal className="h-5 w-5" /> Funções de IA
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Toggle + prompt no mesmo lugar para facilitar ajustes rápidos por clínica.
            </p>
          </div>
        </div>

        {!isAdmin && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            Apenas administradores podem configurar as funções de IA.
          </div>
        )}

        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-white/10">
          <div className="space-y-2">
            {items.map((feature) => {
              const enabled = getEnabled(feature.key);
              const saving = savingKey === feature.key;

              return (
                <div
                  key={feature.key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 dark:border-white/10 dark:bg-white/3"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900 dark:text-white">
                      {feature.title}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {feature.description}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}

                    {feature.promptKey ? (
                      <button
                        type="button"
                        onClick={() => openPromptEditor(feature)}
                        disabled={!isAdmin || saving}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-2 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                        title="Editar prompt"
                        aria-label="Editar prompt"
                      >
                        <Pencil className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => toggle(feature.key, !enabled)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-2 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                      title={enabled ? 'Desativar' : 'Ativar'}
                      aria-label={enabled ? `Desativar ${feature.title}` : `Ativar ${feature.title}`}
                      disabled={!isAdmin || saving}
                    >
                      {enabled ? (
                        <ToggleRight className="h-4 w-4 text-green-600" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-red-500" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Modal
        isOpen={promptEditorOpen}
        onClose={closePromptEditor}
        title={editingFeature ? `Prompt: ${editingFeature.title}` : 'Prompt'}
        size="xl"
        bodyClassName="space-y-4"
      >
        {editingFeature?.promptKey ? (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <div className="truncate font-mono">key: {editingFeature.promptKey}</div>
              <button
                type="button"
                onClick={() => copyToClipboard(editingFeature.promptKey!)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                title="Copiar key"
                aria-label="Copiar key"
              >
                <Copy size={16} />
              </button>
            </div>

            {promptLoading ? (
              <div className="flex min-h-[280px] items-center justify-center text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Carregando prompt...
                </div>
              </div>
            ) : (
              <textarea
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value)}
                placeholder="Cole ou edite o prompt aqui..."
                className="min-h-[280px] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 font-mono text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            )}

            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={resetPromptOverride}
                disabled={!isAdmin || promptResetting || promptSaving}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium ${
                  !isAdmin || promptResetting || promptSaving
                    ? 'cursor-not-allowed border-slate-200 text-slate-400 dark:border-white/10'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5'
                }`}
              >
                {promptResetting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                Reset
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closePromptEditor}
                  disabled={promptSaving}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={savePromptOverride}
                  disabled={!isAdmin || promptSaving || promptLoading || !promptDraft.trim()}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white ${
                    !isAdmin || promptSaving || promptLoading || !promptDraft.trim()
                      ? 'cursor-not-allowed bg-slate-300 dark:bg-white/10'
                      : 'bg-primary-600 hover:bg-primary-700'
                  }`}
                >
                  {promptSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                  Salvar
                </button>
              </div>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
};
