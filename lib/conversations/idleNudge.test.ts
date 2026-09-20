import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDLE_NUDGE_DELAY_MINUTES,
  DEFAULT_IDLE_NUDGE_TEXT,
  buildIdleNudgeClearedMetadata,
  buildIdleNudgeScheduleMetadata,
  resolveIdleNudgeConfig,
  shouldScheduleIdleNudge,
} from './idleNudge';

describe('cutucada de inatividade — configuracao por numero', () => {
  it('sem configuracao: ligada, 15 minutos, texto neutro', () => {
    expect(resolveIdleNudgeConfig(undefined)).toEqual({
      enabled: true,
      delayMinutes: DEFAULT_IDLE_NUDGE_DELAY_MINUTES,
      text: DEFAULT_IDLE_NUDGE_TEXT,
    });
    expect(resolveIdleNudgeConfig({ aiEnabled: true })).toEqual({
      enabled: true,
      delayMinutes: 15,
      text: DEFAULT_IDLE_NUDGE_TEXT,
    });
  });

  it('respeita enabled=false mesmo com o resto invalido', () => {
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { enabled: false, delayMinutes: 'x' } }).enabled).toBe(false);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { enabled: false } })).toEqual({
      enabled: false,
      delayMinutes: 15,
      text: DEFAULT_IDLE_NUDGE_TEXT,
    });
  });

  it('aceita prazo e texto proprios e volta ao padrao no que estiver fora da faixa', () => {
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { enabled: true, delayMinutes: 30, text: 'Oi, ainda por aqui.' } })).toEqual({
      enabled: true,
      delayMinutes: 30,
      text: 'Oi, ainda por aqui.',
    });
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { delayMinutes: 0 } }).delayMinutes).toBe(15);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { delayMinutes: 1.5 } }).delayMinutes).toBe(15);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { delayMinutes: 24 * 60 + 1 } }).delayMinutes).toBe(15);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { text: '   ' } }).text).toBe(DEFAULT_IDLE_NUDGE_TEXT);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: 'lixo' })).toEqual({
      enabled: true,
      delayMinutes: 15,
      text: DEFAULT_IDLE_NUDGE_TEXT,
    });
  });
});

describe('cutucada de inatividade — agendamento na metadata da conversa', () => {
  it('vence delayMinutes depois do agendamento e preserva o resto da metadata', () => {
    const scheduled = buildIdleNudgeScheduleMetadata({
      metadata: { lastInboundAt: '2026-09-20T11:59:00.000Z', lastDirection: 'outbound', aiPendingToken: 'p1' },
      token: 'msg-1:idle-nudge:1',
      scheduledAt: '2026-09-20T12:00:00.000Z',
      delayMinutes: 15,
    });

    expect(scheduled).toMatchObject({
      lastInboundAt: '2026-09-20T11:59:00.000Z',
      lastDirection: 'outbound',
      aiPendingToken: 'p1',
      aiInactivityNudgeToken: 'msg-1:idle-nudge:1',
      aiInactivityNudgeScheduledAt: '2026-09-20T12:00:00.000Z',
      aiInactivityNudgeDueAt: '2026-09-20T12:15:00.000Z',
      aiInactivityNudgeDelayMinutes: 15,
    });
  });

  it('limpar zera token e vencimento e registra quando saiu', () => {
    const cleared = buildIdleNudgeClearedMetadata({
      metadata: {
        aiInactivityNudgeToken: 't',
        aiInactivityNudgeDueAt: '2026-09-20T12:15:00.000Z',
        aiInactivityNudgeScheduledAt: '2026-09-20T12:00:00.000Z',
        lastDirection: 'outbound',
      },
      sentAt: '2026-09-20T12:16:00.000Z',
    });

    expect(cleared).toEqual({
      aiInactivityNudgeToken: null,
      aiInactivityNudgeDueAt: null,
      aiInactivityNudgeScheduledAt: null,
      aiInactivityNudgeSentAt: '2026-09-20T12:16:00.000Z',
      lastDirection: 'outbound',
    });
    // sem sentAt, o ultimo envio registrado permanece
    expect(buildIdleNudgeClearedMetadata({
      metadata: { aiInactivityNudgeSentAt: '2026-09-20T10:00:00.000Z' },
    }).aiInactivityNudgeSentAt).toBe('2026-09-20T10:00:00.000Z');
  });

  it('agenda uma cutucada por silencio: so quando o lead falou depois da ultima cutucada', () => {
    expect(shouldScheduleIdleNudge({})).toBe(false);
    expect(shouldScheduleIdleNudge({ lastInboundAt: '2026-09-20T12:00:00.000Z' })).toBe(true);
    expect(shouldScheduleIdleNudge({
      lastInboundAt: '2026-09-20T12:00:00.000Z',
      aiInactivityNudgeSentAt: '2026-09-20T12:16:00.000Z',
    })).toBe(false);
    expect(shouldScheduleIdleNudge({
      lastInboundAt: '2026-09-20T12:30:00.000Z',
      aiInactivityNudgeSentAt: '2026-09-20T12:16:00.000Z',
    })).toBe(true);
  });
});
