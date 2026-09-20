import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: vi.fn() }));

import {
  CLOSING_REPLY_MAX,
  DEFAULT_MEETING_CHANNEL_TEXT,
  buildClosingReplyMetadata,
  buildClosingStageContext,
  readMeetingChannelText,
  resolveClosingReplyEligibility,
} from './closingReply';
import { buildConversationHandoff } from './handoff';

const AT = '2026-09-20T12:00:00.000Z';

function aiHandoffMetadata(type: 'meeting_confirmed' | 'human_requested' | 'call_accepted' | 'other' = 'meeting_confirmed', extra: Record<string, unknown> = {}) {
  const handoff = buildConversationHandoff({
    type,
    eventId: '11111111-1111-4111-8111-111111111111',
    summary: 'resumo',
    reason: 'Lead confirmou',
    requestedAt: AT,
    requestedScheduleAt: type === 'meeting_confirmed' ? '2026-09-22T17:00:00.000Z' : null,
    requestedScheduleText: null,
    contactName: 'Lead',
    contactPhone: '5521999990000',
  });
  return {
    humanLocked: true,
    routingMode: 'human',
    aiLockedReason: 'Lead confirmou',
    handoffRequestedAt: AT,
    handoffReason: 'Lead confirmou',
    lastHandoff: handoff,
    ...extra,
  };
}

describe('encerramento depois do handoff — quando a IA ainda pode responder', () => {
  it('responde na fila humana logo depois de um handoff feito por ela mesma', () => {
    const result = resolveClosingReplyEligibility({
      status: 'human_queue',
      metadata: aiHandoffMetadata(),
      now: '2026-09-20T12:05:00.000Z',
    });
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.handoff.type).toBe('meeting_confirmed');
      expect(result.repliesUsed).toBe(0);
    }
  });

  it('fica quieta quando um humano ja assumiu (human_active) ou a conversa esta com a IA', () => {
    expect(resolveClosingReplyEligibility({ status: 'human_active', metadata: aiHandoffMetadata() })).toMatchObject({ eligible: false, reason: 'status' });
    expect(resolveClosingReplyEligibility({ status: 'ai_active', metadata: aiHandoffMetadata() })).toMatchObject({ eligible: false, reason: 'status' });
  });

  it('fica quieta quando foi um humano que moveu a conversa para a fila (handoffRequestedAt novo)', () => {
    expect(resolveClosingReplyEligibility({
      status: 'human_queue',
      metadata: aiHandoffMetadata('meeting_confirmed', { handoffRequestedAt: '2026-09-20T12:30:00.000Z', handoffReason: 'human_handoff' }),
      now: '2026-09-20T12:31:00.000Z',
    })).toMatchObject({ eligible: false, reason: 'handoff_humano' });
    expect(resolveClosingReplyEligibility({ status: 'human_queue', metadata: { humanLocked: true } })).toMatchObject({ eligible: false, reason: 'sem_handoff' });
  });

  it('fica quieta quando a propria IA falhou (a conversa esta na fila por falha, nao por handoff)', () => {
    expect(resolveClosingReplyEligibility({
      status: 'human_queue',
      metadata: aiHandoffMetadata('meeting_confirmed', { handoffReason: 'ai_automation_failure', aiLockedReason: 'ai_failure_provider' }),
      now: '2026-09-20T12:05:00.000Z',
    })).toMatchObject({ eligible: false, reason: 'falha_da_ia' });
  });

  it('respeita a janela de 60 minutos e o limite de respostas', () => {
    expect(resolveClosingReplyEligibility({
      status: 'human_queue',
      metadata: aiHandoffMetadata(),
      now: '2026-09-20T13:01:00.000Z',
    })).toMatchObject({ eligible: false, reason: 'janela_expirada' });
    expect(resolveClosingReplyEligibility({
      status: 'human_queue',
      metadata: aiHandoffMetadata('meeting_confirmed', { aiClosingReplies: CLOSING_REPLY_MAX }),
      now: '2026-09-20T12:05:00.000Z',
    })).toMatchObject({ eligible: false, reason: 'limite' });
    const second = resolveClosingReplyEligibility({
      status: 'human_queue',
      metadata: aiHandoffMetadata('meeting_confirmed', { aiClosingReplies: 1 }),
      now: '2026-09-20T12:05:00.000Z',
    });
    expect(second).toMatchObject({ eligible: true, repliesUsed: 1 });
  });
});

describe('encerramento — situacao que entra no prompt', () => {
  it('reuniao confirmada: dia e hora locais, quem conduz, formato, e instrucao de encerrar', () => {
    const metadata = aiHandoffMetadata();
    const eligibility = resolveClosingReplyEligibility({ status: 'human_queue', metadata, now: '2026-09-20T12:05:00.000Z' });
    if (!eligibility.eligible) throw new Error('esperava elegivel');

    const context = buildClosingStageContext({
      handoff: eligibility.handoff,
      repliesUsed: 0,
      meetingHostName: 'Junior',
      timezone: 'America/Sao_Paulo',
      meetingChannelText: 'videochamada pelo Google Meet, o link chega por aqui',
    });

    expect(context).toContain('ENCERRAMENTO');
    expect(context).toContain('terça-feira, 22/09/2026 14:00');
    expect(context).toContain('conduzida por Junior');
    expect(context).toContain('videochamada pelo Google Meet');
    expect(context).toContain('sem oferecer horario nem ligacao');
    expect(context).not.toContain('ultima mensagem');
  });

  it('na segunda resposta avisa que e a ultima; pedido de pessoa e ligacao tem texto proprio', () => {
    const last = buildClosingStageContext({
      handoff: resolveClosingReplyEligibility({ status: 'human_queue', metadata: aiHandoffMetadata('human_requested'), now: '2026-09-20T12:05:00.000Z' }).eligible
        ? (resolveClosingReplyEligibility({ status: 'human_queue', metadata: aiHandoffMetadata('human_requested'), now: '2026-09-20T12:05:00.000Z' }) as { handoff: never }).handoff
        : (null as never),
      repliesUsed: 1,
      meetingHostName: 'Junior',
      timezone: 'America/Sao_Paulo',
      meetingChannelText: DEFAULT_MEETING_CHANNEL_TEXT,
    });
    expect(last).toContain('pediu uma pessoa');
    expect(last).toContain('ultima mensagem');
  });

  it('contabiliza a resposta e le o formato configurado no numero', () => {
    expect(buildClosingReplyMetadata({ lastDirection: 'outbound' }, { sentAt: AT, repliesUsed: 1 })).toEqual({
      lastDirection: 'outbound',
      aiClosingReplies: 2,
      aiClosingLastAt: AT,
    });
    expect(readMeetingChannelText({ meetingChannelText: '  ligacao pelo WhatsApp  ' })).toBe('ligacao pelo WhatsApp');
    expect(readMeetingChannelText({})).toBe(DEFAULT_MEETING_CHANNEL_TEXT);
  });
});
