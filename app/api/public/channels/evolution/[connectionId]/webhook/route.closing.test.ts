import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateMock = vi.fn();
const executeMock = vi.fn();
const gateMock = vi.fn();
let debounceRow: { status: string; metadata: Record<string, unknown> } = { status: 'ai_active', metadata: {} };

vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => buildFakeAdmin(),
}));
vi.mock('@/lib/conversations/aiReply', () => ({
  generateConversationAutoReply: (...args: unknown[]) => generateMock(...args),
  executeConversationAIReply: (...args: unknown[]) => executeMock(...args),
}));
vi.mock('@/lib/conversations/conversationAIGate', () => ({
  loadFreshConversationAIGate: (...args: unknown[]) => gateMock(...args),
}));
vi.mock('@/lib/conversations/conversationAIFailure', () => ({
  recordConversationAIFailure: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/conversations/conversationRateLimit', () => ({
  consumeConversationRateLimit: vi.fn(),
}));
vi.mock('@/lib/conversations/n8nAutomation', () => ({
  notifyConversationAutomation: vi.fn(),
}));

import { processDeferredAIReply } from './route';
import { buildConversationHandoff } from '@/lib/conversations/handoff';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';

function buildFakeAdmin() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        update: () => builder,
        maybeSingle: () => Promise.resolve({ data: debounceRow, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: table === 'conversation_messages' ? [] : null, error: null }).then(resolve);
        },
      });
      return builder;
    },
  };
}

function handoffMetadata(extra: Record<string, unknown> = {}) {
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  const handoff = buildConversationHandoff({
    type: 'meeting_confirmed',
    eventId: '55555555-5555-4555-8555-555555555555',
    summary: null,
    reason: 'Lead confirmou',
    requestedAt: at,
    requestedScheduleAt: new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString(),
    requestedScheduleText: null,
    contactName: 'Lead',
    contactPhone: '5511999990000',
  });
  return {
    aiPendingToken: 'pending-token',
    humanLocked: true,
    routingMode: 'human',
    handoffRequestedAt: at,
    handoffReason: 'Lead confirmou',
    aiLockedReason: 'Lead confirmou',
    lastHandoff: handoff,
    ...extra,
  };
}

async function runDeferredReply(closingReply: boolean) {
  await processDeferredAIReply({
    connectionId: CONNECTION,
    organizationId: TENANT,
    connectionName: 'Aurora (teste)',
    connectionProvider: 'evolution',
    connectionChannelType: 'whatsapp',
    connectionConfig: { aiEnabled: true },
    threadId: THREAD,
    contactId: null,
    dealId: null,
    contactName: 'Lead',
    canonicalPhone: '5511999990000',
    insertedMessageId: MESSAGE,
    aiPendingToken: 'pending-token',
    aiDebounceMs: 0,
    automationWebhookUrl: 'https://n8n.example.com/hook',
    expectedSecret: 'secret',
    requestSecret: 'secret',
    requestOrigin: 'http://localhost:3000',
    closingReply,
  });
}

beforeEach(() => {
  generateMock.mockReset();
  executeMock.mockReset();
  gateMock.mockReset();
  gateMock.mockResolvedValue({
    ok: true,
    connection: {
      id: CONNECTION,
      organization_id: TENANT,
      name: 'Aurora (teste)',
      config: { aiEnabled: true, aiAgentName: 'Aurora', aiPromptKey: 'task_conversations_whatsapp_cenno_aurora' },
    },
  });
  generateMock.mockResolvedValue({
    ok: true,
    source: 'catalog',
    object: {
      replyText: 'Vai ser por videochamada; o Junior manda o link por aqui. Obrigada!',
      summary: null,
      shouldHandoff: false,
      handoffType: null,
      handoffReason: null,
      requestedScheduleAt: null,
      requestedScheduleText: null,
    },
  });
  executeMock.mockResolvedValue({ ok: true, warning: null, status: 'human_queue', thread: { metadata: {} } });
});

describe('Evolution webhook — encerramento depois do handoff', () => {
  it('na fila humana por handoff da IA, responde em modo encerramento e nao agenda cutucada', async () => {
    debounceRow = { status: 'human_queue', metadata: handoffMetadata() };

    await runDeferredReply(true);

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0]?.[0]).toMatchObject({
      closing: { repliesUsed: 0, handoff: { type: 'meeting_confirmed' } },
    });
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0]?.[0]).toMatchObject({
      payload: { closingReply: true, automationSource: 'native_crm', metadata: { closing_reply: true } },
    });
  });

  it('sem a marca de encerramento, a fila humana continua muda (comportamento antigo)', async () => {
    debounceRow = { status: 'human_queue', metadata: handoffMetadata() };

    await runDeferredReply(false);

    expect(generateMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('depois de duas respostas de encerramento, ou quando um humano moveu a conversa, fica quieta', async () => {
    debounceRow = { status: 'human_queue', metadata: handoffMetadata({ aiClosingReplies: 2 }) };
    await runDeferredReply(true);
    expect(generateMock).not.toHaveBeenCalled();

    debounceRow = { status: 'human_queue', metadata: handoffMetadata({ handoffRequestedAt: new Date().toISOString(), handoffReason: 'human_handoff' }) };
    await runDeferredReply(true);
    expect(generateMock).not.toHaveBeenCalled();

    debounceRow = { status: 'human_active', metadata: handoffMetadata() };
    await runDeferredReply(true);
    expect(generateMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('em modo normal (ai_active) a chamada nao carrega encerramento', async () => {
    debounceRow = { status: 'ai_active', metadata: { aiPendingToken: 'pending-token' } };

    await runDeferredReply(false);

    expect(generateMock.mock.calls[0]?.[0]).toMatchObject({ closing: null });
    expect(executeMock.mock.calls[0]?.[0]).toMatchObject({ payload: { closingReply: false } });
  });
});
