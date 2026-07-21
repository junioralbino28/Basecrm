'use client';

import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FlaskConical,
  GitBranch,
  Loader2,
  MessageSquareText,
  Plus,
  Save,
  Search,
  Send,
  Sparkles,
  Timer,
  Workflow,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import type { AutomationWorkspaceItem } from '@/lib/automations/workspace';
import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';
import type { AutomationStepType } from '@/lib/automations/compiler';
import { useTenantDetail } from '@/features/platform/tenants/useTenantDetail';
import { AutomationFlowMap, automationStepName } from './AutomationFlowMap';
import { AutomationFlowToolbar } from './AutomationFlowToolbar';
import { AutomationStepDock } from './AutomationStepDock';
import {
  eligibleAutomationMoveTargets,
  getAutomationMoveBlock,
  moveAutomationStep,
} from './automationGraphMove';
import {
  addAutomationSwitchCase,
  moveAutomationSwitchCase,
  removeAutomationSwitchCase,
} from './automationSwitchDraft';

type MessageTemplate = {
  id: string;
  name: string;
  channel: string;
  body: string;
  revision: number;
  updatedAt: string;
};

type TestTarget = {
  threadId: string;
  label: string;
  detail: string;
};

type WorkspaceResponse = {
  automations: AutomationWorkspaceItem[];
  templates: MessageTemplate[];
  testTargets: TestTarget[];
  safeMode: { liveEnabled: boolean };
  access?: { canEdit?: boolean; canOperate?: boolean };
};

type Feedback = {
  tone: 'success' | 'warning' | 'error';
  text: string;
};

type ActionDefinition = {
  type: 'send_message' | 'delay' | 'wait_for_event' | 'create_task' | 'switch';
  title: string;
  description: string;
  keywords: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const FIELD_CLASS =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-white/10 dark:bg-slate-950 dark:text-white';

const ACTIONS: ActionDefinition[] = [
  {
    type: 'send_message',
    title: 'Enviar mensagem',
    description: 'Escreva no próprio passo ou use a biblioteca.',
    keywords: 'mensagem whatsapp texto',
    icon: MessageSquareText,
  },
  {
    type: 'delay',
    title: 'Aguardar um tempo',
    description: 'Continua depois de minutos, horas ou dias.',
    keywords: 'aguardar tempo delay prazo',
    icon: Timer,
  },
  {
    type: 'wait_for_event',
    title: 'Aguardar resposta',
    description: 'Cria os caminhos respondeu e não respondeu.',
    keywords: 'aguardar resposta timeout evento',
    icon: Clock3,
  },
  {
    type: 'create_task',
    title: 'Criar tarefa',
    description: 'Registra uma próxima ação para o time.',
    keywords: 'tarefa atividade lembrete',
    icon: CheckCircle2,
  },
  {
    type: 'switch',
    title: 'Dividir caminho',
    description: 'Cria caminhos nomeados e um caminho final obrigatório.',
    keywords: 'dividir caminho condição decisão branch',
    icon: GitBranch,
  },
];

function newStep(
  stepType: AutomationStepType,
  sortKey: number,
  config?: Record<string, unknown>,
): AutomationBuilderStep {
  const defaults: Partial<Record<AutomationStepType, Record<string, unknown>>> = {
    send_message: {
      link_mode: 'copied',
      body_local: '',
      message_kind: 'text',
      channel: 'whatsapp',
    },
    delay: { amount: 1, unit: 'hours' },
    wait_for_event: { timeout_amount: 1, timeout_unit: 'days' },
    create_task: { title: 'Dar continuidade' },
    switch: {
      field: 'contact.phone',
      cases: [{
        case_id: globalThis.crypto.randomUUID(),
        label: 'Caminho 1',
        operator: 'contains',
        value: '',
        order: 0,
      }],
      fallback_label: 'Para quem não se encaixa',
    },
  };
  return {
    stepKey: globalThis.crypto.randomUUID(),
    stepType,
    sortKey,
    config: config ?? defaults[stepType] ?? {},
  };
}

function feedbackClass(tone: Feedback['tone']) {
  if (tone === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200';
  }
  if (tone === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200';
  }
  return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200';
}

function insertAction(
  automation: AutomationWorkspaceItem,
  afterIndex: number,
  action: ActionDefinition['type'],
): AutomationWorkspaceItem {
  const source = automation.steps[afterIndex];
  if (!source) return automation;

  const sourceOutcome = source.stepType === 'wait_for_event' ? 'answered' : 'success';
  const outgoingSuccess = automation.edges.find(
    (edge) => edge.fromStepKey === source.stepKey && edge.outcome === sourceOutcome,
  );
  const retainedEdges = automation.edges.filter((edge) => edge !== outgoingSuccess);
  const inserted = newStep(action, afterIndex + 1);
  const steps = [...automation.steps];
  steps.splice(afterIndex + 1, 0, inserted);
  const edges: AutomationBuilderEdge[] = [
    ...retainedEdges,
    {
      fromStepKey: source.stepKey,
      outcome: sourceOutcome,
      toStepKey: inserted.stepKey,
      order: 0,
    },
  ];

  if (action === 'switch') {
    const firstCase = Array.isArray(inserted.config.cases)
      ? inserted.config.cases[0] as { case_id?: unknown }
      : null;
    const caseId = typeof firstCase?.case_id === 'string'
      ? firstCase.case_id
      : globalThis.crypto.randomUUID();
    const firstPath = newStep(
      'create_task',
      afterIndex + 2,
      { title: 'Configurar Caminho 1' },
    );
    const fallback = newStep(
      'create_task',
      afterIndex + 3,
      { title: 'Configurar quem não se encaixa' },
    );
    steps.splice(afterIndex + 2, 0, firstPath, fallback);
    edges.push(
      {
        fromStepKey: inserted.stepKey,
        outcome: `case:${caseId}`,
        toStepKey: firstPath.stepKey,
        order: 0,
      },
      {
        fromStepKey: inserted.stepKey,
        outcome: 'otherwise',
        toStepKey: fallback.stepKey,
        order: 1,
      },
    );
    if (outgoingSuccess) {
      edges.push({
        fromStepKey: firstPath.stepKey,
        outcome: 'success',
        toStepKey: outgoingSuccess.toStepKey,
        order: 0,
      });
    }
  } else if (action === 'wait_for_event') {
    const answered = newStep(
      'create_task',
      afterIndex + 2,
      { title: 'Retomar conversa após resposta' },
    );
    const timeout = newStep(
      'create_task',
      afterIndex + 3,
      { title: 'Tratar contato sem resposta' },
    );
    steps.splice(afterIndex + 2, 0, answered, timeout);
    edges.push(
      {
        fromStepKey: inserted.stepKey,
        outcome: 'answered',
        toStepKey: answered.stepKey,
        order: 0,
      },
      {
        fromStepKey: inserted.stepKey,
        outcome: 'timeout',
        toStepKey: timeout.stepKey,
        order: 1,
      },
    );
    if (outgoingSuccess) {
      edges.push({
        fromStepKey: answered.stepKey,
        outcome: 'success',
        toStepKey: outgoingSuccess.toStepKey,
        order: 0,
      });
    }
  } else if (outgoingSuccess) {
    edges.push({
      fromStepKey: inserted.stepKey,
      outcome: 'success',
      toStepKey: outgoingSuccess.toStepKey,
      order: 0,
    });
  }

  return {
    ...automation,
    steps: steps.map((step, index) => ({ ...step, sortKey: index })),
    edges,
  };
}

export function AutomationBuilderPage(props: {
  tenantId: string;
  tenantName: string;
  canEdit: boolean;
  canOperate: boolean;
}) {
  const { tenantId, tenantName } = props;
  const [workspace, setWorkspace] = React.useState<WorkspaceResponse | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedStepKey, setSelectedStepKey] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<AutomationWorkspaceItem | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [actionOpen, setActionOpen] = React.useState(false);
  const [actionSearch, setActionSearch] = React.useState('');
  const [insertAfter, setInsertAfter] = React.useState(0);
  const [templateName, setTemplateName] = React.useState('');
  const [templateBody, setTemplateBody] = React.useState('');
  const [testOpen, setTestOpen] = React.useState(false);
  const [testTargetId, setTestTargetId] = React.useState('');

  const canEdit = props.canEdit || Boolean(workspace?.access?.canEdit);
  const canOperate = props.canOperate || Boolean(workspace?.access?.canOperate);

  const loadWorkspace = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/platform/tenants/${tenantId}/automations`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Falha ao carregar automações.');
      setWorkspace(payload as WorkspaceResponse);
      const preferred = (payload.automations as AutomationWorkspaceItem[]).find(
        (item) => item.id === selectedId,
      ) ?? payload.automations[0] ?? null;
      setSelectedId(preferred?.id ?? null);
      setSelectedStepKey(null);
      setDraft(preferred);
      setTestTargetId((payload.testTargets as TestTarget[])[0]?.threadId ?? '');
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao carregar automações.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedId, tenantId]);

  React.useEffect(() => {
    void loadWorkspace();
  }, [tenantId]);

  const selectAutomation = (automation: AutomationWorkspaceItem) => {
    setSelectedId(automation.id);
    setSelectedStepKey(null);
    setDraft(structuredClone(automation));
    setFeedback(null);
  };

  const patchDraft = (
    updater: (current: AutomationWorkspaceItem) => AutomationWorkspaceItem,
  ) => {
    setDraft((current) => (current ? updater(current) : current));
  };

  const createAutomation = async () => {
    if (!newName.trim()) return;
    setBusy('create');
    setFeedback(null);
    try {
      const response = await fetch(`/api/platform/tenants/${tenantId}/automations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Falha ao criar automação.');
      const automation = payload.automation as AutomationWorkspaceItem;
      setWorkspace((current) => current ? {
        ...current,
        automations: [automation, ...current.automations],
      } : current);
      setDraft(automation);
      setSelectedId(automation.id);
      setSelectedStepKey(null);
      setCreateOpen(false);
      setNewName('');
      setFeedback({ tone: 'success', text: 'Automação criada em modo simulação.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao criar automação.',
      });
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async () => {
    if (!draft) return null;
    setBusy('save');
    setFeedback(null);
    try {
      const response = await fetch(
        `/api/platform/tenants/${tenantId}/automations/${draft.id}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            name: draft.name,
            draftRevision: draft.draftRevision,
            triggerConfig: draft.triggerConfig,
            steps: draft.steps,
            edges: draft.edges,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Falha ao salvar rascunho.');
      const saved = payload.automation as AutomationWorkspaceItem;
      setDraft(saved);
      setWorkspace((current) => current ? {
        ...current,
        automations: current.automations.map(
          (item) => item.id === saved.id ? saved : item,
        ),
      } : current);
      setFeedback({ tone: 'success', text: 'Rascunho salvo.' });
      return saved;
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao salvar rascunho.',
      });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    setBusy('publish');
    try {
      const response = await fetch(
        `/api/platform/tenants/${tenantId}/automations/${saved.id}/publish`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { accept: 'application/json' },
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const issueText = Array.isArray(payload?.issues)
          ? payload.issues.map((issue: { message?: string }) => issue.message).filter(Boolean).join(' ')
          : '';
        throw new Error(issueText || payload?.error || 'Falha ao publicar.');
      }
      patchDraft((current) => ({ ...current, lifecycleStatus: 'published' }));
      setWorkspace((current) => current ? {
        ...current,
        automations: current.automations.map((item) => item.id === saved.id
          ? { ...item, lifecycleStatus: 'published' }
          : item),
      } : current);
      setFeedback({
        tone: 'success',
        text: `Versão ${payload.version} publicada. O envio real continua bloqueado.`,
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao publicar.',
      });
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    if (!draft || !testTargetId) return;
    setBusy('test');
    setFeedback(null);
    try {
      const response = await fetch(
        `/api/platform/tenants/${tenantId}/automations/${draft.id}/test`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ threadId: testTargetId }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Falha ao testar automação.');
      setTestOpen(false);
      setFeedback({
        tone: 'success',
        text: 'Teste executado em simulação. A mensagem apareceu no histórico, sem sair pelo WhatsApp.',
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao testar automação.',
      });
    } finally {
      setBusy(null);
    }
  };

  const addAction = (action: ActionDefinition['type']) => {
    if (!draft) return;
    const previousKeys = new Set(draft.steps.map((step) => step.stepKey));
    const next = insertAction(draft, insertAfter, action);
    const inserted = next.steps.find((step) => (
      !previousKeys.has(step.stepKey) && step.stepType === action
    ));
    setDraft(next);
    if (inserted) setSelectedStepKey(inserted.stepKey);
    setActionOpen(false);
    setActionSearch('');
  };

  const applyTemplate = (template: MessageTemplate, mode: 'copied' | 'linked') => {
    if (!selectedStepKey) return;
    patchDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => step.stepKey === selectedStepKey
        ? {
            ...step,
            config: {
              ...step.config,
              link_mode: mode,
              template_id: mode === 'linked' ? template.id : undefined,
              body_local: template.body,
              message_kind: 'text',
              channel: 'whatsapp',
            },
          }
        : step),
    }));
  };

  const createTemplate = async () => {
    if (!templateName.trim() || !templateBody.trim()) return;
    setBusy('template');
    try {
      const response = await fetch(
        `/api/platform/tenants/${tenantId}/automations/templates`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            name: templateName.trim(),
            body: templateBody.trim(),
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Falha ao salvar mensagem.');
      setWorkspace((current) => current ? {
        ...current,
        templates: [payload.template, ...current.templates],
      } : current);
      setTemplateName('');
      setTemplateBody('');
      setFeedback({ tone: 'success', text: 'Mensagem salva na biblioteca.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao salvar mensagem.',
      });
    } finally {
      setBusy(null);
    }
  };

  const filteredActions = ACTIONS.filter((action) => {
    const search = actionSearch.trim().toLowerCase();
    return !search || `${action.title} ${action.description} ${action.keywords}`
      .toLowerCase()
      .includes(search);
  });
  const selectedStep = draft?.steps.find(
    (step) => step.stepKey === selectedStepKey,
  ) ?? null;
  const moveBlockedMessage = draft && selectedStepKey
    ? getAutomationMoveBlock(selectedStepKey, draft.steps, draft.edges)
    : null;
  const moveTargets = draft && selectedStepKey && !moveBlockedMessage
    ? eligibleAutomationMoveTargets(selectedStepKey, draft.steps, draft.edges).map((edge) => {
        const from = draft.steps.find((step) => step.stepKey === edge.fromStepKey);
        const to = draft.steps.find((step) => step.stepKey === edge.toStepKey);
        return {
          edge,
          label: `Entre ${from ? automationStepName(from) : 'passo anterior'} e ${
            to ? automationStepName(to) : 'passo seguinte'
          }`,
        };
      })
    : [];

  const applyStepMove = (
    stepKey: string,
    targetEdge: AutomationBuilderEdge,
  ) => {
    if (!draft) return;
    try {
      const moved = moveAutomationStep({
        stepKey,
        targetEdge,
        steps: draft.steps,
        edges: draft.edges,
      });
      setDraft({ ...draft, ...moved });
      setFeedback(null);
    } catch (error) {
      setFeedback({
        tone: 'warning',
        text: error instanceof Error ? error.message : 'Não foi possível mover este passo.',
      });
    }
  };

  const mutateSelectedSwitch = (
    mutation: (graph: {
      switchStepKey: string;
      steps: AutomationBuilderStep[];
      edges: AutomationBuilderEdge[];
    }) => { steps: AutomationBuilderStep[]; edges: AutomationBuilderEdge[] },
  ): string | null => {
    if (!draft || !selectedStepKey) return 'Selecione novamente o passo Divide caminho.';
    try {
      const changed = mutation({
        switchStepKey: selectedStepKey,
        steps: draft.steps,
        edges: draft.edges,
      });
      setDraft({ ...draft, ...changed });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Não foi possível alterar este caminho.';
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center gap-3 text-sm text-slate-500">
        <Loader2 size={18} className="animate-spin" />
        Carregando construtor...
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-white/10 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Workflow size={15} />
            {tenantName}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
            Automações
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Monte o gatilho e a sequência na mesma tela. Publicar cria uma versão; testar nunca envia ao paciente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
            <FlaskConical size={14} />
            Safe mode: envio real desligado
          </span>
          <Button type="button" onClick={() => setCreateOpen(true)} disabled={!canEdit}>
            <Plus size={16} className="mr-2" />
            Nova automação
          </Button>
        </div>
      </header>

      {workspace?.safeMode.liveEnabled ? (
        <div className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          Esta tela foi bloqueada porque o envio real está habilitado. Desative-o antes de testar.
        </div>
      ) : null}

      {feedback ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${feedbackClass(feedback.tone)}`}>
          {feedback.text}
        </div>
      ) : null}

      <div className="min-h-[650px]">
        <main>
          {!draft ? (
            <div className="flex h-full min-h-[500px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 text-center dark:border-white/10 dark:bg-card">
              <div>
                <Sparkles size={30} className="mx-auto text-cyan-500" />
                <h2 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">
                  Nenhuma automação criada
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Crie um fluxo curto e comece por uma mensagem editável.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <AutomationFlowToolbar
                automations={workspace?.automations ?? [draft]}
                selected={draft}
                onSelect={(automationId) => {
                  const automation = workspace?.automations.find(
                    (item) => item.id === automationId,
                  );
                  if (automation) selectAutomation(automation);
                }}
                actions={(
                  <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveDraft()}
                    disabled={!canEdit || Boolean(busy)}
                  >
                    {busy === 'save' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
                    Salvar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTestOpen(true)}
                    disabled={!canOperate || draft.lifecycleStatus !== 'published' || Boolean(busy)}
                  >
                    <FlaskConical size={16} className="mr-2" />
                    Testar
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void publish()}
                    disabled={!canEdit || Boolean(busy)}
                  >
                    {busy === 'publish' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Send size={16} className="mr-2" />}
                    Publicar
                  </Button>
                  </>
                )}
              />

              <div className="flex h-[62vh] min-h-[460px] flex-col overflow-hidden rounded-2xl border border-white/10">
              <AutomationFlowMap
                steps={draft.steps}
                edges={draft.edges}
                canEdit={canEdit}
                selectedStepKey={selectedStepKey}
                onStepActivate={setSelectedStepKey}
                onBackgroundActivate={() => setSelectedStepKey(null)}
                onMoveStep={applyStepMove}
                onAddAfter={(stepKey) => {
                  const index = draft.steps.findIndex((step) => step.stepKey === stepKey);
                  if (index < 0) return;
                  setInsertAfter(index);
                  setActionOpen(true);
                }}
              />
              <AutomationStepDock
                step={selectedStep}
                canEdit={canEdit}
                templates={workspace?.templates ?? []}
                templateName={templateName}
                templateBody={templateBody}
                templateBusy={busy === 'template'}
                moveTargets={moveTargets}
                moveBlockedMessage={moveBlockedMessage}
                onMove={(targetEdge) => {
                  if (selectedStepKey) applyStepMove(selectedStepKey, targetEdge);
                }}
                onAddSwitchCase={() => mutateSelectedSwitch(addAutomationSwitchCase)}
                onRemoveSwitchCase={(caseId) => mutateSelectedSwitch((graph) => (
                  removeAutomationSwitchCase({ ...graph, caseId })
                ))}
                onMoveSwitchCase={(caseId, direction) => mutateSelectedSwitch((graph) => (
                  moveAutomationSwitchCase({ ...graph, caseId, direction })
                ))}
                onConfig={(config) => {
                  if (!selectedStepKey) return;
                  patchDraft((current) => ({
                    ...current,
                    steps: current.steps.map((step) => (
                      step.stepKey === selectedStepKey ? { ...step, config } : step
                    )),
                  }));
                }}
                onClose={() => setSelectedStepKey(null)}
                onApplyTemplate={applyTemplate}
                onTemplateNameChange={setTemplateName}
                onTemplateBodyChange={setTemplateBody}
                onCreateTemplate={() => void createTemplate()}
              />
              </div>
            </div>
          )}
        </main>
      </div>

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nova automação"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createAutomation();
          }}
        >
          <label className="block space-y-1.5 text-sm font-medium">
            Nome da automação
            <input
              className={FIELD_CLASS}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ex.: Boas-vindas de novos leads"
              autoFocus
            />
          </label>
          <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500 dark:bg-white/5 dark:text-slate-300">
            Ela nasce como rascunho e só roda em simulação.
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!newName.trim() || busy === 'create'}>
              {busy === 'create' ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
              Criar automação
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={actionOpen}
        onClose={() => setActionOpen(false)}
        title="Adicionar ação"
        size="lg"
      >
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
          <span className="sr-only">Buscar ação</span>
          <input
            aria-label="Buscar ação"
            className={`${FIELD_CLASS} pl-9`}
            value={actionSearch}
            onChange={(event) => setActionSearch(event.target.value)}
            placeholder="Buscar mensagem, espera ou tarefa..."
          />
        </label>
        <div className="mt-4 space-y-2">
          {filteredActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.type}
                type="button"
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left transition hover:border-cyan-300 hover:bg-cyan-50/50 dark:border-white/10 dark:hover:border-cyan-500/30 dark:hover:bg-cyan-500/5"
                onClick={() => addAction(action.type)}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                  <Icon size={18} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                    {action.title}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {action.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Modal>

      <Modal
        isOpen={testOpen}
        onClose={() => setTestOpen(false)}
        title="Testar em uma conversa"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
            Nenhuma mensagem será enviada. O resultado fica marcado como “simulado” no histórico.
          </div>
          <label className="block space-y-1.5 text-sm font-medium">
            Conversa usada no teste
            <select
              className={FIELD_CLASS}
              value={testTargetId}
              onChange={(event) => setTestTargetId(event.target.value)}
            >
              <option value="">Selecione uma conversa</option>
              {(workspace?.testTargets ?? []).map((target) => (
                <option key={target.threadId} value={target.threadId}>
                  {target.label}{target.detail ? ` — ${target.detail}` : ''}
                </option>
              ))}
            </select>
          </label>
          {!workspace?.testTargets.length ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Crie uma conversa com contato, oportunidade e WhatsApp vinculados antes do teste.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setTestOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void runTest()} disabled={!testTargetId || busy === 'test'}>
              {busy === 'test' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <FlaskConical size={16} className="mr-2" />}
              Executar simulação
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function TenantAutomationsPage() {
  const { tenantId, tenant, access, loading, error } = useTenantDetail();
  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-cyan-600" />
      </div>
    );
  }
  if (error || !tenant) {
    return (
      <div className="mx-auto mt-8 max-w-xl rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        {error || 'Conta não encontrada.'}
      </div>
    );
  }
  return (
    <AutomationBuilderPage
      tenantId={tenantId}
      tenantName={tenant.name}
      canEdit={access.canEditAutomations}
      canOperate={access.canAccessAutomations}
    />
  );
}
