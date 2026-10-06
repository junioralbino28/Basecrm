import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Central de Agentes, fatia 1: número com agente responde mesmo com aiPromptKey inválida (o prompt vem do
 * agente) e o gerador recebe a chave NULA, nunca `undefined` (que viraria o prompt padrão). O metadata
 * registra o sha do prompt em toda resposta nativa e agente e versão só com agente. O payload leva o
 * `replyEvent` que vira o evento de prova depois da entrega.
 */
const generateMock = vi.fn();
const executeMock = vi.fn();
const gateMock = vi.fn();
const recordFailureMock = vi.fn();
let debounceRow: { status: string; metadata: Record<string, unknown> } = { status: 'ai_active', metadata: {} };

vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => buildFakeAdmin() }));
vi.mock('@/lib/conversations/aiReply', () => ({
  generateConversationAutoReply: (...args: unknown[]) => generateMock(...args),
  executeConversationAIReply: (...args: unknown[]) => executeMock(...args),
}));
vi.mock('@/lib/conversations/conversationAIGate', () => ({
  loadFreshConversationAIGate: (...args: unknown[]) => gateMock(...args),
}));
vi.mock('@/lib/conversations/conversationAIFailure', () => ({
  recordConversationAIFailure: (...args: unknown[]) => recordFailureMock(...args),
}));
vi.mock('@/lib/conversations/conversationRateLimit', () => ({ consumeConversationRateLimit: vi.fn() }));
vi.mock('@/lib/conversations/n8nAutomation', () => ({ notifyConversationAutomation: vi.fn() }));

import { processDeferredAIReply } from './route';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';
const AGENTE = '55555555-5555-4555-8555-555555555555';
const SHA = 'a'.repeat(64);
const PADRAO = 'task_conversations_whatsapp_auto_reply';

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

function conexao(config: Record<string, unknown>, aiAgentId: string | null) {
  return { ok: true, connection: { id: CONNECTION, organization_id: TENANT, name: 'Aurora', config, ai_agent_id: aiAgentId } };
}

async function responder(aiPendingToken = `${MESSAGE}:${Date.now()}`) {
  debounceRow = { status: 'ai_active', metadata: { aiPendingToken } };
  await processDeferredAIReply({
    connectionId: CONNECTION,
    organizationId: TENANT,
    connectionName: 'Aurora',
    connectionProvider: 'evolution',
    connectionChannelType: 'whatsapp',
    connectionConfig: { aiEnabled: true },
    threadId: THREAD,
    contactId: null,
    dealId: null,
    contactName: 'Pedro',
    canonicalPhone: '5511999990000',
    insertedMessageId: MESSAGE,
    inboundText: 'oi',
    aiPendingToken,
    aiDebounceMs: 0,
    automationWebhookUrl: '',
    expectedSecret: 'secret',
    requestSecret: 'secret',
    requestOrigin: 'http://localhost:3000',
  });
}

const RESPOSTA = {
  replyText: 'Oi! Aqui e a Aurora.', summary: null, shouldHandoff: false, handoffType: null, handoffReason: null,
  requestedScheduleAt: null, requestedScheduleText: null, leadEmail: null, leadSegment: null, leadName: null,
  leadCompany: null, capacityGate: null, suggestedTags: null, conversationEnded: false,
};
const MEDICAO = { total_ms: 1, setup_ms: 0, calendar_ms: 0, model_ms: 1, model_http_calls: 1, model_http_errors: [], generations: 1, repaired: false };

beforeEach(() => {
  generateMock.mockReset();
  executeMock.mockReset();
  gateMock.mockReset();
  recordFailureMock.mockReset();
  executeMock.mockResolvedValue({ ok: true, warning: null, status: 'ai_active', thread: { metadata: {} } });
  recordFailureMock.mockResolvedValue({ ok: true });
});

describe('webhook e o agente do número', () => {
  it('número com agente responde mesmo com chave inválida, passa a chave nula e grava agente, versão e sha', async () => {
    gateMock.mockResolvedValue(conexao({ aiEnabled: true, aiPromptKey: 'chave_invalida' }, AGENTE));
    generateMock.mockResolvedValue({ ok: true, source: 'agent', promptSha256: SHA, agent: { id: AGENTE, version: 3 }, timing: MEDICAO, object: RESPOSTA });

    await responder();

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0][0].promptKey).toBeNull();
    const payload = executeMock.mock.calls[0][0].payload;
    expect(payload.metadata).toMatchObject({ prompt_source: 'agent', prompt_sha256: SHA, agent_id: AGENTE, agent_version: 3 });
    expect(payload.replyEvent).toEqual({ promptSha256: SHA, promptKey: null, promptSource: 'agent', agentId: AGENTE, agentVersion: 3 });
  });

  it('número sem agente e chave inválida continua sem responder (missing_prompt, como hoje)', async () => {
    gateMock.mockResolvedValue(conexao({ aiEnabled: true, aiPromptKey: 'chave_invalida' }, null));

    await responder();

    expect(generateMock).not.toHaveBeenCalled();
  });

  it('número sem agente grava o sha do prompt, não ganha chave de agente, e o evento leva a chave usada', async () => {
    gateMock.mockResolvedValue(conexao({ aiEnabled: true }, null));
    generateMock.mockResolvedValue({ ok: true, source: 'default', promptSha256: SHA, agent: null, timing: MEDICAO, object: RESPOSTA });

    await responder();

    expect(generateMock.mock.calls[0][0].promptKey).toBe(PADRAO);
    const payload = executeMock.mock.calls[0][0].payload;
    expect(payload.metadata).toMatchObject({ prompt_source: 'default', prompt_sha256: SHA });
    expect('agent_id' in payload.metadata).toBe(false);
    expect('agent_version' in payload.metadata).toBe(false);
    expect(payload.replyEvent).toEqual({ promptSha256: SHA, promptKey: PADRAO, promptSource: 'default', agentId: null, agentVersion: null });
  });

  it('agente indisponível conta como falha de configuração', async () => {
    gateMock.mockResolvedValue(conexao({ aiEnabled: true }, AGENTE));
    generateMock.mockResolvedValue({ ok: false, reason: 'agent_unavailable' });

    await responder();

    expect(executeMock).not.toHaveBeenCalled();
    expect(recordFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'configuration',
      errorMessage: 'skipped: agent_unavailable',
    }));
  });
});
