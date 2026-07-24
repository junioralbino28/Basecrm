// 30%: piso baixo o bastante pra enxergar um fluxo longo inteiro (o de 70%
// travava o overview — report do Junior no C2C, 2026-07-24).
export const AUTOMATION_MIN_ZOOM = 0.3;
export const AUTOMATION_MAX_ZOOM = 2;
export const AUTOMATION_VIEWPORT_PADDING = 68;

export type AutomationViewport = {
  x: number;
  y: number;
  scale: number;
};

export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

function clampZoom(scale: number) {
  return Math.min(AUTOMATION_MAX_ZOOM, Math.max(AUTOMATION_MIN_ZOOM, scale));
}

export function zoomAutomationViewportAt(
  viewport: AutomationViewport,
  requestedScale: number,
  anchor: Point,
): AutomationViewport {
  const scale = clampZoom(requestedScale);
  const contentX = (anchor.x - viewport.x) / viewport.scale;
  const contentY = (anchor.y - viewport.y) / viewport.scale;
  return {
    x: anchor.x - contentX * scale,
    y: anchor.y - contentY * scale,
    scale,
  };
}

export function fitAutomationViewport(
  container: Size,
  content: Size,
): AutomationViewport {
  if (
    container.width <= 0
    || container.height <= 0
    || content.width <= 0
    || content.height <= 0
  ) {
    return { x: 34, y: 34, scale: 1 };
  }

  const availableWidth = Math.max(1, container.width - AUTOMATION_VIEWPORT_PADDING);
  const availableHeight = Math.max(1, container.height - AUTOMATION_VIEWPORT_PADDING);
  const scale = clampZoom(Math.min(
    1,
    availableWidth / content.width,
    availableHeight / content.height,
  ));
  return {
    x: (container.width - content.width * scale) / 2,
    y: (container.height - content.height * scale) / 2,
    scale,
  };
}

// Mantém o zoom atual e desloca a câmera para deixar um ponto do conteúdo
// (ex.: o centro do passo selecionado) no centro da área visível. Usado quando a
// doca abre e encolhe o mapa — sem isso, o passo clicado sai da tela.
export function centerAutomationViewportOn(
  viewport: AutomationViewport,
  container: Size,
  contentPoint: Point,
): AutomationViewport {
  return {
    scale: viewport.scale,
    x: container.width / 2 - contentPoint.x * viewport.scale,
    y: container.height / 2 - contentPoint.y * viewport.scale,
  };
}

export function panAutomationViewport(
  origin: AutomationViewport,
  start: Point,
  current: Point,
): AutomationViewport {
  return {
    ...origin,
    x: origin.x + current.x - start.x,
    y: origin.y + current.y - start.y,
  };
}
