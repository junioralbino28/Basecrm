import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * Recuperação pela régua devolve a conversa para a IA (decisão do Junior, 28/09/2026).
 *
 * Caso real que motivou: o "oi" do Pedro em 28/09 resolveu o wait do Dia 1 do follow-up
 * (a régua parou e devolveu o card), mas a conversa estava `human_active` desde uma resposta
 * pelo celular dias antes — e a Aurora ignorou a mensagem (`thread_em_atendimento_humano`).
 * Conversa em régua é conversa que esfriou: quando o lead responde à mensagem da régua, a
 * conversa volta para a IA na hora e a Aurora responde ESTA mensagem, não só a próxima.
 */

const afterMock = vi.fn();
let fake: FakeSupabaseAdmin;

vi.mock('next/server', () => ({ after: (callback: unknown) => afterMock(callback) }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => fake,
}));
vi.mock('@/lib/conversations/aiReply', () => ({
  generateConversationAutoReply: vi.fn(),
  executeConversationAIReply: vi.fn(),
}));
vi.mock('@/lib/conversations/conversationAIGate', () => ({
  loadFreshConversationAIGate: vi.fn(),
}));
vi.mock('@/lib/conversations/conversationAIFailure', () => ({
  recordConversationAIFailure: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/conversations/conversationRateLimit', () => ({
  consumeConversationRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock('@/lib/conversations/n8nAutomation', () => ({
  notifyConversationAutomation: vi.fn(),
}));

import { POST } from './route';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const BOARD = '66666666-6666-4666-8666-666666666666';
const STAGE = '77777777-7777-4777-8777-777777777777';
const WAIT = '99999999-9999-4999-8999-999999999999';
const SECRET = 'segredo-de-teste';
const JID = '5521999990000@s.whatsapp.net';

function seed(config: Record<string, unknown> = {}) {
  fake = createFakeSupabaseAdmin({
    channel_connections: [
      {
        id: CONNECTION,
        organization_id: TENANT,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: 'Aurora',
        config: { webhookSecret: SECRET, instanceName: 'teste', aiEnabled: true, ...config },
        metadata: {},
      },
    ],
    boards: [{ id: BOARD, organization_id: TENANT, name: 'Funil', key: 'funil', position: 0, created_at: '2026-01-01', deleted_at: null }],
    board_stages: [{ id: STAGE, organization_id: TENANT, board_id: BOARD, name: 'Novo', order: 0 }],
  });
}

let timestamp = 1_791_000_000;
function payload(text: string, id: string, fromMe: boolean) {
  timestamp += 30;
  return {
    event: 'messages.upsert',
    instance: 'teste',
    data: {
      key: { id, remoteJid: JID, fromMe },
      pushName: fromMe ? 'Junior' : 'Pedro',
      message: { conversation: text },
      messageTimestamp: timestamp,
    },
  };
}

async function post(body: unknown) {
  const response = await POST(
    new Request(`https://crm.test/api/public/channels/evolution/${CONNECTION}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ connectionId: CONNECTION }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const thread = () => fake.rowsOf('conversation_threads')[0] as { status: string; metadata: Record<string, unknown> };

/** Deixa a conversa como a do Pedro: travada com o humano por resposta pelo celular. */
function travaComHumano() {
  Object.assign(thread(), {
    status: 'human_active',
    metadata: {
      ...thread().metadata,
      humanLocked: true,
      routingMode: 'human',
      aiLockedReason: 'manual_reply_from_device',
    },
  });
}

function reguaRespondida(duplicate = false) {
  fake.rpcResults.resolve_automation_wait_from_inbox = [
    { event_id: '88888888-8888-4888-8888-888888888888', wait_id: WAIT, resolution: 'conversation_fallback', duplicate },
  ];
}

function semWait() {
  fake.rpcResults.resolve_automation_wait_from_inbox = [
    { event_id: '88888888-8888-4888-8888-888888888888', wait_id: null, resolution: null, duplicate: false },
  ];
}

beforeEach(() => {
  afterMock.mockClear();
});

describe('webhook: resposta do lead que recupera a régua devolve a conversa para a IA', () => {
  it('conversa travada com humano: a resposta à régua religa a IA e agenda a resposta para ESTA mensagem', async () => {
    seed();
    await post(payload('oi, vi o anúncio', 'IN-1', false));
    travaComHumano();
    reguaRespondida();

    const result = await post(payload('oi', 'IN-2', false));

    expect(result.status).toBe(200);
    expect(thread().status).toBe('ai_active');
    expect(thread().metadata).toMatchObject({ humanLocked: false, routingMode: 'ai' });
    // A IA foi agendada para a própria mensagem que recuperou o lead.
    expect(thread().metadata.aiPendingMessageId).toBe(result.body.message_id);
  });

  it('caso positivo do detector: inbound SEM wait resolvido não religa nada (a conversa segue com o humano)', async () => {
    seed();
    await post(payload('oi, vi o anúncio', 'IN-1', false));
    travaComHumano();
    semWait();
    const pendenteAntes = thread().metadata.aiPendingMessageId;

    await post(payload('beleza', 'IN-2', false));

    expect(thread().status).toBe('human_active');
    expect(thread().metadata).toMatchObject({ humanLocked: true, routingMode: 'human' });
    expect(thread().metadata.aiPendingMessageId).toBe(pendenteAntes);
  });

  it('reenvio do webhook (duplicate=true) não desfaz um "assumir" humano posterior', async () => {
    seed();
    await post(payload('oi, vi o anúncio', 'IN-1', false));
    travaComHumano();
    reguaRespondida(true);

    await post(payload('oi', 'IN-2', false));

    expect(thread().status).toBe('human_active');
    expect(thread().metadata).toMatchObject({ humanLocked: true, routingMode: 'human' });
  });

  it('conexão com a IA desligada: a recuperação não religa (não existe IA para assumir)', async () => {
    seed({ aiEnabled: false });
    await post(payload('oi, vi o anúncio', 'IN-1', false));
    travaComHumano();
    reguaRespondida();

    await post(payload('oi', 'IN-2', false));

    expect(thread().status).toBe('human_active');
  });

  it('conversa que já estava com a IA: a recuperação não muda nada e a resposta é agendada como sempre', async () => {
    seed();
    await post(payload('oi, vi o anúncio', 'IN-1', false));
    expect(thread().status).toBe('ai_active');
    reguaRespondida();

    const result = await post(payload('oi de novo', 'IN-2', false));

    expect(thread().status).toBe('ai_active');
    expect(thread().metadata.aiPendingMessageId).toBe(result.body.message_id);
  });
});
