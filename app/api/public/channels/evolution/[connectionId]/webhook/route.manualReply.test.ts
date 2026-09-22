import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * Resposta pelo aparelho pausa a IA (decisão do Junior, 21/09/2026), só nas conexões com
 * `config.manualReplyPausesAI`. O que a IA e o CRM enviam pela API não volta pelo webhook (medido no
 * preview: 72 respostas da IA, zero ecos); a mensagem de saída que chega aqui foi mandada do celular.
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

let timestamp = 1_790_000_000;
function payload(text: string, id: string, fromMe: boolean) {
  timestamp += 30;
  return {
    event: 'messages.upsert',
    instance: 'teste',
    data: {
      key: { id, remoteJid: JID, fromMe },
      pushName: fromMe ? 'Junior' : 'Maria',
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
const pauses = () => fake.rpcCalls.filter((call) => call.name === 'pause_automation_enrollments_for_thread');

beforeEach(() => {
  afterMock.mockClear();
});

describe('webhook: resposta pelo aparelho com a chave manualReplyPausesAI', () => {
  it('conversa da IA: a mensagem do celular passa a conversa para humano e pausa as réguas', async () => {
    seed({ manualReplyPausesAI: true });
    await post(payload('oi, vi o anúncio', 'IN-1', false));
    expect(thread().status).toBe('ai_active');
    const pendenteAntes = thread().metadata.aiPendingMessageId;

    const result = await post(payload('Oi Maria, aqui é o Junior', 'OUT-1', true));

    expect(result.status).toBe(200);
    expect(thread().status).toBe('human_active');
    expect(thread().metadata).toMatchObject({ humanLocked: true, routingMode: 'human', aiLockedReason: 'manual_reply_from_device' });
    expect(pauses()).toHaveLength(1);
    expect(pauses()[0].args).toMatchObject({ p_actor_id: null, p_reason: 'manual_reply_from_device' });

    // O lead responde: a conversa continua com o humano e a IA não é agendada.
    afterMock.mockClear();
    await post(payload('beleza, pode ser', 'IN-2', false));
    expect(thread().status).toBe('human_active');
    expect(thread().metadata.aiPendingMessageId).toBe(pendenteAntes);
  });

  it('conversa que o humano puxou pelo celular (número novo) já nasce com ele', async () => {
    seed({ manualReplyPausesAI: true });
    await post(payload('Oi Sônia, você entrou em contato pelo anúncio', 'OUT-1', true));
    expect(thread().status).toBe('human_active');
    expect(thread().metadata).toMatchObject({ humanLocked: true, routingMode: 'human', aiLockedReason: 'manual_reply_from_device' });

    await post(payload('oi! sim', 'IN-1', false));
    expect(thread().status).toBe('human_active');
    expect(thread().metadata.aiPendingMessageId).toBeUndefined();
  });

  it('conversa resolvida que recebe mensagem do celular volta para humano', async () => {
    seed({ manualReplyPausesAI: true });
    await post(payload('oi', 'IN-1', false));
    Object.assign(thread(), { status: 'resolved' });

    await post(payload('Passando para saber se deu certo', 'OUT-1', true));

    // Quem decide é a coluna status. (resolvedAt na metadata não é limpo por nenhum caminho de reabertura:
    // buildConversationThreadMetadataUpdate trata null como "manter"; comportamento anterior, não mexido aqui.)
    expect(thread().status).toBe('human_active');
    expect(thread().metadata).toMatchObject({ humanLocked: true, aiLockedReason: 'manual_reply_from_device' });
  });

  it('conversa que já estava com humano: continua com ele e as réguas não são pausadas de novo', async () => {
    seed({ manualReplyPausesAI: true });
    await post(payload('oi', 'IN-1', false));
    Object.assign(thread(), { status: 'human_active' });

    await post(payload('Tô aqui', 'OUT-1', true));

    expect(thread().status).toBe('human_active');
    expect(pauses()).toHaveLength(0);
  });

  it('régua que não pausa vira aviso no sino, e a conversa fica com o humano mesmo assim', async () => {
    seed({ manualReplyPausesAI: true });
    await post(payload('oi', 'IN-1', false));
    fake.rpcErrors.pause_automation_enrollments_for_thread = 'deadlock detected';

    const result = await post(payload('Oi Maria, aqui é o Junior', 'OUT-1', true));

    expect(result.status).toBe(200);
    expect(thread().status).toBe('human_active');
    const avisos = fake.rowsOf('system_notifications').filter((row) => row.title === 'Régua não pausou');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ organization_id: TENANT, severity: 'high', type: 'SYSTEM_ALERT' });
    expect(String(avisos[0].link)).toContain('thread=');
  });

  it('reação e confirmação de leitura do próprio número não passam a conversa para humano', async () => {
    seed({ manualReplyPausesAI: true });
    await post(payload('oi, vi o anúncio', 'IN-1', false));

    const reacao = await post({
      event: 'messages.upsert',
      instance: 'teste',
      data: {
        key: { id: 'OUT-R', remoteJid: JID, fromMe: true },
        message: { reactionMessage: { key: { id: 'IN-1', remoteJid: JID, fromMe: false }, text: '👍' } },
        messageTimestamp: (timestamp += 30),
      },
    });
    const leitura = await post({
      event: 'messages.update',
      instance: 'teste',
      data: { key: { id: 'OUT-A', remoteJid: JID, fromMe: true }, update: { status: 3 } },
    });

    expect(reacao.body.ignored).toBe(true);
    expect(leitura.body.ignored).toBe(true);
    expect(thread().status).toBe('ai_active');
    expect(pauses()).toHaveLength(0);
  });
});

describe('webhook: sem a chave, a mensagem do celular não muda nada (como antes)', () => {
  it('conversa da IA continua com a IA e nenhuma régua é pausada', async () => {
    seed();
    await post(payload('oi, vi o anúncio', 'IN-1', false));
    await post(payload('Oi Maria, aqui é o Junior', 'OUT-1', true));

    expect(thread().status).toBe('ai_active');
    expect(thread().metadata.humanLocked).not.toBe(true);
    expect(thread().metadata.aiLockedReason ?? null).toBeNull();
    expect(pauses()).toHaveLength(0);
  });

  it('conversa nova puxada pelo celular nasce resolvida, como sempre', async () => {
    seed();
    await post(payload('Oi Sônia', 'OUT-1', true));
    expect(thread().status).toBe('resolved');
  });
});
