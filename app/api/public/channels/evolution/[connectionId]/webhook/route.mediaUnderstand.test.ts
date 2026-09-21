import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * POST do webhook com a chave de mídia em `understand` (SPEC-midia-recebida v2, Passo 2): grava como
 * `pending`, entende num `after()` próprio e, quando a IA vai ler, agenda a resposta.
 * `off` está travado em `route.post.test.ts`; `record`, em `route.media.test.ts`.
 */

const afterMock = vi.fn();
const understandMock = vi.fn(async () => ({ status: 'done' }));
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
vi.mock('@/lib/conversations/inboundMediaUnderstanding', () => ({
  understandInboundMedia: (...args: unknown[]) => understandMock(...(args as [])),
}));

import { POST } from './route';
import { buildConversationHandoff } from '@/lib/conversations/handoff';

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
        config: { webhookSecret: SECRET, instanceName: 'teste', aiEnabled: true, media: { mode: 'understand' }, ...config },
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
    data: { key: { id, remoteJid: JID, fromMe }, pushName: 'Maria', message, messageTimestamp: 1_790_000_000 },
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

const AUDIO = { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 21, ptt: true, fileLength: '48211', url: 'https://mmg.whatsapp.net/x', mediaKey: 'CHAVE-DA-MIDIA' } };
const STICKER = { stickerMessage: { mimetype: 'image/webp' } };
const lastMessage = () => fake.rowsOf('conversation_messages').at(-1)!;
const statusOf = (row: Record<string, unknown>) => (row.metadata as Record<string, Record<string, unknown>>).media?.status;
const threadMetadata = () => fake.rowsOf('conversation_threads')[0].metadata as Record<string, unknown>;

/** O `after()` do entendimento é registrado antes do da IA. Roda só ele (o da IA dorme 7 s de verdade). */
async function runUnderstandingAfter() {
  const callback = afterMock.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
  await callback?.();
}

beforeEach(() => {
  afterMock.mockClear();
  understandMock.mockClear();
  seed();
});

describe('understand: mídia que alguém sabe entender', () => {
  it('nota de voz de número novo: `pending`, entendimento num after() próprio, IA agendada, sem aviso no sino', async () => {
    const result = await post(payload(AUDIO));
    expect(result.status).toBe(200);

    expect(lastMessage()).toMatchObject({ content: 'Áudio', message_type: 'audioMessage' });
    expect(statusOf(lastMessage())).toBe('pending');
    expect(afterMock).toHaveBeenCalledTimes(2);
    expect(threadMetadata().aiPendingMessageId).toBe(lastMessage().id);
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);

    // O que a Evolution precisa para baixar (mediaKey, url) vive só em memória: nunca é gravado.
    expect(JSON.stringify(fake.tables)).not.toContain('CHAVE-DA-MIDIA');
    expect(JSON.stringify(fake.tables)).not.toContain('mmg.whatsapp.net');

    await runUnderstandingAfter();
    expect(understandMock).toHaveBeenCalledTimes(1);
    expect(understandMock.mock.calls[0][0]).toMatchObject({
      organizationId: TENANT,
      connectionId: CONNECTION,
      threadId: fake.rowsOf('conversation_threads')[0].id,
      messageId: lastMessage().id,
      dealId: fake.rowsOf('deals')[0].id,
      contactLabel: 'Maria',
      media: { kind: 'audio', seconds: 21, placeholder: true },
      envelope: { key: { id: 'MSG-1', remoteJid: JID, fromMe: false }, message: AUDIO },
    });
  });

  it('figurinha estática e imagem sem legenda, com a conversa na IA: entende e agenda a resposta', async () => {
    await post(payload(STICKER, 'S-1'));
    expect(statusOf(lastMessage())).toBe('pending');
    expect(afterMock).toHaveBeenCalledTimes(2);

    afterMock.mockClear();
    await post(payload({ imageMessage: { mimetype: 'image/jpeg' } }, 'I-1'));
    expect(statusOf(lastMessage())).toBe('pending');
    expect(afterMock).toHaveBeenCalledTimes(2);
  });

  it('imagem COM legenda: a legenda é o texto, a imagem é entendida à parte', async () => {
    await post(payload({ imageMessage: { caption: 'olha esse print', mimetype: 'image/jpeg' } }));
    expect(lastMessage().content).toBe('olha esse print');
    expect(lastMessage().metadata).toMatchObject({ media: { kind: 'image', placeholder: false, status: 'pending' } });
    expect(afterMock).toHaveBeenCalledTimes(2);
  });

  it('texto puro segue idêntico: sem media, só o after() da IA', async () => {
    await post(payload({ conversation: 'oi' }));
    expect(lastMessage().metadata).toEqual({ provider: 'evolution', event: 'messages.upsert', provider_message_id: 'MSG-1' });
    expect(afterMock).toHaveBeenCalledTimes(1);
    await runUnderstandingAfter().catch(() => undefined);
    expect(understandMock).not.toHaveBeenCalled();
  });
});

describe('understand: mídia que fica só com o selo se comporta como em `record`', () => {
  it.each([
    ['GIF', { videoMessage: { mimetype: 'video/mp4', gifPlayback: true, seconds: 3 } }],
    ['figurinha animada', { stickerMessage: { mimetype: 'image/webp', isAnimated: true } }],
    ['imagem de ver uma vez', { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } }],
    ['vídeo', { videoMessage: { mimetype: 'video/mp4', seconds: 12 } }],
    ['localização', { locationMessage: { degreesLatitude: -22.9, degreesLongitude: -43.2 } }],
  ])('%s: `recorded`, nenhum after(), aviso no sino', async (_nome, message) => {
    await post(payload(message as Record<string, unknown>));
    expect(statusOf(lastMessage())).toBe('recorded');
    expect(afterMock).not.toHaveBeenCalled();
    expect(threadMetadata().aiPendingToken).toBeUndefined();
    expect(fake.rowsOf('system_notifications')).toHaveLength(1);
  });

  it('áudio enviado pelo próprio número (fromMe): só selo, nada é entendido', async () => {
    await post(payload(AUDIO, 'OUT-1', true));
    expect(statusOf(lastMessage())).toBe('recorded');
    expect(afterMock).not.toHaveBeenCalled();
  });
});

describe('understand: entender é independente de responder', () => {
  it('conversa com humano: a transcrição é pedida, a IA não é agendada', async () => {
    await post(payload({ conversation: 'oi' }, 'T-1'));
    fake.rowsOf('conversation_threads')[0].status = 'human_active';
    const tokenAntes = threadMetadata().aiPendingToken;
    afterMock.mockClear();

    await post(payload(AUDIO, 'A-1'));

    expect(statusOf(lastMessage())).toBe('pending');
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(threadMetadata().aiPendingToken).toBe(tokenAntes);
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);
    await runUnderstandingAfter();
    expect(understandMock).toHaveBeenCalledTimes(1);
  });

  it('encerramento pós-handoff: áudio usa uma das 2 respostas; figurinha sozinha é entendida mas NÃO queima resposta', async () => {
    await post(payload({ conversation: 'oi' }, 'T-1'));
    const at = new Date(Date.now() - 5 * 60_000).toISOString();
    const thread = fake.rowsOf('conversation_threads')[0];
    thread.status = 'human_queue';
    thread.metadata = {
      ...(thread.metadata as Record<string, unknown>),
      aiPendingToken: 'token-antigo',
      humanLocked: true,
      routingMode: 'human',
      handoffRequestedAt: at,
      handoffReason: 'Lead confirmou',
      aiLockedReason: 'Lead confirmou',
      lastHandoff: buildConversationHandoff({
        type: 'meeting_confirmed',
        eventId: '55555555-5555-4555-8555-555555555555',
        summary: null,
        reason: 'Lead confirmou',
        requestedAt: at,
        requestedScheduleAt: new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString(),
        requestedScheduleText: null,
        contactName: 'Maria',
        contactPhone: '5521999990000',
      }),
    };

    afterMock.mockClear();
    await post(payload(STICKER, 'S-1'));
    expect(statusOf(lastMessage())).toBe('pending');
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(threadMetadata().aiPendingToken).toBe('token-antigo');

    afterMock.mockClear();
    await post(payload(AUDIO, 'A-1'));
    expect(afterMock).toHaveBeenCalledTimes(2);
    expect(threadMetadata().aiPendingMessageId).toBe(lastMessage().id);
    expect(fake.rowsOf('conversation_threads')[0].status).toBe('human_queue');
  });
});
