import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDLE_NUDGE_DEFERRED_HOUR,
  DEFAULT_IDLE_NUDGE_DEFERRED_TEXT,
  DEFAULT_IDLE_NUDGE_DELAY_MINUTES,
  DEFAULT_IDLE_NUDGE_TEXT,
  DEFAULT_IDLE_NUDGE_TIMEZONE,
  buildIdleNudgeClearedMetadata,
  buildIdleNudgeScheduleMetadata,
  detectLeadDeferral,
  nextResumeAt,
  resolveIdleNudgeConfig,
  shouldScheduleIdleNudge,
} from './idleNudge';

/** Os campos do adiamento, no padrao — conexao ja gravada nao tem nenhum deles. */
const ADIAMENTO_PADRAO = {
  deferredResumeHour: DEFAULT_IDLE_NUDGE_DEFERRED_HOUR,
  deferredText: DEFAULT_IDLE_NUDGE_DEFERRED_TEXT,
  timezone: DEFAULT_IDLE_NUDGE_TIMEZONE,
};

describe('cutucada de inatividade — configuracao por numero', () => {
  it('sem configuracao: ligada, 15 minutos, texto neutro', () => {
    expect(resolveIdleNudgeConfig(undefined)).toEqual({
      enabled: true,
      delayMinutes: DEFAULT_IDLE_NUDGE_DELAY_MINUTES,
      text: DEFAULT_IDLE_NUDGE_TEXT,
      ...ADIAMENTO_PADRAO,
    });
    expect(resolveIdleNudgeConfig({ aiEnabled: true })).toEqual({
      enabled: true,
      delayMinutes: 15,
      text: DEFAULT_IDLE_NUDGE_TEXT,
      ...ADIAMENTO_PADRAO,
    });
  });

  it('respeita enabled=false mesmo com o resto invalido', () => {
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { enabled: false, delayMinutes: 'x' } }).enabled).toBe(false);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { enabled: false } })).toEqual({
      enabled: false,
      delayMinutes: 15,
      text: DEFAULT_IDLE_NUDGE_TEXT,
      ...ADIAMENTO_PADRAO,
    });
  });

  it('aceita prazo e texto proprios e volta ao padrao no que estiver fora da faixa', () => {
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { enabled: true, delayMinutes: 30, text: 'Oi, ainda por aqui.' } })).toEqual({
      enabled: true,
      delayMinutes: 30,
      text: 'Oi, ainda por aqui.',
      ...ADIAMENTO_PADRAO,
    });
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { delayMinutes: 0 } }).delayMinutes).toBe(15);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { delayMinutes: 1.5 } }).delayMinutes).toBe(15);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { delayMinutes: 24 * 60 + 1 } }).delayMinutes).toBe(15);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { text: '   ' } }).text).toBe(DEFAULT_IDLE_NUDGE_TEXT);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: 'lixo' })).toEqual({
      enabled: true,
      delayMinutes: 15,
      text: DEFAULT_IDLE_NUDGE_TEXT,
      ...ADIAMENTO_PADRAO,
    });
  });

  it('aceita hora de retomada, texto de retomada e fuso proprios; recusa o que nao vale', () => {
    const proprio = resolveIdleNudgeConfig({
      aiIdleNudge: { enabled: true, deferredResumeHour: 8, deferredText: 'Bom dia, voltando.', timezone: 'America/Manaus' },
    });
    expect(proprio.deferredResumeHour).toBe(8);
    expect(proprio.deferredText).toBe('Bom dia, voltando.');
    expect(proprio.timezone).toBe('America/Manaus');

    expect(resolveIdleNudgeConfig({ aiIdleNudge: { deferredResumeHour: 24 } }).deferredResumeHour).toBe(9);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { deferredResumeHour: -1 } }).deferredResumeHour).toBe(9);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { deferredResumeHour: 9.5 } }).deferredResumeHour).toBe(9);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { timezone: 'Marte/Olympus' } }).timezone).toBe(DEFAULT_IDLE_NUDGE_TIMEZONE);
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { deferredText: '  ' } }).deferredText).toBe(DEFAULT_IDLE_NUDGE_DEFERRED_TEXT);
  });

  it('meia-noite e hora valida de retomada (0 nao pode cair no padrao)', () => {
    expect(resolveIdleNudgeConfig({ aiIdleNudge: { deferredResumeHour: 0 } }).deferredResumeHour).toBe(0);
  });
});

describe('cutucada de inatividade — o lead adiou?', () => {
  it('reconhece o adiamento que motivou a regra', () => {
    // Caso real (Pulpitos Genesis, 23/09/2026): as 22h08 o lead adiou e as 22h25 a cutucada saiu.
    expect(detectLeadDeferral('ja e tarde, amanha eu te chamo')).toBe(true);
    expect(detectLeadDeferral('Amanhã eu te chamo')).toBe(true);
    expect(detectLeadDeferral('depois eu vejo isso com calma')).toBe(true);
    expect(detectLeadDeferral('mais tarde eu te falo')).toBe(true);
    expect(detectLeadDeferral('semana que vem a gente se fala')).toBe(true);
    expect(detectLeadDeferral('deixa pra segunda')).toBe(true);
    expect(detectLeadDeferral('agora nao da, to trabalhando')).toBe(true);
    expect(detectLeadDeferral('estou ocupado')).toBe(true);
  });

  it('nao confunde lead MARCANDO com lead adiando', () => {
    // Estes o lead esta avancando: cutucar em 15 minutos continua certo.
    expect(detectLeadDeferral('pode ser amanha de manha')).toBe(false);
    expect(detectLeadDeferral('amanha as 10 fica melhor pra mim')).toBe(false);
    expect(detectLeadDeferral('quanto custa?')).toBe(false);
    expect(detectLeadDeferral('oi')).toBe(false);
    expect(detectLeadDeferral('')).toBe(false);
    expect(detectLeadDeferral(null)).toBe(false);
  });
});

describe('cutucada de inatividade — hora de retomada', () => {
  it('22h08 com retomada as 9h vira 9h do DIA SEGUINTE, nao do mesmo dia', () => {
    // 2026-09-24T01:08Z = 23/09 22h08 em Sao Paulo.
    const retomada = nextResumeAt('2026-09-24T01:08:00.000Z', 9, 'America/Sao_Paulo');
    expect(retomada).toBe('2026-09-24T12:00:00.000Z'); // 24/09 as 9h em Sao Paulo
  });

  it('as 7h da manha com retomada as 9h e no MESMO dia', () => {
    // 2026-09-24T10:00Z = 24/09 07h00 em Sao Paulo.
    const retomada = nextResumeAt('2026-09-24T10:00:00.000Z', 9, 'America/Sao_Paulo');
    expect(retomada).toBe('2026-09-24T12:00:00.000Z');
  });

  it('a hora exata da retomada empurra para o dia seguinte (nunca vence no mesmo instante)', () => {
    const retomada = nextResumeAt('2026-09-24T12:00:00.000Z', 9, 'America/Sao_Paulo');
    expect(retomada).toBe('2026-09-25T12:00:00.000Z');
  });

  it('fuso invalido nao deixa a conversa sem cutucada: cai em 24h pelo relogio', () => {
    const retomada = nextResumeAt('2026-09-24T01:08:00.000Z', 9, 'Marte/Olympus');
    expect(retomada).toBe('2026-09-25T01:08:00.000Z');
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
      aiInactivityNudgeDeferred: false,
    });
  });

  it('com o lead adiando, vence na hora de retomada — nao em 15 minutos', () => {
    const scheduled = buildIdleNudgeScheduleMetadata({
      metadata: { lastInboundAt: '2026-09-24T01:07:00.000Z', lastDirection: 'outbound' },
      token: 'msg-1:idle-nudge:1',
      scheduledAt: '2026-09-24T01:08:00.000Z', // 23/09 22h08 em Sao Paulo
      delayMinutes: 15,
      deferred: true,
      deferredResumeHour: 9,
      timezone: 'America/Sao_Paulo',
    });

    expect(scheduled.aiInactivityNudgeDueAt).toBe('2026-09-24T12:00:00.000Z');
    expect(scheduled.aiInactivityNudgeDeferred).toBe(true);
    // O prazo normal continua gravado: e o que a conversa volta a usar na proxima mensagem.
    expect(scheduled.aiInactivityNudgeDelayMinutes).toBe(15);
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
      aiInactivityNudgeDeferred: null,
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
