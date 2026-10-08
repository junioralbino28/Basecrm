import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Medição de tempo da resposta da IA chega ao que fica gravado (29/09). A geração mede as próprias
 * etapas (lib/conversations/aiReply.medicao.test.ts); aqui se prova que o webhook grava essa medição
 * na mensagem enviada, somando a espera antes da geração, e que a falha de provedor leva o resumo
 * para o registro da falha que o operador lê.
 */

const generateMock = vi.fn();
const executeMock = vi.fn();
const failureMock = vi.fn();
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
  loadFreshConversationAIGate: vi.fn(async () => ({
    ok: true,
    connection: {
      id: '22222222-2222-4222-8222-222222222222',
      organization_id: '11111111-1111-4111-8111-111111111111',
      name: 'Aurora',
      config: { aiEnabled: true, aiAgentName: 'Aurora', aiPromptKey: 'task_conversations_whatsapp_cenno_aurora' },
    },
  })),
}));
vi.mock('@/lib/conversations/conversationAIFailure', () => ({
  recordConversationAIFailure: (...args: unknown[]) => failureMock(...args),
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

const MEDICAO = {
  total_ms: 51_000,
  setup_ms: 300,
  calendar_ms: 700,
  model_ms: 50_000,
  model_http_calls: 3,
  model_http_errors: [529, 529],
  generations: 1,
  repaired: false,
};

async function responder(aiPendingToken: string) {
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

beforeEach(() => {
  generateMock.mockReset();
  executeMock.mockReset();
  failureMock.mockReset();
  failureMock.mockResolvedValue({ ok: true });
  executeMock.mockResolvedValue({ ok: true, warning: null, status: 'ai_active', thread: { metadata: {} } });
  generateMock.mockResolvedValue({
    ok: true,
    source: 'catalog',
    timing: MEDICAO,
    object: {
      replyText: 'Oi! Aqui e a Aurora, da CENNO HUB. Com quem eu falo?',
      summary: null,
      shouldHandoff: false,
      handoffType: null,
      handoffReason: null,
      requestedScheduleAt: null,
      requestedScheduleText: null,
    },
  });
});

describe('webhook: medicao de tempo da resposta da IA (29/09)', () => {
  it('grava ai_timing na mensagem enviada, com a espera desde a gravacao da mensagem do lead', async () => {
    // O token nasce `${mensagemId}:${Date.now()}` logo depois do insert; aqui, 5 s atras.
    await responder(`${MESSAGE}:${Date.now() - 5_000}`);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const timing = executeMock.mock.calls[0]?.[0]?.payload?.metadata?.ai_timing;
    expect(timing).toMatchObject(MEDICAO);
    expect(timing.queue_ms).toBeGreaterThanOrEqual(5_000);
    expect(timing.queue_ms).toBeLessThan(60_000);
  });

  it('token fora do formato: a medicao sai assim mesmo, com queue_ms null (nunca um numero inventado)', async () => {
    await responder('pending-token');

    const timing = executeMock.mock.calls[0]?.[0]?.payload?.metadata?.ai_timing;
    expect(timing).toMatchObject({ model_http_calls: 3, queue_ms: null });
  });

  it('falha do provedor: o registro da falha leva o resumo da medicao pendurada no erro', async () => {
    const erro = Object.assign(new Error('Overloaded'), { name: 'AI_RetryError', aiTiming: MEDICAO });
    generateMock.mockRejectedValue(erro);

    await responder(`${MESSAGE}:${Date.now()}`);

    expect(executeMock).not.toHaveBeenCalled();
    expect(failureMock).toHaveBeenCalledTimes(1);
    expect(failureMock.mock.calls[0]?.[0]).toMatchObject({ stage: 'provider' });
    expect(failureMock.mock.calls[0]?.[0]?.errorMessage).toContain('tempo 51.0s (modelo 50.0s, agenda 0.7s), 3 chamada(s), falhas 529,529');
  });

  it('G22: a segunda falha de formato chega ao registro e ao log sem o texto do modelo e sem a mensagem livre do erro', async () => {
    const SENTINELA = 'SENTINELA-WEBHOOK-5519';
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cru = `{"replyText": "o lead disse ${SENTINELA}`;
    generateMock.mockRejectedValueOnce(Object.assign(
      new Error(`No object generated: could not parse the response. Text: ${SENTINELA}`),
      { name: 'AI_NoObjectGeneratedError', text: cru, finishReason: 'length', aiTiming: MEDICAO },
    ));
    await responder(`${MESSAGE}:${Date.now()}`);
    const formato = String(failureMock.mock.calls[0]?.[0]?.errorMessage);
    expect(formato).not.toContain(SENTINELA);
    expect(formato).toContain(`AI_NoObjectGeneratedError | parada: length | saida: ${cru.length} caracteres, abre com chave, nao fecha`);
    expect(formato).toContain('falhas 529,529');

    const ultimoErro = Object.assign(new Error(`Overloaded ${SENTINELA}`), { statusCode: 529 });
    generateMock.mockRejectedValueOnce(Object.assign(new Error(`Failed after 3 attempts. Last error: ${SENTINELA}`), {
      name: 'AI_RetryError', lastError: ultimoErro,
    }));
    await responder(`${MESSAGE}:${Date.now()}`);
    const provedor = String(failureMock.mock.calls[1]?.[0]?.errorMessage);
    expect(provedor).toBe('AI_RetryError | HTTP 529');

    expect(avisos.mock.calls.map((c) => JSON.stringify(c)).join('\n')).not.toContain(SENTINELA);
    avisos.mockRestore();
  });
});
