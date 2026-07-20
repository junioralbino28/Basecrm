'use client';

import React from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  GitBranch,
  Maximize2,
  MessageSquareText,
  Minus,
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
import {
  fitAutomationViewport,
  panAutomationViewport,
  zoomAutomationViewportAt,
  type AutomationViewport,
} from './automationViewport';

type AutomationFlowMapProps = {
  steps: AutomationBuilderStep[];
  edges: AutomationBuilderEdge[];
  canEdit: boolean;
  selectedStepKey: string | null;
  onStepActivate: (stepKey: string) => void;
  onBackgroundActivate?: () => void;
  onAddAfter: (stepKey: string) => void;
};

type MapPress = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: AutomationViewport;
  stepKey: string | null;
  moved: boolean;
  captured: boolean;
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
  onBackgroundActivate,
  onAddAfter,
}: AutomationFlowMapProps) {
  const layout = React.useMemo(() => layoutAutomationTree(steps, edges), [edges, steps]);
  const outgoingKeys = React.useMemo(
    () => new Set(edges.map((edge) => edge.fromStepKey)),
    [edges],
  );
  const contentWidth = Math.max(layout.width, 720);
  const contentHeight = Math.max(layout.height, 492);
  const stageRef = React.useRef<HTMLElement>(null);
  const pressRef = React.useRef<MapPress | null>(null);
  const [isPanning, setIsPanning] = React.useState(false);
  const [viewport, setViewport] = React.useState<AutomationViewport>({
    x: 34,
    y: 34,
    scale: 1,
  });

  const fitMap = React.useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    setViewport(fitAutomationViewport(
      { width: bounds.width, height: bounds.height },
      { width: contentWidth, height: contentHeight },
    ));
  }, [contentHeight, contentWidth]);

  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const frame = requestAnimationFrame(fitMap);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(fitMap);
    observer?.observe(stage);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [fitMap]);

  // O React registra onWheel como listener passivo, então o preventDefault dele é
  // ignorado e a página rola junto com o zoom. Prendemos o wheel na mão com
  // { passive: false } para o bloqueio valer.
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('[data-map-control]')) return;
      event.preventDefault();
      const bounds = stage.getBoundingClientRect();
      setViewport((current) => zoomAutomationViewportAt(
        current,
        event.deltaY < 0 ? current.scale * 1.1 : current.scale / 1.1,
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      ));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  const zoomAtStageCenter = (factor: number) => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setViewport((current) => zoomAutomationViewportAt(
      current,
      current.scale * factor,
      { x: bounds.width / 2, y: bounds.height / 2 },
    ));
  };

  const finishPointer = (stage: HTMLElement, pointerId: number) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== pointerId) return null;
    if (press.captured && stage.hasPointerCapture?.(pointerId)) {
      stage.releasePointerCapture(pointerId);
    }
    pressRef.current = null;
    setIsPanning(false);
    return press;
  };

  return (
    <section
      ref={stageRef}
      aria-label="Mapa da automação"
      className={`relative min-h-0 flex-1 touch-none overflow-hidden bg-[#0F1614] text-slate-100 ${
        isPanning ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(255,255,255,.07) 1px, transparent 0)',
        backgroundSize: '26px 26px',
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target as Element;
        if (target.closest('[data-map-control]')) return;
        const step = target.closest<HTMLElement>('[data-step-key]');
        pressRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          origin: viewport,
          stepKey: step?.dataset.stepKey ?? null,
          moved: false,
          captured: false,
        };
      }}
      onPointerMove={(event) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        const dx = event.clientX - press.startX;
        const dy = event.clientY - press.startY;
        if (!press.moved && Math.hypot(dx, dy) < 4) return;
        if (!press.moved) {
          press.moved = true;
          if (typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId);
            press.captured = true;
          }
        }
        if (press.stepKey) return;
        setIsPanning(true);
        setViewport(panAutomationViewport(
          press.origin,
          { x: press.startX, y: press.startY },
          { x: event.clientX, y: event.clientY },
        ));
      }}
      onPointerUp={(event) => {
        const press = finishPointer(event.currentTarget, event.pointerId);
        if (!press || press.moved) return;
        if (press.stepKey) onStepActivate(press.stepKey);
        else onBackgroundActivate?.();
      }}
      onPointerCancel={(event) => {
        finishPointer(event.currentTarget, event.pointerId);
      }}
    >
      <div
        data-testid="automation-track"
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: '0 0',
        }}
      >
        <div
          className="relative"
          style={{
            width: contentWidth,
            height: contentHeight,
          }}
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={contentWidth}
            height={contentHeight}
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
                  {step.stepType === 'send_message' ? (
                    <span className="mt-auto text-[10.5px] text-rose-400/85">
                      falha encerra
                    </span>
                  ) : null}
                </button>

                {!outgoingKeys.has(step.stepKey) ? (
                  <button
                    type="button"
                    data-map-control
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
      <div
        data-map-control
        className="absolute bottom-3.5 right-[18px] z-10 flex items-center gap-1 rounded-full border border-slate-700 bg-black/65 p-1 shadow-lg"
      >
        <button
          type="button"
          data-map-control
          aria-label="Afastar"
          className="grid h-8 w-8 place-items-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-400"
          onClick={() => zoomAtStageCenter(1 / 1.1)}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span
          aria-live="polite"
          className="min-w-12 text-center text-[11px] tabular-nums text-slate-400"
        >
          {Math.round(viewport.scale * 100)}%
        </span>
        <button
          type="button"
          data-map-control
          aria-label="Aproximar"
          className="grid h-8 w-8 place-items-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-400"
          onClick={() => zoomAtStageCenter(1.1)}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-map-control
          className="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-400"
          onClick={fitMap}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Ajustar
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3.5 left-[18px] rounded-full bg-black/55 px-3 py-1.5 text-[11px] text-slate-500">
        Arraste o fundo para mover · role para aplicar zoom
      </div>
    </section>
  );
}
