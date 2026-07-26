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
  type AutomationOrientation,
  layoutAutomationTree,
} from './automationTreeLayout';
import {
  centerAutomationViewportOn,
  fitAutomationViewport,
  panAutomationViewport,
  zoomAutomationViewportAt,
  type AutomationViewport,
} from './automationViewport';
import {
  eligibleAutomationMoveTargets,
  getAutomationMoveBlock,
} from './automationGraphMove';

// Deslocamento máximo (px) que ainda conta como clique num card, e não arrasto.
// Cobre o tremor natural da mão sem confundir com um arrasto deliberado.
const CLICK_SLOP = 10;
const EDGE_DROP_RADIUS = 150;

type AutomationFlowMapProps = {
  steps: AutomationBuilderStep[];
  edges: AutomationBuilderEdge[];
  canEdit: boolean;
  selectedStepKey: string | null;
  /** Direção do fluxo. Padrão vertical (desce); horizontal anda pra direita. */
  orientation?: AutomationOrientation;
  /** Identidade da automação exibida — trocar no seletor re-enquadra o mapa. */
  fitKey?: string | null;
  onStepActivate: (stepKey: string) => void;
  onBackgroundActivate?: () => void;
  onAddAfter: (stepKey: string) => void;
  onMoveStep?: (stepKey: string, targetEdge: AutomationBuilderEdge) => void;
};

type MapPress = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: AutomationViewport;
  stepKey: string | null;
  moved: boolean;
  captured: boolean;
  mode: 'pending' | 'panning' | 'sorting' | 'blocked';
  targetEdge: AutomationBuilderEdge | null;
};

function automationEdgeKey(edge: AutomationBuilderEdge) {
  return `${edge.fromStepKey}:${edge.outcome}:${edge.toStepKey}:${edge.order}`;
}

function toBuilderEdge(edge: AutomationBuilderEdge): AutomationBuilderEdge {
  return {
    fromStepKey: edge.fromStepKey,
    outcome: edge.outcome,
    toStepKey: edge.toStepKey,
    order: edge.order,
  };
}

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
  orientation = 'vertical',
  fitKey,
  onStepActivate,
  onBackgroundActivate,
  onAddAfter,
  onMoveStep,
}: AutomationFlowMapProps) {
  const layout = React.useMemo(
    () => layoutAutomationTree(steps, edges, orientation),
    [edges, orientation, steps],
  );
  const outgoingKeys = React.useMemo(
    () => new Set(edges.map((edge) => edge.fromStepKey)),
    [edges],
  );
  const contentWidth = Math.max(layout.width, 720);
  const contentHeight = Math.max(layout.height, 492);
  const stageRef = React.useRef<HTMLElement>(null);
  const pressRef = React.useRef<MapPress | null>(null);
  const warningTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPanning, setIsPanning] = React.useState(false);
  const [draggingStepKey, setDraggingStepKey] = React.useState<string | null>(null);
  const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });
  const [dropTargetKey, setDropTargetKey] = React.useState<string | null>(null);
  const [moveWarning, setMoveWarning] = React.useState<string | null>(null);
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
    // Encaixa pelo contorno REAL da árvore (layout.width/height), não pela caixa
    // mínima inflada (720x492) — senão um fluxo pequeno fica ancorado no canto
    // superior-esquerdo dessa caixa em vez de centralizado.
    setViewport(fitAutomationViewport(
      { width: bounds.width, height: bounds.height },
      {
        width: layout.width || contentWidth,
        height: layout.height || contentHeight,
      },
    ));
  }, [contentHeight, contentWidth, layout]);

  // Traz o passo dado ao centro da área visível, mantendo o zoom atual.
  const centerOnStep = React.useCallback((stepKey: string) => {
    const stage = stageRef.current;
    if (!stage) return;
    const node = layout.nodes.find((item) => item.step.stepKey === stepKey);
    if (!node) return;
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    setViewport((current) => centerAutomationViewportOn(
      current,
      { width: bounds.width, height: bounds.height },
      {
        x: node.x + AUTOMATION_NODE_WIDTH / 2,
        y: node.y + AUTOMATION_NODE_HEIGHT / 2,
      },
    ));
  }, [layout]);

  // Refs para o ResizeObserver enxergar o estado atual sem recriar o observer.
  // Sincronizados em efeito (mutar ref durante o render é anti-pattern).
  const selectedRef = React.useRef(selectedStepKey);
  const centerRef = React.useRef(centerOnStep);
  const didFitRef = React.useRef(false);

  React.useEffect(() => {
    selectedRef.current = selectedStepKey;
    centerRef.current = centerOnStep;
  });

  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handleResize = () => {
      if (!didFitRef.current) {
        // Primeiro cálculo (montagem): encaixa o fluxo inteiro.
        didFitRef.current = true;
        fitMap();
      } else if (selectedRef.current) {
        // Resize causado pela doca abrindo: em vez de re-encaixar tudo (que
        // recentraliza na vertical e joga o gatilho pra fora), mantém o zoom e
        // traz o passo selecionado pro centro visível.
        centerRef.current(selectedRef.current);
      }
      // Sem passo selecionado (doca fechou): preserva o viewport atual.
    };
    if (typeof ResizeObserver === 'undefined') {
      const frame = requestAnimationFrame(() => {
        didFitRef.current = true;
        fitMap();
      });
      return () => cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(handleResize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fitMap]);

  // Trocar de passo com a doca já aberta (o stage não muda de tamanho, então o
  // ResizeObserver não dispara) também precisa recentralizar.
  React.useEffect(() => {
    if (selectedStepKey) centerRef.current(selectedStepKey);
  }, [selectedStepKey]);

  // Trocar de automação no seletor: o mapa fica montado, então o fit da
  // montagem não roda de novo — re-enquadra o fluxo novo (Reforma 1).
  const fitRef = React.useRef(fitMap);
  React.useEffect(() => { fitRef.current = fitMap; });
  React.useEffect(() => {
    if (!didFitRef.current) return; // a montagem já vai enquadrar
    fitRef.current();
  }, [fitKey]);

  React.useEffect(() => () => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
  }, []);

  const showMoveWarning = React.useCallback((message: string) => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    setMoveWarning(message);
    warningTimerRef.current = setTimeout(() => setMoveWarning(null), 2_600);
  }, []);

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
    setDraggingStepKey(null);
    setDropTargetKey(null);
    setDragOffset({ x: 0, y: 0 });
    return press;
  };

  return (
    <section
      ref={stageRef}
      aria-label="Mapa da automação"
      className={`relative min-h-0 flex-1 touch-none overflow-hidden bg-[#0F1614] text-slate-100 ${
        isPanning || draggingStepKey ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      data-sorting={draggingStepKey ? 'true' : undefined}
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
          mode: 'pending',
          targetEdge: null,
        };
      }}
      onPointerMove={(event) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        const dx = event.clientX - press.startX;
        const dy = event.clientY - press.startY;
        const travel = Math.hypot(dx, dy);

        if (press.stepKey) {
          if (press.mode === 'pending' && travel <= CLICK_SLOP) return;
          if (press.mode === 'pending') {
            press.moved = true;
            const blocked = !canEdit
              ? 'Você não tem permissão para mover passos.'
              : getAutomationMoveBlock(press.stepKey, steps, edges);
            if (blocked) {
              press.mode = 'blocked';
              showMoveWarning(blocked);
            } else {
              press.mode = 'sorting';
              setDraggingStepKey(press.stepKey);
            }
            if (typeof event.currentTarget.setPointerCapture === 'function') {
              event.currentTarget.setPointerCapture(event.pointerId);
              press.captured = true;
            }
          }
          if (press.mode !== 'sorting') return;

          const bounds = event.currentTarget.getBoundingClientRect();
          const point = {
            x: (event.clientX - bounds.left - viewport.x) / viewport.scale,
            y: (event.clientY - bounds.top - viewport.y) / viewport.scale,
          };
          const eligibleKeys = new Set(
            eligibleAutomationMoveTargets(press.stepKey, steps, edges)
              .map(automationEdgeKey),
          );
          let nearest: typeof layout.edges[number] | null = null;
          let nearestDistance = EDGE_DROP_RADIUS;
          for (const edge of layout.edges) {
            if (!eligibleKeys.has(automationEdgeKey(edge))) continue;
            const distance = Math.hypot(
              point.x - edge.midpointX,
              point.y - edge.midpointY,
            );
            if (distance < nearestDistance) {
              nearest = edge;
              nearestDistance = distance;
            }
          }
          press.targetEdge = nearest ? toBuilderEdge(nearest) : null;
          setDropTargetKey(nearest ? automationEdgeKey(nearest) : null);
          // O cartão acompanha o cursor: sem isso a linha acende mas nada parece
          // estar se movendo, e não fica claro que o passo está sendo arrastado.
          // Divide pelo zoom porque o deslocamento é de tela e o cartão vive
          // dentro do track já escalado.
          setDragOffset({ x: dx / viewport.scale, y: dy / viewport.scale });
          return;
        }

        if (!press.moved && travel < 4) return;
        if (!press.moved) {
          press.moved = true;
          press.mode = 'panning';
          if (typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId);
            press.captured = true;
          }
        }
        setIsPanning(true);
        setViewport(panAutomationViewport(
          press.origin,
          { x: press.startX, y: press.startY },
          { x: event.clientX, y: event.clientY },
        ));
      }}
      onPointerUp={(event) => {
        const press = finishPointer(event.currentTarget, event.pointerId);
        if (!press) return;
        if (press.stepKey) {
          // Card: o limiar de 4px do pan é sensível demais e o tremor natural da
          // mão passava dele, matando o clique. Aqui um deslocamento pequeno
          // (CLICK_SLOP) ainda conta como clique e abre a edição. Um arrasto
          // grande sobre o card fica reservado para o mover-passo da C1C.
          const travel = Math.hypot(
            event.clientX - press.startX,
            event.clientY - press.startY,
          );
          if (press.mode === 'pending' && travel <= CLICK_SLOP) {
            onStepActivate(press.stepKey);
          } else if (press.mode === 'sorting' && press.targetEdge) {
            onMoveStep?.(press.stepKey, press.targetEdge);
          }
          return;
        }
        // Fundo: se arrastou, foi pan (não é clique).
        if (press.moved) return;
        onBackgroundActivate?.();
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
                  data-drop-target={
                    dropTargetKey === automationEdgeKey(edge) ? 'true' : undefined
                  }
                  d={edge.path}
                  fill="none"
                  stroke={
                    dropTargetKey === automationEdgeKey(edge)
                      ? 'rgb(45, 212, 191)'
                      : 'rgba(148, 163, 184, .48)'
                  }
                  strokeWidth={dropTargetKey === automationEdgeKey(edge) ? 4 : 2}
                  style={dropTargetKey === automationEdgeKey(edge)
                    ? { filter: 'drop-shadow(0 0 7px rgba(45, 212, 191, .8))' }
                    : undefined}
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
                      ? (orientation === 'vertical'
                          ? 'border-t-[3px] border-t-teal-500'
                          : 'border-l-[3px] border-l-teal-500')
                      : '',
                    isDecision(step)
                      ? 'border-t-[3px] border-t-teal-500 bg-teal-950/30'
                      : '',
                    isWait(step) ? 'border-dashed bg-transparent' : '',
                    draggingStepKey === step.stepKey
                      // Enquanto arrasta: sai da transição (senão o cartão fica
                      // "nadando" atrás do cursor), levanta acima dos outros e
                      // ganha contorno teal — fica claro que é ELE que se move.
                      ? 'z-20 !transition-none border-teal-400 opacity-95 shadow-2xl ring-2 ring-teal-400/60'
                      : '',
                  ].join(' ')}
                  style={{
                    left: x,
                    top: y,
                    minHeight: AUTOMATION_NODE_HEIGHT,
                    ...(draggingStepKey === step.stepKey
                      ? {
                          transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
                          cursor: 'grabbing',
                        }
                      : null),
                  }}
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
                    style={
                      orientation === 'vertical'
                        ? {
                            left: x + AUTOMATION_NODE_WIDTH / 2 - 12,
                            top: y + AUTOMATION_NODE_HEIGHT + 18,
                          }
                        : {
                            left: x + AUTOMATION_NODE_WIDTH + 18,
                            top: y + AUTOMATION_NODE_HEIGHT / 2 - 12,
                          }
                    }
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
      {moveWarning ? (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-amber-400/35 bg-amber-950/95 px-4 py-2 text-sm font-medium text-amber-100 shadow-xl"
        >
          {moveWarning}
        </div>
      ) : null}
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
