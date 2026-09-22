import { describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * Comportamento do vinculo entre a conversa, a reuniao do CRM e o evento do Google.
 *
 * Esta suite nasceu lendo o TEXTO dos arquivos (`expect(source).toContain(...)`), o que a revisao
 * adversarial de 22/09 reprovou com razao: aquilo quebrava em qualquer renomeacao e passava em
 * qualquer mudanca de comportamento que mantivesse a string. Agora tudo aqui executa codigo de
 * verdade contra o banco falso.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const THREAD = '33333333-3333-4333-8333-333333333333';
const ATIVIDADE = '44444444-4444-4444-8444-444444444444';
const OPERADOR = '55555555-5555-4555-8555-555555555555';
const AGORA = '2026-09-22T12:00:00.000Z';
const FUTURO = '2026-09-25T17:00:00.000Z';
const PASSADO = '2026-08-10T14:00:00.000Z';

vi.mock('server-only', () => ({}));

import { buildConversationHandoff } from '@/lib/conversations/handoff';
import { resolveConversationMeetingAction } from '@/lib/conversations/meetingHandoffAction';
import { persistConfirmedMeetingLink, resolveReusableMeetingActivityId } from '@/lib/conversations/aiReply';

function handoffDeReuniao() {
  return buildConversationHandoff({
    type: 'meeting_confirmed',
    eventId: ATIVIDADE,
    summary: 'Lead quer diagnóstico',
    reason: 'meeting_confirmed',
    requestedAt: '2026-09-22T11:00:00.000Z',
    requestedScheduleAt: FUTURO,
    contactName: 'Marina Souza',
    contactPhone: '5521999990000',
  });
}

describe('remarcar e cancelar recaem sobre a MESMA reuniao ja confirmada', () => {
  it('remarcar reusa a activity anterior em vez de abrir outra', () => {
    const resolvido = resolveConversationMeetingAction({
      organizationId: ORG,
      threadId: THREAD,
      handoff: handoffDeReuniao(),
      action: { type: 'adjust_meeting', scheduledAt: '2026-09-26T14:00:00-03:00' },
      performedAt: AGORA,
      performedBy: OPERADOR,
      previousActivityId: ATIVIDADE,
    });

    // Mesma activity = mesmo evento no Google: e o que impede evento orfao na agenda.
    expect(resolvido.activityId).toBe(ATIVIDADE);
    expect(resolvido.cancelled).toBe(false);
    // Remarcado pelo operador: o card mostra o horario novo como ajustado, nao como pendente.
    expect(resolvido.handoff).toMatchObject({
      type: 'meeting_confirmed',
      scheduleStatus: 'adjusted',
      requestedScheduleAt: '2026-09-26T17:00:00.000Z',
      scheduleUpdatedBy: OPERADOR,
    });
  });

  it('cancelar marca a reuniao como cancelada e guarda QUANDO foi cancelada', () => {
    const resolvido = resolveConversationMeetingAction({
      organizationId: ORG,
      threadId: THREAD,
      handoff: handoffDeReuniao(),
      action: { type: 'cancel_meeting' },
      performedAt: AGORA,
      performedBy: OPERADOR,
      previousActivityId: ATIVIDADE,
    });

    expect(resolvido).toMatchObject({ activityId: ATIVIDADE, cancelled: true });
    expect(resolvido.handoff).toMatchObject({
      type: 'other',
      reason: 'meeting_cancelled',
      requestedScheduleAt: null,
      // A tela mostra "Reunião cancelada em <data>" — sem isto o dado nunca chegava la.
      scheduleUpdatedAt: AGORA,
      scheduleUpdatedBy: OPERADOR,
    });
  });

  it('handoff que nao e de reuniao nao aceita acao de agenda', () => {
    const outro = buildConversationHandoff({
      type: 'other',
      eventId: null,
      summary: 'Reclamação',
      reason: 'human_handoff',
      requestedAt: AGORA,
      contactName: 'Marina',
      contactPhone: '5521999990000',
    });

    expect(() => resolveConversationMeetingAction({
      organizationId: ORG,
      threadId: THREAD,
      handoff: outro,
      action: { type: 'cancel_meeting' },
      performedAt: AGORA,
      performedBy: OPERADOR,
    })).toThrow('nao e um pedido de reuniao');
  });
});

describe('vinculo da conversa com a reuniao confirmada', () => {
  function bancoCom(activity: Record<string, unknown> | null, metadata: Record<string, unknown> = {}) {
    return createFakeSupabaseAdmin({
      activities: activity ? [activity] : [],
      conversation_threads: [{
        id: THREAD, organization_id: ORG, status: 'human_queue', metadata,
      }],
    });
  }

  it('reusa a activity anterior quando a reuniao ainda esta no futuro', async () => {
    const fake = bancoCom({
      id: ATIVIDADE, organization_id: ORG, date: FUTURO, completed: false, deleted_at: null,
    });

    await expect(resolveReusableMeetingActivityId({
      admin: fake as never, organizationId: ORG, activityId: ATIVIDADE, now: AGORA,
    })).resolves.toBe(ATIVIDADE);
  });

  it('NAO reusa reuniao que ja aconteceu: o historico dela nao pode ser reescrito', async () => {
    const fake = bancoCom({
      id: ATIVIDADE, organization_id: ORG, date: PASSADO, completed: false, deleted_at: null,
    });

    await expect(resolveReusableMeetingActivityId({
      admin: fake as never, organizationId: ORG, activityId: ATIVIDADE, now: AGORA,
    })).resolves.toBeNull();
  });

  it('NAO reusa reuniao concluida, apagada ou que nem existe mais', async () => {
    const concluida = bancoCom({
      id: ATIVIDADE, organization_id: ORG, date: FUTURO, completed: true, deleted_at: null,
    });
    const apagada = bancoCom({
      id: ATIVIDADE, organization_id: ORG, date: FUTURO, completed: false, deleted_at: AGORA,
    });
    const inexistente = bancoCom(null);

    for (const fake of [concluida, apagada, inexistente]) {
      await expect(resolveReusableMeetingActivityId({
        admin: fake as never, organizationId: ORG, activityId: ATIVIDADE, now: AGORA,
      })).resolves.toBeNull();
    }
  });

  it('grava o vinculo SEM depender do estado da conversa e sem apagar o resto da metadata', async () => {
    // O operador assumiu a conversa durante o envio: a escrita condicional da resposta casa zero
    // linhas e descartaria o vinculo junto. Ele e fato consumado — a activity ja esta reservada.
    const fake = bancoCom(null, { humanLocked: true, routingMode: 'human', unreadCount: 3 });

    await persistConfirmedMeetingLink({
      admin: fake as never, organizationId: ORG, threadId: THREAD, activityId: ATIVIDADE, now: AGORA,
    });

    const metadata = fake.rowsOf('conversation_threads')[0].metadata as Record<string, unknown>;
    expect(metadata.confirmedMeetingActivityId).toBe(ATIVIDADE);
    expect(metadata).toMatchObject({ humanLocked: true, routingMode: 'human', unreadCount: 3 });
  });

  it('nunca lança quando o banco recusa a escrita: a reuniao ja esta reservada', async () => {
    const fake = bancoCom(null);
    fake.failOn('conversation_threads', 'update', 'coluna inexistente');

    await expect(persistConfirmedMeetingLink({
      admin: fake as never, organizationId: ORG, threadId: THREAD, activityId: ATIVIDADE, now: AGORA,
    })).resolves.toBeUndefined();
  });
});
