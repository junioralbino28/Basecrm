import { describe, expect, it } from 'vitest';
import { buildConversationHandoff } from './handoff';
import {
  buildConversationThreadMetadataUpdate,
  readConversationThreadMetadata,
} from './threadMetadata';

describe('conversation thread metadata handoff', () => {
  it('persiste o ultimo handoff estruturado sem apagar metadata anterior', () => {
    const handoff = buildConversationHandoff({
      type: 'meeting_requested',
      summary: 'Lead quer marcar uma conversa.',
      reason: 'Pediu reuniao para amanha.',
      requestedAt: '2026-09-19T14:00:00.000Z',
      contactName: 'Marina',
      contactPhone: '5511999990000',
    });

    const metadata = buildConversationThreadMetadataUpdate(
      { campaign: 'cenoura-caixa', unreadCount: 2 },
      { handoff }
    );

    expect(metadata.campaign).toBe('cenoura-caixa');
    expect(metadata.lastHandoff).toEqual(handoff);
  });

  it('remove handoff adulterado ao ler metadata existente', () => {
    const metadata = readConversationThreadMetadata({
      lastHandoff: {
        type: 'admin_action',
        requestedAt: '2026-09-19T14:00:00.000Z',
        contactPhone: '5511999990000',
      },
    });

    expect(metadata.lastHandoff).toBeNull();
  });
});

describe('vinculo com a reuniao ja confirmada', () => {
  it('sobrevive ao handoff seguinte (que sobrescreve lastHandoff)', () => {
    const remarcacao = buildConversationHandoff({
      type: 'meeting_requested',
      reason: 'Lead quer remarcar.',
      requestedAt: '2026-09-22T14:00:00.000Z',
      contactName: 'Marina',
      contactPhone: '5511999990000',
    });

    const metadata = buildConversationThreadMetadataUpdate(
      { confirmedMeetingActivityId: '44444444-4444-4444-8444-444444444444' },
      { handoff: remarcacao },
    );

    // Sem isto, a reuniao antiga ficaria orfa no CRM e no Google (achado bloqueante).
    expect(metadata.confirmedMeetingActivityId).toBe('44444444-4444-4444-8444-444444444444');
    expect(metadata.lastHandoff).toEqual(remarcacao);
  });

  it('`null` explicito limpa o vinculo (cancelamento)', () => {
    const metadata = buildConversationThreadMetadataUpdate(
      { confirmedMeetingActivityId: '44444444-4444-4444-8444-444444444444' },
      { confirmedMeetingActivityId: null },
    );
    expect(metadata.confirmedMeetingActivityId).toBeNull();
  });

  it('le o vinculo de metadata existente e ignora lixo', () => {
    expect(readConversationThreadMetadata({
      confirmedMeetingActivityId: '44444444-4444-4444-8444-444444444444',
    }).confirmedMeetingActivityId).toBe('44444444-4444-4444-8444-444444444444');
    expect(readConversationThreadMetadata({ confirmedMeetingActivityId: 42 })
      .confirmedMeetingActivityId).toBeNull();
  });
});
