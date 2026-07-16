import { describe, expect, it, vi } from 'vitest';

const createStaticAdminClientMock = vi.fn();
const generateConversationAutoReplyMock = vi.fn();

vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => createStaticAdminClientMock(),
}));
vi.mock('@/lib/conversations/aiReply', () => ({
  generateConversationAutoReply: (...args: unknown[]) => generateConversationAutoReplyMock(...args),
  executeConversationAIReply: vi.fn(),
}));

import { processDeferredAIReply } from './route';

describe('Evolution webhook — gate explícito de IA por número', () => {
  it('encerra antes de consultar a thread ou gerar resposta quando aiEnabled=false', async () => {
    await processDeferredAIReply({
      connectionId: '22222222-2222-4222-8222-222222222222',
      organizationId: '11111111-1111-4111-8111-111111111111',
      connectionName: 'Comercial',
      connectionProvider: 'evolution',
      connectionChannelType: 'whatsapp',
      connectionConfig: { aiEnabled: false },
      threadId: '33333333-3333-4333-8333-333333333333',
      contactId: null,
      dealId: null,
      contactName: 'Paciente',
      canonicalPhone: '5511999990000',
      insertedMessageId: '44444444-4444-4444-8444-444444444444',
      aiPendingToken: 'pending-token',
      aiDebounceMs: 0,
      automationWebhookUrl: '',
      expectedSecret: 'secret',
      requestSecret: 'secret',
      requestOrigin: 'http://localhost:3000',
    });

    expect(createStaticAdminClientMock).not.toHaveBeenCalled();
    expect(generateConversationAutoReplyMock).not.toHaveBeenCalled();
  });
});
