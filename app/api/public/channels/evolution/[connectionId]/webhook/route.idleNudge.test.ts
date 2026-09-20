import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateMock = vi.fn();
const executeMock = vi.fn();
const gateMock = vi.fn();
const threadUpdates: Array<{ table: string; payload: Record<string, unknown> }> = [];

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

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';

/** So o que processDeferredAIReply toca: checagem do debounce, historico e a gravacao do agendamento. */
let pendingTokenSeenByStaleCheck = 'pending-token';
let maybeSingleCalls = 0;

function buildFakeAdmin() {
  return {
    from(table: string) {
      let op: 'select' | 'update' = 'select';
      let payload: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        update(next: Record<string, unknown>) {
          op = 'update';
          payload = next;
          return builder;
        },
        maybeSingle: () => {
          maybeSingleCalls += 1;
          // 1a leitura: checagem do debounce; 2a: guarda de resposta obsoleta (token pode ter mudado)
          const token = maybeSingleCalls === 1 ? 'pending-token' : pendingTokenSeenByStaleCheck;
          return Promise.resolve({ data: { status: 'ai_active', metadata: { aiPendingToken: token } }, error: null });
        },
        then(resolve: (value: unknown) => unknown) {
          if (op === 'update' && payload) threadUpdates.push({ table, payload });
          return Promise.resolve({ data: table === 'conversation_messages' ? [] : null, error: null }).then(resolve);
        },
      });
      return builder;
    },
  };
}

function gateConnection(extraConfig: Record<string, unknown> = {}) {
  return {
    ok: true,
    connection: {
      id: CONNECTION,
      organization_id: TENANT,
      name: 'Aurora (teste)',
      config: {
        aiEnabled: true,
        aiAgentName: 'Aurora',
        aiPromptKey: 'task_conversations_whatsapp_cenno_aurora',
        ...extraConfig,
      },
    },
  };
}

async function runDeferredReply() {
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
    automationWebhookUrl: '',
    expectedSecret: 'secret',
    requestSecret: 'secret',
    requestOrigin: 'http://localhost:3000',
  });
}

beforeEach(() => {
  generateMock.mockReset();
  executeMock.mockReset();
  gateMock.mockReset();
  threadUpdates.length = 0;
  pendingTokenSeenByStaleCheck = 'pending-token';
  maybeSingleCalls = 0;
  gateMock.mockResolvedValue(gateConnection());
  generateMock.mockResolvedValue({
    ok: true,
    source: 'catalog',
    object: {
      replyText: 'Oi! Sua empresa ja anuncia hoje?',
      summary: null,
      shouldHandoff: false,
      handoffType: null,
      handoffReason: null,
      requestedScheduleAt: null,
      requestedScheduleText: null,
    },
  });
  executeMock.mockResolvedValue({
    ok: true,
    warning: null,
    status: 'ai_active',
    thread: {
      metadata: {
        aiPendingToken: 'pending-token',
        lastInboundAt: '2026-09-20T12:00:00.000Z',
        lastDirection: 'outbound',
      },
    },
  });
});

describe('Evolution webhook — cutucada de inatividade so e agendada, nunca enviada no pedido', () => {
  it('depois da resposta da IA grava o vencimento 15 minutos a frente e nao manda segunda mensagem', async () => {
    const startedAt = Date.now();

    await runDeferredReply();

    // so a resposta da IA saiu; a cutucada nao e enviada dentro do webhook
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0]?.[0]).toMatchObject({ payload: { automationSource: 'native_crm' } });
    // e nenhuma espera de 90 s ficou pelo caminho
    expect(Date.now() - startedAt).toBeLessThan(5_000);

    const scheduled = threadUpdates.find((update) => update.table === 'conversation_threads');
    expect(scheduled).toBeDefined();
    const metadata = scheduled!.payload.metadata as Record<string, unknown>;
    expect(metadata.aiInactivityNudgeToken).toMatch(new RegExp(`^${MESSAGE}:idle-nudge:`));
    expect(metadata.aiInactivityNudgeDelayMinutes).toBe(15);
    expect(
      new Date(String(metadata.aiInactivityNudgeDueAt)).getTime()
      - new Date(String(metadata.aiInactivityNudgeScheduledAt)).getTime(),
    ).toBe(15 * 60_000);
    // a metadata gravada pela resposta e preservada
    expect(metadata).toMatchObject({ lastDirection: 'outbound', lastInboundAt: '2026-09-20T12:00:00.000Z' });
  });

  it('usa o prazo configurado no numero', async () => {
    gateMock.mockResolvedValue(gateConnection({ aiIdleNudge: { enabled: true, delayMinutes: 30, text: 'x' } }));

    await runDeferredReply();

    const scheduled = threadUpdates.find((update) => update.table === 'conversation_threads');
    const metadata = scheduled!.payload.metadata as Record<string, unknown>;
    expect(metadata.aiInactivityNudgeDelayMinutes).toBe(30);
    expect(
      new Date(String(metadata.aiInactivityNudgeDueAt)).getTime()
      - new Date(String(metadata.aiInactivityNudgeScheduledAt)).getTime(),
    ).toBe(30 * 60_000);
  });

  it('nao agenda quando a cutucada esta desligada no numero', async () => {
    gateMock.mockResolvedValue(gateConnection({ aiIdleNudge: { enabled: false, delayMinutes: 15, text: 'x' } }));

    await runDeferredReply();

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(threadUpdates.filter((update) => update.table === 'conversation_threads')).toHaveLength(0);
  });

  it('nao agenda de novo enquanto o lead nao falar depois da ultima cutucada', async () => {
    executeMock.mockResolvedValue({
      ok: true,
      warning: null,
      status: 'ai_active',
      thread: {
        metadata: {
          lastInboundAt: '2026-09-20T12:00:00.000Z',
          lastDirection: 'outbound',
          aiInactivityNudgeSentAt: '2026-09-20T12:16:00.000Z',
        },
      },
    });

    await runDeferredReply();

    expect(threadUpdates.filter((update) => update.table === 'conversation_threads')).toHaveLength(0);
  });

  it('descarta a resposta quando chegou mensagem nova do lead durante a geracao', async () => {
    pendingTokenSeenByStaleCheck = 'pending-token-mais-novo';

    await runDeferredReply();

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(executeMock).not.toHaveBeenCalled();
    expect(threadUpdates.filter((update) => update.table === 'conversation_threads')).toHaveLength(0);
  });
});
