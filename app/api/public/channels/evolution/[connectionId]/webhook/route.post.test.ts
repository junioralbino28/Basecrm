import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * TRAVA DO COMPORTAMENTO ATUAL DA ROTA INTEIRA (SPEC-midia-recebida v2, Passo 0).
 *
 * O parser devolver `null` para mensagem só de mídia é hoje o ÚNICO freio de uma máquina inteira:
 * contato, conversa, negócio, régua de automação, reabertura de conversa resolvida, evento de
 * "lead respondeu" e resposta da IA. Este arquivo prova, pelo POST de ponta a ponta, que nada disso
 * dispara com mídia sem texto, e congela o que o texto dispara. Com `config.media.mode` ausente ou
 * `off`, todos estes testes têm de continuar passando sem edição.
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
        name: 'Conexão de teste',
        config: { webhookSecret: SECRET, instanceName: 'teste', aiEnabled: true, ...config },
        metadata: {},
      },
    ],
    boards: [{ id: BOARD, organization_id: TENANT, name: 'Funil', key: 'funil', position: 0, created_at: '2026-01-01', deleted_at: null }],
    board_stages: [{ id: STAGE, organization_id: TENANT, board_id: BOARD, name: 'Novo', order: 0 }],
  });
}

function payload(message: Record<string, unknown>, id = 'MSG-1') {
  return {
    event: 'messages.upsert',
    instance: 'teste',
    data: {
      key: { id, remoteJid: JID, fromMe: false },
      pushName: 'Maria',
      message,
      messageTimestamp: 1_790_000_000,
    },
  };
}

async function post(body: unknown, secret: string | null = SECRET) {
  const response = await POST(
    new Request(`https://crm.test/api/public/channels/evolution/${CONNECTION}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(secret ? { 'x-webhook-secret': secret } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ connectionId: CONNECTION }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const rpcNames = () => fake.rpcCalls.map((call) => call.name);

/** Tudo que o webhook pode escrever, fora o carimbo de "último webhook" da própria conexão. */
function snapshotSemConexao() {
  const { channel_connections: _ignored, ...rest } = fake.tables;
  return JSON.stringify(rest);
}

beforeEach(() => {
  afterMock.mockClear();
  seed();
});

describe('POST do webhook: texto de número novo', () => {
  it('cria contato, conversa, mensagem e negócio, avisa a régua e agenda a IA', async () => {
    const result = await post(payload({ conversation: 'oi, quero saber mais' }));

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, direction: 'inbound' });

    const [contact] = fake.rowsOf('contacts');
    const [thread] = fake.rowsOf('conversation_threads');
    const [message] = fake.rowsOf('conversation_messages');
    const [deal] = fake.rowsOf('deals');

    expect(fake.rowsOf('contacts')).toHaveLength(1);
    expect(contact).toMatchObject({ organization_id: TENANT, name: 'Maria', status: 'ACTIVE', stage: 'LEAD' });

    expect(fake.rowsOf('conversation_threads')).toHaveLength(1);
    expect(thread).toMatchObject({ status: 'ai_active', contact_id: contact.id, contact_phone: contact.phone, deal_id: deal.id });
    expect((thread.metadata as Record<string, unknown>).aiPendingMessageId).toBe(message.id);

    expect(fake.rowsOf('conversation_messages')).toHaveLength(1);
    expect(message).toMatchObject({
      thread_id: thread.id,
      direction: 'inbound',
      message_type: 'conversation',
      content: 'oi, quero saber mais',
      provider_message_id: 'MSG-1',
    });
    expect(message.metadata).toEqual({ provider: 'evolution', event: 'messages.upsert', provider_message_id: 'MSG-1' });

    expect(fake.rowsOf('deals')).toHaveLength(1);
    expect(deal).toMatchObject({ board_id: BOARD, stage_id: STAGE, contact_id: contact.id, tags: ['whatsapp', 'novo-lead'] });
    expect((deal.custom_fields as Record<string, unknown>).first_inbound_preview).toBe('oi, quero saber mais');

    expect(rpcNames()).toEqual(['resolve_automation_wait_from_inbox']);
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(result.body).toMatchObject({ thread_id: thread.id, deal_id: deal.id, message_id: message.id });
  });

  it('imagem COM legenda entra como texto: content é a legenda crua e o metadata não ganha chave nova', async () => {
    await post(payload({ imageMessage: { caption: 'olha esse print', mimetype: 'image/jpeg' } }));

    const [message] = fake.rowsOf('conversation_messages');
    expect(message).toMatchObject({ message_type: 'imageMessage', content: 'olha esse print' });
    expect(message.metadata).toEqual({ provider: 'evolution', event: 'messages.upsert', provider_message_id: 'MSG-1' });
  });
});

describe('POST do webhook: mídia sem texto continua descartada de ponta a ponta', () => {
  const semTexto: Array<[string, Record<string, unknown>]> = [
    ['nota de voz', { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 21, ptt: true } }],
    ['imagem sem legenda', { imageMessage: { mimetype: 'image/jpeg' } }],
    ['figurinha', { stickerMessage: { mimetype: 'image/webp', isAnimated: false } }],
    ['GIF', { videoMessage: { mimetype: 'video/mp4', gifPlayback: true, seconds: 3 } }],
    ['imagem de ver uma vez', { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } }],
  ];

  it.each(semTexto)('%s de número novo: responde ignored e não cria nada', async (_nome, message) => {
    const result = await post(payload(message));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, ignored: true, reason: 'payload sem mensagem suportada' });

    for (const table of ['contacts', 'conversation_threads', 'conversation_messages', 'deals']) {
      expect(fake.rowsOf(table)).toHaveLength(0);
    }
    expect(fake.rpcCalls).toHaveLength(0);
    expect(afterMock).not.toHaveBeenCalled();

    const [connection] = fake.rowsOf('channel_connections');
    expect(connection.metadata).toMatchObject({
      lastWebhookAuthMode: 'secret',
      lastWebhookIgnoredReason: 'payload sem mensagem suportada',
    });
  });

  it.each(semTexto)('%s numa conversa RESOLVIDA com saída anterior: não reabre, não avisa régua, não marca "lead respondeu"', async (_nome, message) => {
    await post(payload({ conversation: 'oi' }, 'MSG-TEXTO'));
    const [thread] = fake.rowsOf('conversation_threads');
    thread.status = 'resolved';
    thread.metadata = { ...(thread.metadata as Record<string, unknown>), lastOutboundAt: '2026-09-20T12:00:00.000Z' };
    fake.rpcCalls.length = 0;
    afterMock.mockClear();
    const antes = snapshotSemConexao();

    const result = await post(payload(message, 'MSG-MIDIA'));

    expect(result.body).toEqual({ ok: true, ignored: true, reason: 'payload sem mensagem suportada' });
    expect(snapshotSemConexao()).toBe(antes);
    expect(fake.rowsOf('conversation_threads')[0].status).toBe('resolved');
    expect(fake.rpcCalls).toHaveLength(0);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('o MESMO cenário com texto dispara tudo: reabre a conversa, avisa a régua e marca "lead respondeu"', async () => {
    // Contraprova do teste acima: é isto que a mídia passaria a disparar para todos os números
    // se o descarte fosse removido sem a chave por conexão.
    await post(payload({ conversation: 'oi' }, 'MSG-TEXTO'));
    const [thread] = fake.rowsOf('conversation_threads');
    thread.status = 'resolved';
    thread.metadata = { ...(thread.metadata as Record<string, unknown>), lastOutboundAt: '2026-09-20T12:00:00.000Z' };
    fake.rpcCalls.length = 0;
    afterMock.mockClear();

    await post(payload({ conversation: 'voltei' }, 'MSG-TEXTO-2'));

    expect(fake.rowsOf('conversation_threads')[0].status).toBe('ai_active');
    expect(rpcNames()).toEqual(['resolve_automation_wait_from_inbox', 'record_lead_replied_event']);
    expect(afterMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST do webhook: segredo, reentrega e conexão sem IA', () => {
  it('segredo errado ou ausente: 401 e nada gravado', async () => {
    const errado = await post(payload({ conversation: 'oi' }), 'outro-segredo');
    const ausente = await post(payload({ conversation: 'oi' }), null);

    expect(errado.status).toBe(401);
    expect(ausente.status).toBe(401);
    expect(fake.rowsOf('conversation_messages')).toHaveLength(0);
    expect(fake.rowsOf('contacts')).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('conexão sem segredo configurado é recusada', async () => {
    seed({ webhookSecret: '' });
    const result = await post(payload({ conversation: 'oi' }));
    expect(result.status).toBe(401);
    expect(fake.rowsOf('conversation_messages')).toHaveLength(0);
  });

  it('reentrega do mesmo provider_message_id: duplicate, sem mensagem nova e sem segunda resposta da IA', async () => {
    const first = await post(payload({ conversation: 'oi' }));
    const second = await post(payload({ conversation: 'oi' }));

    expect(second.body).toMatchObject({ ok: true, duplicate: true, message_id: first.body.message_id, thread_id: first.body.thread_id });
    expect(fake.rowsOf('conversation_messages')).toHaveLength(1);
    expect(fake.rowsOf('deals')).toHaveLength(1);
    expect(rpcNames()).toEqual(['resolve_automation_wait_from_inbox', 'resolve_automation_wait_from_inbox']);
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it('conexão com a IA desligada: conversa vai para a fila humana, negócio nasce, IA não é agendada', async () => {
    seed({ aiEnabled: false });
    await post(payload({ conversation: 'oi' }));

    const [thread] = fake.rowsOf('conversation_threads');
    expect(thread.status).toBe('human_queue');
    expect((thread.metadata as Record<string, unknown>).aiPendingToken).toBeUndefined();
    expect(fake.rowsOf('deals')).toHaveLength(1);
    expect(rpcNames()).toEqual(['resolve_automation_wait_from_inbox']);
    expect(afterMock).not.toHaveBeenCalled();
  });
});
