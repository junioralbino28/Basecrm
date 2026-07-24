import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_MAX_ZOOM,
  AUTOMATION_MIN_ZOOM,
  centerAutomationViewportOn,
  fitAutomationViewport,
  panAutomationViewport,
  zoomAutomationViewportAt,
} from './automationViewport';

describe('automationViewport', () => {
  it('centraliza um ponto do conteúdo mantendo o zoom', () => {
    const centered = centerAutomationViewportOn(
      { x: 999, y: 999, scale: 1.5 },
      { width: 800, height: 400 },
      { x: 200, y: 100 },
    );
    // centro visível (400,200) menos o ponto*scale (300,150)
    expect(centered).toEqual({ x: 100, y: 50, scale: 1.5 });
  });

  it('ancora o zoom no ponto do cursor', () => {
    const zoomed = zoomAutomationViewportAt(
      { x: 30, y: 40, scale: 1 },
      1.5,
      { x: 230, y: 140 },
    );

    expect(zoomed).toEqual({ x: -70, y: -10, scale: 1.5 });
  });

  it('respeita o piso de 30% e o teto de 200%', () => {
    expect(zoomAutomationViewportAt(
      { x: 0, y: 0, scale: 1 },
      0.1,
      { x: 0, y: 0 },
    ).scale).toBe(AUTOMATION_MIN_ZOOM);
    expect(zoomAutomationViewportAt(
      { x: 0, y: 0, scale: 1 },
      4,
      { x: 0, y: 0 },
    ).scale).toBe(AUTOMATION_MAX_ZOOM);
  });

  it('ajusta um fluxo grande pra caber inteiro e centralizado', () => {
    const fitted = fitAutomationViewport(
      { width: 800, height: 500 },
      { width: 1600, height: 900 },
    );

    // available 732x432 → escala limitada pela largura: 732/1600
    expect(fitted.scale).toBe(0.4575);
    expect(fitted.x).toBe(34);
    expect(fitted.y).toBe(44.125);
  });

  it('move o mapa pela diferença entre início e cursor', () => {
    expect(panAutomationViewport(
      { x: 34, y: 34, scale: 1 },
      { x: 10, y: 15 },
      { x: 35, y: 5 },
    )).toEqual({ x: 59, y: 24, scale: 1 });
  });
});
