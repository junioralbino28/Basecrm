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

function request(body: Record<string, unknown> = { threadId: THREAD_ID, replyText: 'Oi!' }) {
  return POST(new Request(
    `http://localhost:3000/api/public/channels/evolution/${CONNECTION_ID}/ai-reply`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': SECRET,
      },
      body: JSON.stringify(body),
    },
  ), { params: Promise.resolve({ connectionId: CONNECTION_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({
    data: [{ allowed: true, retry_after_seconds: 60 }],
    error: null,
  });
});

describe('Evolution AI reply — kill switch', () => {
  it('bloqueia a rota externa quando aiEnabled=false', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: CONNECTION_ID,
        organization_id: '11111111-1111-4111-8111-111111111111',
        name: 'Comercial',
        config: { webhookSecret: SECRET, aiEnabled: false },
      },
      error: null,
    });

    const response = await request();

    expect(response.status).toBe(409);
    expect(executeConversationAIReplyMock).not.toHaveBeenCalled();
  });

  it('mantem a rota ativa quando aiEnabled=true', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: CONNECTION_ID,
        organization_id: '11111111-1111-4111-8111-111111111111',
        name: 'Comercial',
        config: { webhookSecret: SECRET, aiEnabled: true },
      },
      error: null,
    });
    executeConversationAIReplyMock.mockResolvedValue({ ok: true });

    const response = await request();

    expect(response.status).toBe(200);
    expect(executeConversationAIReplyMock).toHaveBeenCalledOnce();
  });

  it('bloqueia configuracao legada sem ativacao explicita', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: CONNECTION_ID,
        organization_id: '11111111-1111-4111-8111-111111111111',
        name: 'Comercial',
        config: { webhookSecret: SECRET },
      },
      error: null,
    });

    const response = await request();

    expect(response.status).toBe(409);
    expect(executeConversationAIReplyMock).not.toHaveBeenCalled();
  });

  it('recusa metadados externos excessivos antes de executar', async () => {
    const response = await request({
      threadId: THREAD_ID,
      replyText: 'Oi!',
      metadata: { excessivo: 'x'.repeat(5000) },
    });

    expect(response.status).toBe(400);
    expect(executeConversationAIReplyMock).not.toHaveBeenCalled();
  });

  it('responde 429 quando o limite distribuido foi consumido', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: CONNECTION_ID,
        organization_id: '11111111-1111-4111-8111-111111111111',
        name: 'Comercial',
        config: { webhookSecret: SECRET, aiEnabled: true },
      },
      error: null,
    });
    rpcMock.mockResolvedValueOnce({
      data: [{ allowed: false, retry_after_seconds: 37 }],
      error: null,
    });

    const response = await request();

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('37');
    expect(executeConversationAIReplyMock).not.toHaveBeenCalled();
  });
});
