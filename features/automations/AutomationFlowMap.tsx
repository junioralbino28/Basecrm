'use client';

import React from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  GitBranch,
  MessageSquareText,
  Plus,
  Timer,
} from 'lucide-react';
import type {
  AutomationBuilderEdge,
  AutomationBuilderStep,
} from '@/lib/automations/builder';
import {
  AUTOMATION_NODE_HEIGHT,
  AUTOMATION_NODE_WIDTH,
  layoutAutomationTree,
} from './automationTreeLayout';

type AutomationFlowMapProps = {
  steps: AutomationBuilderStep[];
  edges: AutomationBuilderEdge[];
  canEdit: boolean;
  selectedStepKey: string | null;
  onStepActivate: (stepKey: string) => void;
  onAddAfter: (stepKey: string) => void;
};

const UNIT_LABELS: Record<string, [string, string]> = {
  minutes: ['minuto', 'minutos'],
  hours: ['hora', 'horas'],
  days: ['dia', 'dias'],
};

function durationLabel(amountValue: unknown, unitValue: unknown) {
  const amount = Number(amountValue);
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 1;
  const labels = UNIT_LABELS[String(unitValue)] ?? ['unidade', 'unidades'];
  return `${safeAmount} ${safeAmount === 1 ? labels[0] : labels[1]}`;
}

export function automationStepKind(step: AutomationBuilderStep) {
  if (step.stepType === 'send_message') return 'Envia · WhatsApp';
  if (step.stepType === 'delay') return 'Espera';
  if (step.stepType === 'wait_for_event') return 'Espera resposta';
  if (step.stepType === 'create_task') return 'Cria tarefa';
  if (step.stepType === 'move_stage' || step.stepType === 'move_pipeline') {
    return 'Move de funil';
  }
  if (step.stepType === 'condition' || step.stepType === 'switch') {
    return 'Divide caminho';
  }
  return 'Passo';
}

export function automationStepName(step: AutomationBuilderStep) {
  if (step.stepType === 'send_message') {
    const body = String(step.config.body_local ?? '').trim();
    return body || 'Mensagem sem conteúdo';
  }
  if (step.stepType === 'delay') {
    return durationLabel(step.config.amount, step.config.unit);
  }
  if (step.stepType === 'wait_for_event') {
    return `Até ${durationLabel(
      step.config.timeout_amount,
      step.config.timeout_unit,
    )}`;
  }
  if (step.stepType === 'create_task') {
    return String(step.config.title ?? '').trim() || 'Tarefa sem título';
  }
  if (step.stepType === 'condition' || step.stepType === 'switch') {
    return String(step.config.title ?? '').trim() || 'Qual caminho seguir?';
  }
  if (step.stepType === 'move_stage' || step.stepType === 'move_pipeline') {
    return 'Mover negócio';
  }
  return 'Passo sem título';
}

function StepIcon({ step }: { step: AutomationBuilderStep }) {
  const className = 'h-3.5 w-3.5';
  if (step.stepType === 'send_message') return <MessageSquareText className={className} />;
  if (step.stepType === 'delay') return <Timer className={className} />;
  if (step.stepType === 'wait_for_event') return <Clock3 className={className} />;
  if (step.stepType === 'create_task') return <CheckCircle2 className={className} />;
  if (step.stepType === 'condition' || step.stepType === 'switch') {
    return <GitBranch className={className} />;
  }
  return <ArrowRightLeft className={className} />;
}

function isDecision(step: AutomationBuilderStep) {
  return step.stepType === 'condition' || step.stepType === 'switch';
}

function isWait(step: AutomationBuilderStep) {
  return step.stepType === 'delay' || step.stepType === 'wait_for_event';
}

export function AutomationFlowMap({
  steps,
  edges,
  canEdit,
  selectedStepKey,
  onStepActivate,
  onAddAfter,
}: AutomationFlowMapProps) {
  const layout = React.useMemo(() => layoutAutomationTree(steps, edges), [edges, steps]);
  const outgoingKeys = React.useMemo(
    () => new Set(edges.map((edge) => edge.fromStepKey)),
    [edges],
  );

  return (
    <section
      aria-label="Mapa da automação"
      className="relative min-h-[560px] overflow-auto rounded-2xl border border-slate-800 bg-slate-950 text-slate-100"
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(255,255,255,.07) 1px, transparent 0)',
        backgroundSize: '26px 26px',
      }}
    >
      <div className="min-h-[560px] min-w-full p-[34px]">
        <div
          className="relative"
          style={{
            width: Math.max(layout.width, 720),
            height: Math.max(layout.height, 492),
          }}
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={Math.max(layout.width, 720)}
            height={Math.max(layout.height, 492)}
          >
            {layout.edges.map((edge) => (
              <React.Fragment
                key={`${edge.fromStepKey}:${edge.outcome}:${edge.toStepKey}`}
              >
                <path
                  data-edge-outcome={edge.outcome}
                  d={edge.path}
                  fill="none"
                  stroke="rgba(148, 163, 184, .48)"
                  strokeWidth="2"
                />
                {edge.label ? (
                  <foreignObject
                    x={edge.labelX}
                    y={edge.labelY - 13}
                    width={Math.max(104, AUTOMATION_NODE_WIDTH - 24)}
                    height="28"
                  >
                    <span
                      className="inline-flex whitespace-nowrap rounded-full border border-slate-600 bg-slate-900 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300"
                    >
                      {edge.label}
                    </span>
                  </foreignObject>
                ) : null}
              </React.Fragment>
            ))}
          </svg>

          {layout.nodes.map(({ step, depth, x, y }) => {
            const name = automationStepName(step);
            const selected = step.stepKey === selectedStepKey;
            return (
              <React.Fragment key={step.stepKey}>
                <button
                  type="button"
                  aria-current={selected ? 'step' : undefined}
                  aria-label={`${automationStepKind(step)}: ${name}`}
                  data-depth={depth}
                  data-step-key={step.stepKey}
                  className={[
                    'absolute flex min-h-24 w-[186px] flex-col gap-1 rounded-[10px]',
                    'border bg-slate-900 px-3.5 py-3 text-left text-slate-100',
                    'transition focus-visible:outline-2 focus-visible:outline-offset-2',
                    'focus-visible:outline-teal-400',
                    selected
                      ? 'border-teal-400 ring-1 ring-teal-400'
                      : 'border-slate-700 hover:border-slate-500',
                    step.stepType === 'send_message'
                      ? 'border-l-[3px] border-l-teal-500'
                      : '',
                    isDecision(step)
                      ? 'border-t-[3px] border-t-teal-500 bg-teal-950/30'
                      : '',
                    isWait(step) ? 'border-dashed bg-transparent' : '',
                  ].join(' ')}
                  style={{ left: x, top: y, minHeight: AUTOMATION_NODE_HEIGHT }}
                  onClick={(event) => {
                    if (event.detail === 0) onStepActivate(step.stepKey);
                  }}
                >
                  <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.13em] text-slate-500">
                    <StepIcon step={step} />
                    {automationStepKind(step)}
                  </span>
                  <span className="line-clamp-3 text-[13.5px] font-semibold leading-[1.3]">
                    {name}
                  </span>
                </button>

                {!outgoingKeys.has(step.stepKey) ? (
                  <button
                    type="button"
                    aria-label={`Adicionar passo após ${name}`}
                    className="absolute grid h-6 w-6 place-items-center rounded-full border border-dashed border-slate-600 bg-slate-950 text-slate-400 transition hover:border-teal-400 hover:text-teal-300 focus-visible:outline-2 focus-visible:outline-teal-400 disabled:opacity-40"
                    style={{
                      left: x + AUTOMATION_NODE_WIDTH + 18,
                      top: y + AUTOMATION_NODE_HEIGHT / 2 - 12,
                    }}
                    disabled={!canEdit}
                    onClick={() => onAddAfter(step.stepKey)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
}
