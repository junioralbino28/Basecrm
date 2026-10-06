import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeConversationAIReplyMock = vi.fn();
const maybeSingleMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: maybeSingleMock }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/conversations/aiReply', () => ({
  executeConversationAIReply: (...args: unknown[]) => executeConversationAIReplyMock(...args),
}));

import { POST } from './route';

const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';
const THREAD_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'segredo-da-conexao';

function request(body: Record<string, unknown>) {
  return POST(new Request(
    `http://localhost:3000/api/public/channels/evolution/${CONNECTION_ID}/ai-reply`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: JSON.stringify(body),
    },
  ), { params: Promise.resolve({ connectionId: CONNECTION_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 60 }], error: null });
  maybeSingleMock.mockResolvedValue({
    data: {
      id: CONNECTION_ID,
      organization_id: '11111111-1111-4111-8111-111111111111',
      name: 'Comercial',
      config: { webhookSecret: SECRET, aiEnabled: true },
    },
    error: null,
  });
  executeConversationAIReplyMock.mockResolvedValue({ ok: true, warning: null });
});

describe('rota do n8n e o rastro nativo', () => {
  it('descarta as chaves de rastro e mantém o resto do metadata', async () => {
    const response = await request({
      threadId: THREAD_ID,
      replyText: 'Oi!',
      metadata: {
        native_ai: true,
        prompt_source: 'agent',
        prompt_sha256: 'a'.repeat(64),
        agent_id: 'forjado',
        agent_version: 99,
        ai_timing: { total_ms: 1 },
        campanha: 'meta',
      },
    });

    expect(response.status).toBe(200);
    const payload = executeConversationAIReplyMock.mock.calls[0][0].payload;
    expect(payload.metadata).toEqual({ campanha: 'meta' });
    expect(payload.automationSource).toBe('n8n');
    // Um pedido válido do n8n nunca leva evento de prova ao executor.
    expect('replyEvent' in payload).toBe(false);
  });

  it('corpo que tenta mandar o evento de prova é recusado pelo schema estrito (400) e nada é executado', async () => {
    // AIReplySchema é `.strict()`: campo fora da lista não chega ao executor (3ª rodada do Codex, achado 6).
    const response = await request({
      threadId: THREAD_ID,
      replyText: 'Oi!',
      replyEvent: { promptSha256: 'a'.repeat(64), promptKey: 'task_x', promptSource: 'default', agentId: null, agentVersion: null },
    });
    expect(response.status).toBe(400);
    expect(executeConversationAIReplyMock).not.toHaveBeenCalled();
  });

  it('sem metadata, continua sem metadata', async () => {
    await request({ threadId: THREAD_ID, replyText: 'Oi!' });
    expect(executeConversationAIReplyMock.mock.calls[0][0].payload.metadata).toBeUndefined();
  });
});
