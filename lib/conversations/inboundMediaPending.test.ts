import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { expireStalePendingInboundMedia, waitForPendingInboundMedia } from './inboundMediaPending';

const ORG = '11111111-1111-4111-8111-111111111111';
const THREAD = '33333333-3333-4333-8333-333333333333';

const media = (status: string) => ({ kind: 'audio', mimetype: null, seconds: 9, fileLength: null, isAnimated: false, isLottie: false, viewOnce: false, placeholder: true, status });
const row = (id: string, status: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  thread_id: THREAD,
  direction: 'inbound',
  content: status ? 'Áudio' : 'oi',
  sent_at: `2026-09-21T16:00:0${id.slice(-1)}.000Z`,
  created_at: '2026-09-21T16:00:00.000Z',
  metadata: status ? { provider: 'evolution', media: media(status) } : { provider: 'evolution' },
  ...extra,
});

let fake: FakeSupabaseAdmin;
const statusOf = (id: string) => ((fake.rowsOf('conversation_messages').find((item) => item.id === id)!.metadata as Record<string, Record<string, unknown>>).media ?? {}).status;

beforeEach(() => {
  fake = createFakeSupabaseAdmin({ conversation_messages: [row('m1', null), row('m2', 'pending'), row('m3', 'pending')] });
});

describe('waitForPendingInboundMedia: a resposta da IA espera a mídia desta conversa', () => {
  it('sem nada pendente, não espera', async () => {
    fake = createFakeSupabaseAdmin({ conversation_messages: [row('m1', null), row('m2', 'done')] });
    const sleep = vi.fn(async () => undefined);
    expect(await waitForPendingInboundMedia({ admin: fake as never, organizationId: ORG, threadId: THREAD, sleep })).toMatchObject({ timedOut: 0 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('três áudios em rajada: espera até TODOS terminarem', async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
      // O entendimento termina em paralelo: um aos 1,5 s, o outro aos 3 s.
      const pending = fake.rowsOf('conversation_messages').find((item) => statusOf(String(item.id)) === 'pending');
      if (pending) (pending.metadata as Record<string, Record<string, unknown>>).media.status = 'done';
    });

    const result = await waitForPendingInboundMedia({ admin: fake as never, organizationId: ORG, threadId: THREAD, sleep, now: () => clock });

    expect(result).toEqual({ waitedMs: 3000, timedOut: 0 });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect([statusOf('m2'), statusOf('m3')]).toEqual(['done', 'done']);
  });

  it('passou de 40 s: o que sobrou vira `timeout` e a resposta segue', async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => { clock += ms; });

    const result = await waitForPendingInboundMedia({ admin: fake as never, organizationId: ORG, threadId: THREAD, sleep, now: () => clock });

    expect(result.timedOut).toBe(2);
    expect(result.waitedMs).toBeGreaterThanOrEqual(40_000);
    expect(result.waitedMs).toBeLessThan(42_000);
    expect([statusOf('m2'), statusOf('m3')]).toEqual(['timeout', 'timeout']);
    const stored = (fake.rowsOf('conversation_messages')[1].metadata as Record<string, Record<string, unknown>>);
    expect(stored.media).toMatchObject({ kind: 'audio', seconds: 9, error: 'espera esgotada antes da resposta' });
    expect(stored.provider).toBe('evolution');
  });

  it('mídia pendente de OUTRA conversa ou enviada pelo próprio número não segura a resposta', async () => {
    fake = createFakeSupabaseAdmin({
      conversation_messages: [row('m1', null), row('m2', 'pending', { thread_id: 'outra-conversa' }), row('m3', 'pending', { direction: 'outbound' })],
    });
    const sleep = vi.fn(async () => undefined);
    await waitForPendingInboundMedia({ admin: fake as never, organizationId: ORG, threadId: THREAD, sleep });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('expireStalePendingInboundMedia: varredura do tick', () => {
  it('sem nenhuma conexão com a chave em `understand`, não toca na tabela de mensagens', async () => {
    fake = createFakeSupabaseAdmin({ channel_connections: [{ id: 'conn-off', config: {} }], conversation_messages: [row('m1', 'pending')] });
    const from = vi.spyOn(fake, 'from');
    expect(await expireStalePendingInboundMedia({ admin: fake as never })).toEqual({ expired: 0 });
    expect(from.mock.calls.map(([table]) => table)).toEqual(['channel_connections']);
  });

  it('pendente há mais de 3 minutos vira `timeout`; recente e já resolvida ficam como estão', async () => {
    const now = new Date('2026-09-21T16:10:00.000Z').getTime();
    fake = createFakeSupabaseAdmin({
      channel_connections: [
        { id: 'conn-understand', config: { media: { mode: 'understand' } } },
        { id: 'conn-record', config: { media: { mode: 'record' } } },
        { id: 'conn-off', config: {} },
      ],
      conversation_messages: [
        row('m1', 'pending', { created_at: '2026-09-21T16:05:00.000Z', channel_connection_id: 'conn-understand' }),
        row('m2', 'pending', { created_at: '2026-09-21T16:09:00.000Z', channel_connection_id: 'conn-understand' }),
        row('m3', 'done', { created_at: '2026-09-21T16:00:00.000Z', channel_connection_id: 'conn-understand' }),
        row('m4', null, { created_at: '2026-09-21T16:00:00.000Z', channel_connection_id: 'conn-understand' }),
        // Conexão sem `understand` nunca é varrida, nem que tenha algo marcado como pendente.
        row('m5', 'pending', { created_at: '2026-09-21T16:00:00.000Z', channel_connection_id: 'conn-off' }),
      ],
    });

    expect(await expireStalePendingInboundMedia({ admin: fake as never, now: () => now })).toEqual({ expired: 1 });
    expect([statusOf('m1'), statusOf('m2'), statusOf('m3'), statusOf('m5')]).toEqual(['timeout', 'pending', 'done', 'pending']);
    expect((fake.rowsOf('conversation_messages')[0].metadata as Record<string, Record<string, unknown>>).media.error).toBe('entendimento não terminou');
  });
});
