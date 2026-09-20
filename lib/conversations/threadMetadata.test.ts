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
