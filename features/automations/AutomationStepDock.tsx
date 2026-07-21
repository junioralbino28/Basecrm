'use client';

import React from 'react';
import { BookOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';
import {
  automationStepKind,
  automationStepName,
} from './AutomationFlowMap';
import { AutomationSwitchEditor } from './AutomationSwitchEditor';

export type AutomationMessageTemplate = {
  id: string;
  name: string;
  channel: string;
  body: string;
  revision: number;
  updatedAt: string;
};

type AutomationStepDockProps = {
  step: AutomationBuilderStep | null;
  canEdit: boolean;
  templates: AutomationMessageTemplate[];
  templateName: string;
  templateBody: string;
  templateBusy: boolean;
  onConfig: (config: Record<string, unknown>) => void;
  moveTargets: Array<{ edge: AutomationBuilderEdge; label: string }>;
  moveBlockedMessage: string | null;
  onMove: (edge: AutomationBuilderEdge) => void;
  onAddSwitchCase: () => string | null;
  onRemoveSwitchCase: (caseId: string) => string | null;
  onMoveSwitchCase: (caseId: string, direction: 'up' | 'down') => string | null;
  onClose: () => void;
  onApplyTemplate: (
    template: AutomationMessageTemplate,
    mode: 'copied' | 'linked',
  ) => void;
  onTemplateNameChange: (value: string) => void;
  onTemplateBodyChange: (value: string) => void;
  onCreateTemplate: () => void;
};

const FIELD_CLASS =
  'w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:opacity-60';

export function AutomationStepDock({
  step,
  canEdit,
  templates,
  templateName,
  templateBody,
  templateBusy,
  onConfig,
  moveTargets,
  moveBlockedMessage,
  onMove,
  onAddSwitchCase,
  onRemoveSwitchCase,
  onMoveSwitchCase,
  onClose,
  onApplyTemplate,
  onTemplateNameChange,
  onTemplateBodyChange,
  onCreateTemplate,
}: AutomationStepDockProps) {
  const [moveTargetIndex, setMoveTargetIndex] = React.useState('');

  React.useEffect(() => {
    setMoveTargetIndex('');
  }, [step?.stepKey]);

  React.useEffect(() => {
    if (!step) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, step]);

  if (!step) return null;

  const isMessage = step.stepType === 'send_message';
  const isSwitch = step.stepType === 'switch';
  const setConfig = (key: string, value: unknown) => {
    onConfig({ ...step.config, [key]: value });
  };

  return (
    <section
      aria-label="Edição do passo"
      data-dock-size={isMessage || isSwitch ? 'tall' : 'compact'}
      className={[
        'relative flex-none overflow-hidden border-t border-white/10',
        'bg-[#0B100F] text-slate-100 shadow-2xl backdrop-blur',
        isMessage
          ? 'grid h-[262px] md:grid-cols-2'
          : isSwitch
            ? 'h-[300px]'
            : 'h-[156px]',
      ].join(' ')}
    >
      <button
        type="button"
        aria-label="Fechar edição"
        className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-400"
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </button>

      <div className="overflow-auto px-5 py-4">
        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
          Passo selecionado
        </div>
        <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
          {automationStepKind(step)}
        </div>
        <h3 className="mb-4 mt-1 pr-10 text-base font-semibold">
          {automationStepName(step)}
        </h3>

        {isMessage ? (
          <div className="space-y-3">
            <label className="block space-y-1.5 text-xs text-slate-300">
              Mensagem
              <textarea
                aria-label="Mensagem"
                className={`${FIELD_CLASS} min-h-[88px] resize-y`}
                value={String(step.config.body_local ?? '')}
                onChange={(event) => setConfig('body_local', event.target.value)}
                placeholder='Ex.: Olá, {{ contato.nome | default: "tudo bem" }}!'
                disabled={!canEdit || step.config.link_mode === 'linked'}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-teal-500 hover:text-teal-300 disabled:opacity-50"
                disabled={!canEdit || step.config.link_mode === 'linked'}
                onClick={() => setConfig(
                  'body_local',
                  `${String(step.config.body_local ?? '')}{{ contato.nome | default: "tudo bem" }}`,
                )}
              >
                + Nome do contato
              </button>
              {step.config.link_mode === 'linked' ? (
                <span className="rounded-lg bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-300">
                  Vinculada à biblioteca
                </span>
              ) : null}
            </div>
            <div className="border-l-2 border-rose-400/50 pl-3 text-xs text-slate-400">
              Se o envio falhar, este caminho encerra e a falha fica registrada.
            </div>
          </div>
        ) : null}

        {step.stepType === 'delay' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs text-slate-300">
              Quantidade
              <input
                aria-label="Quantidade"
                className={FIELD_CLASS}
                type="number"
                min={1}
                max={365}
                value={Number(step.config.amount ?? 1)}
                onChange={(event) => setConfig('amount', Number(event.target.value))}
                disabled={!canEdit}
              />
            </label>
            <label className="space-y-1.5 text-xs text-slate-300">
              Unidade
              <select
                aria-label="Unidade"
                className={FIELD_CLASS}
                value={String(step.config.unit ?? 'hours')}
                onChange={(event) => setConfig('unit', event.target.value)}
                disabled={!canEdit}
              >
                <option value="minutes">Minutos</option>
                <option value="hours">Horas</option>
                <option value="days">Dias</option>
              </select>
            </label>
          </div>
        ) : null}

        {step.stepType === 'wait_for_event' ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs text-slate-300">
                Tempo limite
                <input
                  className={FIELD_CLASS}
                  type="number"
                  min={1}
                  max={365}
                  value={Number(step.config.timeout_amount ?? 1)}
                  onChange={(event) => setConfig(
                    'timeout_amount',
                    Number(event.target.value),
                  )}
                  disabled={!canEdit}
                />
              </label>
              <label className="space-y-1.5 text-xs text-slate-300">
                Unidade
                <select
                  className={FIELD_CLASS}
                  value={String(step.config.timeout_unit ?? 'days')}
                  onChange={(event) => setConfig('timeout_unit', event.target.value)}
                  disabled={!canEdit}
                >
                  <option value="minutes">Minutos</option>
                  <option value="hours">Horas</option>
                  <option value="days">Dias</option>
                </select>
              </label>
            </div>
            <div className="text-xs text-slate-400">
              A resposta segue por “respondeu”; o prazo vencido segue por “não respondeu”.
            </div>
          </div>
        ) : null}

        {step.stepType === 'create_task' ? (
          <label className="block space-y-1.5 text-xs text-slate-300">
            Título da tarefa
            <input
              className={FIELD_CLASS}
              value={String(step.config.title ?? '')}
              onChange={(event) => setConfig('title', event.target.value)}
              disabled={!canEdit}
            />
          </label>
        ) : null}

        {step.stepType === 'condition' ? (
          <div className="border-l-2 border-teal-500/50 pl-3 text-xs text-slate-400">
            Os caminhos existentes aparecem no mapa.
          </div>
        ) : null}

        {isSwitch ? (
          <AutomationSwitchEditor
            step={step}
            canEdit={canEdit}
            onConfig={onConfig}
            onAddCase={onAddSwitchCase}
            onRemoveCase={onRemoveSwitchCase}
            onMoveCase={onMoveSwitchCase}
          />
        ) : null}

        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Mover pelo teclado
          </div>
          {moveBlockedMessage ? (
            <p className="mt-1.5 text-xs text-amber-300">{moveBlockedMessage}</p>
          ) : moveTargets.length ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 space-y-1 text-xs text-slate-300">
                Mover passo para
                <select
                  aria-label="Mover passo para"
                  className={FIELD_CLASS}
                  value={moveTargetIndex}
                  onChange={(event) => setMoveTargetIndex(event.target.value)}
                  disabled={!canEdit}
                >
                  <option value="">Escolha uma linha</option>
                  {moveTargets.map((target, index) => (
                    <option key={`${target.edge.fromStepKey}:${target.edge.outcome}:${target.edge.toStepKey}:${target.edge.order}`} value={index}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={!canEdit || moveTargetIndex === ''}
                onClick={() => {
                  const target = moveTargets[Number(moveTargetIndex)];
                  if (target) onMove(target.edge);
                }}
              >
                Mover passo
              </Button>
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-slate-500">
              Não há outra linha disponível fora deste caminho.
            </p>
          )}
        </div>
      </div>

      {isMessage ? (
        <div className="overflow-auto border-t border-white/10 px-5 py-4 md:border-l md:border-t-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-teal-400" />
            <h3 className="text-sm font-semibold">Biblioteca de mensagens</h3>
          </div>
          <div className="mt-3 space-y-2">
            {templates.length ? templates.map((template) => (
              <div
                key={template.id}
                className="rounded-lg border border-white/10 bg-slate-900 p-2.5"
              >
                <div className="text-xs font-semibold">{template.name}</div>
                <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                  {template.body}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-label={`Copiar ${template.name}`}
                    className="text-xs font-semibold text-teal-400 hover:text-teal-300"
                    onClick={() => onApplyTemplate(template, 'copied')}
                  >
                    Copiar
                  </button>
                  <button
                    type="button"
                    aria-label={`Vincular ${template.name}`}
                    className="text-xs font-semibold text-slate-400 hover:text-white"
                    onClick={() => onApplyTemplate(template, 'linked')}
                  >
                    Vincular
                  </button>
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-slate-500">
                Salve a primeira mensagem abaixo. Depois, ela ficará disponível para reutilizar em qualquer passo.
              </div>
            )}
          </div>
          <div className="mt-3 border-t border-dashed border-white/10 pt-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <input
                aria-label="Nome da mensagem"
                className={FIELD_CLASS}
                value={templateName}
                onChange={(event) => onTemplateNameChange(event.target.value)}
                placeholder="Nome para encontrar depois"
              />
              <input
                aria-label="Conteúdo da mensagem"
                className={FIELD_CLASS}
                value={templateBody}
                onChange={(event) => onTemplateBodyChange(event.target.value)}
                placeholder="Escreva a mensagem..."
              />
              <Button
                type="button"
                variant="outline"
                onClick={onCreateTemplate}
                disabled={
                  !templateName.trim()
                  || !templateBody.trim()
                  || templateBusy
                }
              >
                Salvar
              </Button>
            </div>
            {!templateName.trim() || !templateBody.trim() ? (
              <div className="mt-1.5 flex gap-1.5 text-[11px] text-rose-300">
                <span aria-hidden="true">↑</span>
                <span>Falta dar um nome e escrever a mensagem.</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
