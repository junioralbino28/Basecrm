import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import type { InboundMediaInfo } from './inboundMedia';
import { MEDIA_QUOTAS, understandInboundMedia, type InboundMediaUnderstandingDeps } from './inboundMediaUnderstanding';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';
const DEAL = '55555555-5555-4555-8555-555555555555';
const SENT_AT = '2026-09-21T16:00:00.000Z';
const ENVELOPE = { key: { id: 'MSG-1', remoteJid: '5521999990000@s.whatsapp.net', fromMe: false }, message: { audioMessage: { mediaKey: 'K' } } };

const audio: InboundMediaInfo = { kind: 'audio', mimetype: 'audio/ogg; codecs=opus', seconds: 21, fileLength: 48211, isAnimated: false, isLottie: false, viewOnce: false, placeholder: true };

let fake: FakeSupabaseAdmin;
let deps: { [K in keyof InboundMediaUnderstandingDeps]: ReturnType<typeof vi.fn> };

function seed(options: { media?: InboundMediaInfo; content?: string; status?: string; groqKey?: string | null } = {}) {
  const media = options.media ?? audio;
  fake = createFakeSupabaseAdmin({
    organization_settings: [
      { organization_id: ORG, ai_groq_key: options.groqKey === undefined ? 'gsk_da_org' : options.groqKey, ai_anthropic_key: 'sk-ant-da-org' },
      { organization_id: OTHER_ORG, ai_groq_key: 'gsk_de_OUTRA_org', ai_anthropic_key: 'sk-ant-de-OUTRA-org' },
    ],
    conversation_messages: [
      {
        id: MESSAGE,
        organization_id: ORG,
        thread_id: THREAD,
        content: options.content ?? 'Áudio',
        sent_at: SENT_AT,
        metadata: { provider: 'evolution', event: 'messages.upsert', provider_message_id: 'MSG-1', media: { ...media, status: options.status ?? 'pending' } },
      },
    ],
    conversation_threads: [{ id: THREAD, organization_id: ORG, metadata: { lastMessagePreview: options.content ?? 'Áudio', lastMessageSentAt: SENT_AT, unreadCount: 1, aiPendingToken: 'tok' } }],
    deals: [{ id: DEAL, organization_id: ORG, custom_fields: { source: 'whatsapp', first_inbound_preview: options.content ?? 'Áudio' } }],
  });
  deps = {
    consumeQuota: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    resolveCredentials: vi.fn(async () => ({ apiUrl: 'https://93.184.216.34', apiKey: 'EVOLUTION-KEY' })),
    download: vi.fn(async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]), mimetype: 'audio/ogg', fileName: 'a.oga', attempts: 1 })),
    understand: vi.fn(async () => ({ status: 'done', text: 'pode ser amanhã às dez', provider: 'groq', model: 'whisper-large-v3', ms: 812, error: null })),
  };
}

const run = (media: InboundMediaInfo = audio) =>
  understandInboundMedia({
    admin: fake as never,
    organizationId: ORG,
    connectionId: CONNECTION,
    connectionConfig: { instanceName: 'aurora-teste' },
    threadId: THREAD,
    messageId: MESSAGE,
    dealId: DEAL,
    contactLabel: 'Maria',
    media,
    envelope: ENVELOPE,
    deps: deps as unknown as InboundMediaUnderstandingDeps,
  });

const message = () => fake.rowsOf('conversation_messages')[0];
const mediaOf = () => (message().metadata as Record<string, Record<string, unknown>>).media;

beforeEach(() => seed());

describe('understandInboundMedia: caminho feliz', () => {
  it('transcreve com a chave DA organização, grava o texto e atualiza as prévias', async () => {
    const result = await run();

    expect(result).toEqual({ status: 'done' });
    expect(message().content).toBe('pode ser amanhã às dez');
    expect(mediaOf()).toMatchObject({ kind: 'audio', seconds: 21, status: 'done', placeholder: false, provider: 'groq', model: 'whisper-large-v3', ms: 812, error: null, description: null });
    expect(message().metadata).toMatchObject({ provider: 'evolution', provider_message_id: 'MSG-1' });

    expect(deps.understand).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'gsk_da_org' }));
    expect(deps.download).toHaveBeenCalledWith(expect.objectContaining({ instanceName: 'aurora-teste', envelope: ENVELOPE, maxBytes: 1.5 * 1024 * 1024, apiKey: 'EVOLUTION-KEY' }));

    const threadMetadata = fake.rowsOf('conversation_threads')[0].metadata as Record<string, unknown>;
    expect(threadMetadata).toMatchObject({ lastMessagePreview: 'pode ser amanhã às dez', unreadCount: 1, aiPendingToken: 'tok' });
    expect((fake.rowsOf('deals')[0].custom_fields as Record<string, unknown>).first_inbound_preview).toBe('pode ser amanhã às dez');
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);
  });

  it('cotas nos três níveis aprovados, contadas no banco', async () => {
    await run();
    expect(deps.consumeQuota.mock.calls.map(([call]) => [call.scopeKey, call.limit, call.windowSeconds])).toEqual([
      [`media:thread:${THREAD}`, 10, 600],
      [`media:connection:${CONNECTION}`, 120, 3600],
      [`media:org:${ORG}`, 500, 86400],
    ]);
    expect(MEDIA_QUOTAS).toEqual({ thread: { limit: 10, windowSeconds: 600 }, connection: { limit: 120, windowSeconds: 3600 }, organization: { limit: 500, windowSeconds: 86400 } });
  });

  it('foto COM legenda: a legenda do lead fica crua e a descrição vai à parte', async () => {
    const image: InboundMediaInfo = { ...audio, kind: 'image', mimetype: 'image/jpeg', seconds: null, placeholder: false };
    seed({ media: image, content: 'olha esse print' });
    deps.understand.mockResolvedValueOnce({ status: 'done', text: 'Print de um orçamento.', provider: 'anthropic', model: 'claude-sonnet-5', ms: 1500, error: null });

    await run(image);

    expect(message().content).toBe('olha esse print');
    expect(mediaOf()).toMatchObject({ status: 'done', placeholder: false, description: 'Print de um orçamento.' });
    expect(deps.understand).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-ant-da-org' }));
    expect((fake.rowsOf('conversation_threads')[0].metadata as Record<string, unknown>).lastMessagePreview).toBe('olha esse print');
  });

  it('prévia só muda se esta ainda for a última mensagem da conversa', async () => {
    (fake.rowsOf('conversation_threads')[0].metadata as Record<string, unknown>).lastMessagePreview = 'mensagem mais nova';
    await run();
    expect((fake.rowsOf('conversation_threads')[0].metadata as Record<string, unknown>).lastMessagePreview).toBe('mensagem mais nova');
  });
});

describe('understandInboundMedia: o que NÃO gasta IA', () => {
  it('mídia que fica só com o selo (GIF, ver uma vez, figurinha animada) nem começa', async () => {
    for (const media of [{ ...audio, kind: 'gif' as const }, { ...audio, viewOnce: true }, { ...audio, kind: 'sticker' as const, isAnimated: true }]) {
      expect(await run(media)).toEqual({ status: 'recorded' });
    }
    expect(deps.consumeQuota).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
    expect(mediaOf().status).toBe('pending');
  });

  it('sem a chave da organização: `skipped_no_key`, nunca a chave de outra organização', async () => {
    seed({ groqKey: null });
    expect(await run()).toEqual({ status: 'skipped_no_key' });
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.understand).not.toHaveBeenCalled();
    expect(mediaOf()).toMatchObject({ status: 'skipped_no_key', placeholder: true });
    expect(message().content).toBe('Áudio');
    expect(JSON.stringify(fake.rowsOf('conversation_messages'))).not.toContain('OUTRA');
    expect(String(fake.rowsOf('system_notifications')[0].message)).toContain('falta a chave de IA desta organização');
  });

  it('tamanho declarado acima do teto: falha antes de baixar', async () => {
    const big = { ...audio, fileLength: 9 * 1024 * 1024 };
    seed({ media: big });
    expect(await run(big)).toEqual({ status: 'failed' });
    expect(deps.download).not.toHaveBeenCalled();
    expect(mediaOf().error).toBe('arquivo acima do tamanho máximo');
  });

  it('cota estourada em qualquer nível: `limit`, sem baixar nem chamar o provedor', async () => {
    deps.consumeQuota.mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 }).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 900 });
    expect(await run()).toEqual({ status: 'limit' });
    expect(deps.download).not.toHaveBeenCalled();
    expect(mediaOf().status).toBe('limit');
    expect(String(fake.rowsOf('system_notifications')[0].message)).toContain('limite de mídias');
  });
});

describe('understandInboundMedia: falhas viram selo + aviso, nunca tiram a conversa da IA', () => {
  it('download falhou (payload mentiroso, Evolution não decriptou)', async () => {
    deps.download.mockResolvedValueOnce({ ok: false, reason: 'too_large', attempts: 1 });
    expect(await run()).toEqual({ status: 'failed' });
    expect(deps.understand).not.toHaveBeenCalled();
    expect(mediaOf()).toMatchObject({ status: 'failed', error: 'download: too_large', placeholder: true });
    expect(message().content).toBe('Áudio');
    expect(fake.rowsOf('system_notifications')).toHaveLength(1);
    expect(fake.rowsOf('conversation_threads')[0]).not.toHaveProperty('status', 'human_queue');
  });

  it('áudio sem fala: `empty` com aviso', async () => {
    deps.understand.mockResolvedValueOnce({ status: 'empty', text: null, provider: 'groq', model: 'whisper-large-v3', ms: 400, error: null });
    expect(await run()).toEqual({ status: 'empty' });
    expect(String(fake.rowsOf('system_notifications')[0].message)).toContain('não havia fala');
  });

  it('exceção inesperada não deixa a mensagem presa em "entendendo…"', async () => {
    deps.download.mockRejectedValueOnce(new Error('boom com EVOLUTION-KEY'));
    expect(await run()).toEqual({ status: 'failed' });
    expect(mediaOf()).toMatchObject({ status: 'failed', error: 'falha interna ao entender a mídia' });
    expect(JSON.stringify(fake.tables)).not.toContain('EVOLUTION-KEY');
  });

  it('resultado atrasado é descartado: quem esperava já marcou `timeout` e a IA respondeu sem esse texto', async () => {
    seed({ status: 'timeout' });
    expect(await run()).toEqual({ status: 'timeout' });
    expect(message().content).toBe('Áudio');
    expect(mediaOf().status).toBe('timeout');
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);
  });
});

describe('understandInboundMedia: disjuntor por conexão e por provedor', () => {
  const scope = `media-fail:${CONNECTION}:groq`;

  it('falha do provedor conta; resposta do provedor zera a sequência', async () => {
    deps.understand.mockResolvedValueOnce({ status: 'failed', text: null, provider: 'groq', model: 'whisper-large-v3', ms: 90, error: 'Error: 503' });
    await run();
    expect(deps.consumeQuota).toHaveBeenLastCalledWith(expect.objectContaining({ scopeKey: scope, windowSeconds: 600 }));

    seed();
    fake.rowsOf('conversation_ai_rate_limits').push({ scope_key: scope, request_count: 3, window_started_at: new Date().toISOString() });
    await run();
    expect(fake.rowsOf('conversation_ai_rate_limits')).toHaveLength(0);
  });

  it('5 falhas seguidas em 10 minutos: pausa sem gastar cota, download nem provedor', async () => {
    fake.rowsOf('conversation_ai_rate_limits').push({ scope_key: scope, request_count: 5, window_started_at: new Date().toISOString() });
    expect(await run()).toEqual({ status: 'failed' });
    expect(mediaOf().error).toBe('entendimento pausado por falhas seguidas do provedor');
    expect(deps.consumeQuota).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('janela vencida ou falhas de OUTRO provedor não pausam', async () => {
    fake.rowsOf('conversation_ai_rate_limits').push(
      { scope_key: scope, request_count: 9, window_started_at: new Date(Date.now() - 11 * 60_000).toISOString() },
      { scope_key: `media-fail:${CONNECTION}:anthropic`, request_count: 9, window_started_at: new Date().toISOString() },
    );
    expect(await run()).toEqual({ status: 'done' });
  });
});
