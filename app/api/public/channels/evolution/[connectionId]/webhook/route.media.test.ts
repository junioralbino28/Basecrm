import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * POST do webhook com a chave de mídia da conexão LIGADA (SPEC-midia-recebida v2, Passo 1).
 * O comportamento com a chave ausente ou `off` está travado em `route.post.test.ts`.
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
        name: 'Aurora (teste)',
        config: { webhookSecret: SECRET, instanceName: 'teste', aiEnabled: true, media: { mode: 'record' }, ...config },
        metadata: {},
      },
    ],
    boards: [{ id: BOARD, organization_id: TENANT, name: 'Funil', key: 'funil', position: 0, created_at: '2026-01-01', deleted_at: null }],
    board_stages: [{ id: STAGE, organization_id: TENANT, board_id: BOARD, name: 'Novo', order: 0 }],
  });
}

function payload(message: Record<string, unknown>, id = 'MSG-1', fromMe = false) {
  return {
    event: 'messages.upsert',
    instance: 'teste',
    data: {
      key: { id, remoteJid: JID, fromMe },
      pushName: 'Maria',
      message,
      messageTimestamp: 1_790_000_000,
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

const rpcNames = () => fake.rpcCalls.map((call) => call.name);
const AUDIO = { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 21, ptt: true, fileLength: '48211', url: 'https://mmg.whatsapp.net/x', mediaKey: 'CHAVE-DA-MIDIA' } };

beforeEach(() => {
  afterMock.mockClear();
  seed();
});

describe.each(['record', 'understand'])('POST do webhook com config.media.mode = %s', (mode) => {
  beforeEach(() => seed({ media: { mode } }));

  it('nota de voz de número novo: grava com selo, conta como mensagem do lead, NÃO agenda a IA e avisa no sino', async () => {
    const result = await post(payload(AUDIO));

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, direction: 'inbound' });

    const [message] = fake.rowsOf('conversation_messages');
    expect(message).toMatchObject({ direction: 'inbound', message_type: 'audioMessage', content: 'Áudio' });
    expect(message.metadata).toEqual({
      provider: 'evolution',
      event: 'messages.upsert',
      provider_message_id: 'MSG-1',
      media: {
        kind: 'audio',
        mimetype: 'audio/ogg; codecs=opus',
        seconds: 21,
        fileLength: 48211,
        isAnimated: false,
        isLottie: false,
        viewOnce: false,
        placeholder: true,
        status: 'recorded',
      },
    });
    // v1 guarda só texto: nada de url, mediaKey nem payload cru em lugar nenhum do que foi gravado.
    expect(JSON.stringify(fake.tables)).not.toContain('mmg.whatsapp.net');
    expect(JSON.stringify(fake.tables)).not.toContain('CHAVE-DA-MIDIA');

    // Na conexão com a chave ligada, mídia conta como mensagem do lead para todos os efeitos.
    expect(fake.rowsOf('contacts')).toHaveLength(1);
    expect(fake.rowsOf('deals')).toHaveLength(1);
    expect(rpcNames()).toEqual(['resolve_automation_wait_from_inbox']);

    const [thread] = fake.rowsOf('conversation_threads');
    const threadMetadata = thread.metadata as Record<string, unknown>;
    expect(thread.status).toBe('ai_active');
    expect(threadMetadata).toMatchObject({ lastMessagePreview: 'Áudio', lastMessageType: 'audioMessage', unreadCount: 1 });
    expect(threadMetadata.aiPendingToken).toBeUndefined();
    expect(afterMock).not.toHaveBeenCalled();

    const notifications = fake.rowsOf('system_notifications');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ organization_id: TENANT, type: 'SYSTEM_ALERT', severity: 'medium' });
    expect(String(notifications[0].message)).toContain('Maria: chegou áudio sem texto');
  });

  it('rajada de figurinhas vira um aviso só', async () => {
    // Relógio fixo: o aviso é agrupado por janela de 10 minutos e o teste não pode cair na virada.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-21T16:00:05.000Z'));
    try {
      await post(payload({ stickerMessage: { mimetype: 'image/webp' } }, 'S-1'));
      await post(payload({ stickerMessage: { mimetype: 'image/webp' } }, 'S-2'));
      await post(payload({ stickerMessage: { mimetype: 'image/webp', isAnimated: true } }, 'S-3'));
    } finally {
      vi.useRealTimers();
    }

    expect(fake.rowsOf('conversation_messages')).toHaveLength(3);
    expect(fake.rowsOf('system_notifications')).toHaveLength(1);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('texto e figurinha em seguida: a resposta ao texto continua agendada e o marcador dela não é apagado', async () => {
    await post(payload({ conversation: 'quero marcar amanhã às 14h' }, 'T-1'));
    const tokenDoTexto = (fake.rowsOf('conversation_threads')[0].metadata as Record<string, unknown>).aiPendingToken;
    expect(tokenDoTexto).toBeTruthy();

    await post(payload({ stickerMessage: { mimetype: 'image/webp' } }, 'S-1'));

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect((fake.rowsOf('conversation_threads')[0].metadata as Record<string, unknown>).aiPendingToken).toBe(tokenDoTexto);
  });

  it('imagem COM legenda é texto do lead: agenda a IA e não avisa', async () => {
    await post(payload({ imageMessage: { caption: 'olha esse print', mimetype: 'image/jpeg' } }));

    const [message] = fake.rowsOf('conversation_messages');
    expect(message.content).toBe('olha esse print');
    expect(message.metadata).toMatchObject({ media: { kind: 'image', placeholder: false, status: 'recorded' } });
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);
  });

  it('texto puro segue idêntico: sem media no metadata, IA agendada', async () => {
    await post(payload({ conversation: 'oi' }));

    const [message] = fake.rowsOf('conversation_messages');
    expect(message.metadata).toEqual({ provider: 'evolution', event: 'messages.upsert', provider_message_id: 'MSG-1' });
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it('conversa com humano: grava e soma não lida, sem aviso extra e sem IA', async () => {
    await post(payload({ conversation: 'oi' }, 'T-1'));
    const [thread] = fake.rowsOf('conversation_threads');
    thread.status = 'human_active';
    afterMock.mockClear();

    await post(payload(AUDIO, 'A-1'));

    expect(fake.rowsOf('conversation_messages')).toHaveLength(2);
    expect(fake.rowsOf('conversation_threads')[0].status).toBe('human_active');
    expect((fake.rowsOf('conversation_threads')[0].metadata as Record<string, unknown>).unreadCount).toBe(2);
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('áudio enviado pelo próprio número (fromMe): grava como saída, sem negócio, sem régua, sem aviso', async () => {
    await post(payload(AUDIO, 'OUT-1', true));

    const [message] = fake.rowsOf('conversation_messages');
    expect(message).toMatchObject({ direction: 'outbound', content: 'Áudio' });
    expect(fake.rowsOf('deals')).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('reação e enquete continuam ignoradas', async () => {
    const result = await post(payload({ reactionMessage: { text: '👍', key: { id: 'X' } } }));
    expect(result.body).toEqual({ ok: true, ignored: true, reason: 'payload sem mensagem suportada' });
    expect(fake.rowsOf('conversation_messages')).toHaveLength(0);
  });

  it('falha ao gravar o aviso não derruba o webhook', async () => {
    const original = fake.from;
    fake.from = ((table: string) => {
      const builder = original(table);
      if (table === 'system_notifications') {
        builder.upsert = () => ({ ...builder, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: { message: 'boom' } }).then(resolve) }) as typeof builder;
      }
      return builder;
    }) as typeof fake.from;

    const result = await post(payload(AUDIO));
    expect(result.status).toBe(200);
    expect(fake.rowsOf('conversation_messages')).toHaveLength(1);
  });
});

describe('POST do webhook: valor inválido na chave de mídia é tratado como desligado', () => {
  it.each([{ mode: 'on' }, { mode: true }, 'understand', null])('config.media = %j', async (media) => {
    seed({ media });
    const result = await post(payload(AUDIO));
    expect(result.body).toEqual({ ok: true, ignored: true, reason: 'payload sem mensagem suportada' });
    expect(fake.rowsOf('conversation_messages')).toHaveLength(0);
    expect(fake.rowsOf('contacts')).toHaveLength(0);
  });
});
