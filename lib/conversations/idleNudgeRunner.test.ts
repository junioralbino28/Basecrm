import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const failureMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: vi.fn() }));
vi.mock('@/lib/conversations/aiReply', () => ({
  executeConversationAIReply: (...args: unknown[]) => executeMock(...args),
}));
vi.mock('@/lib/conversations/conversationAIFailure', () => ({
  recordConversationAIFailure: (...args: unknown[]) => failureMock(...args),
}));

import { DEFAULT_IDLE_NUDGE_TEXT, IDLE_NUDGE_AUTOMATION_SOURCE } from './idleNudge';
import { sendDueConversationNudges } from './idleNudgeRunner';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'msg-1:idle-nudge:1758369600000';

type FakeCall = {
  table: string;
  op: 'select' | 'update';
  payload?: Record<string, unknown>;
  filters: unknown[][];
  returning?: string;
  single?: boolean;
};

/** Cliente Supabase falso e encadeavel: cada consulta vira uma FakeCall resolvida pelo roteiro. */
function createFakeAdmin(answer: (call: FakeCall) => { data: unknown; error: { message: string } | null }) {
  const calls: FakeCall[] = [];
  const admin = {
    calls,
    from(table: string) {
      const call: FakeCall = { table, op: 'select', filters: [] };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      Object.assign(builder, {
        select(columns: string) {
          if (call.op === 'update') call.returning = columns;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(...args: unknown[]) { call.filters.push(['eq', ...args]); return builder; },
        not(...args: unknown[]) { call.filters.push(['not', ...args]); return builder; },
        lte(...args: unknown[]) { call.filters.push(['lte', ...args]); return builder; },
        in(...args: unknown[]) { call.filters.push(['in', ...args]); return builder; },
        order: chain,
        limit: chain,
        maybeSingle() { call.single = true; return builder; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          calls.push(call);
          return Promise.resolve(answer(call)).then(resolve, reject);
        },
      });
      return builder;
    },
  };
  return admin;
}

function dueThread(metadata: Record<string, unknown>, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: THREAD,
    organization_id: ORG,
    channel_connection_id: CONNECTION,
    contact_name: 'Lead Teste',
    contact_phone: '5511999990000',
    status: 'ai_active',
    metadata: {
      lastInboundAt: '2026-09-20T12:00:00.000Z',
      lastDirection: 'outbound',
      aiInactivityNudgeToken: TOKEN,
      aiInactivityNudgeDueAt: '2026-09-20T12:15:00.000Z',
      ...metadata,
    },
    ...overrides,
  };
}

function connection(config: Record<string, unknown> = {}) {
  return { id: CONNECTION, organization_id: ORG, name: 'Aurora (teste)', config: { aiEnabled: true, ...config } };
}

function buildScript(input: {
  threads: unknown[];
  connections?: unknown[];
  claimRows?: unknown[];
  freshMetadata?: Record<string, unknown>;
}) {
  return (call: FakeCall) => {
    if (call.table === 'conversation_threads' && call.op === 'select' && !call.single) {
      return { data: input.threads, error: null };
    }
    if (call.table === 'channel_connections') {
      return { data: input.connections ?? [connection()], error: null };
    }
    if (call.table === 'conversation_threads' && call.op === 'update' && call.returning) {
      return { data: input.claimRows ?? [{ id: THREAD }], error: null };
    }
    if (call.table === 'conversation_threads' && call.op === 'select' && call.single) {
      return { data: { metadata: input.freshMetadata ?? { lastDirection: 'outbound', lastMessagePreview: 'cutucada' } }, error: null };
    }
    return { data: null, error: null };
  };
}

beforeEach(() => {
  executeMock.mockReset();
  failureMock.mockReset();
  executeMock.mockResolvedValue({ ok: true, warning: null, status: 'ai_active', thread: null });
  failureMock.mockResolvedValue({ ok: true });
});

describe('sendDueConversationNudges — relogio da cutucada de 15 min', () => {
  it('envia a cutucada vencida com o texto do numero e registra o envio sem sobrescrever a metadata nova', async () => {
    const admin = createFakeAdmin(buildScript({ threads: [dueThread({})] }));

    const summary = await sendDueConversationNudges({ admin: admin as never, now: '2026-09-20T12:20:00.000Z' });

    expect(summary).toMatchObject({ due: 1, sent: 1, failed: 0, truncated: false });
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0]?.[0]).toMatchObject({
      connection: { id: CONNECTION, organization_id: ORG },
      payload: {
        threadId: THREAD,
        replyText: DEFAULT_IDLE_NUDGE_TEXT,
        automationSource: IDLE_NUDGE_AUTOMATION_SOURCE,
        metadata: { idle_nudge: true, idle_nudge_delay_minutes: 15, idle_nudge_token: TOKEN },
      },
    });

    // a busca das vencidas filtra por status, token presente e vencimento <= agora
    const due = admin.calls[0];
    expect(due.filters).toEqual(expect.arrayContaining([
      ['eq', 'status', 'ai_active'],
      ['not', 'metadata->>aiInactivityNudgeToken', 'is', null],
      ['lte', 'metadata->>aiInactivityNudgeDueAt', '2026-09-20T12:20:00.000Z'],
    ]));

    // a reivindicacao exige o token lido, a ultima mensagem da IA e a conversa ainda com a IA
    const claim = admin.calls.find((call) => call.op === 'update' && call.returning === 'id');
    expect(claim?.filters).toEqual(expect.arrayContaining([
      ['eq', 'id', THREAD],
      ['eq', 'organization_id', ORG],
      ['eq', 'metadata->>aiInactivityNudgeToken', TOKEN],
      ['eq', 'metadata->>lastDirection', 'outbound'],
      ['eq', 'status', 'ai_active'],
    ]));
    expect(claim?.payload?.metadata).toMatchObject({ aiInactivityNudgeToken: null, aiInactivityNudgeDueAt: null });

    // o registro do envio parte da metadata fresca (lida depois da resposta), nao da lida antes
    const marked = admin.calls.filter((call) => call.op === 'update' && !call.returning).at(-1);
    expect(marked?.payload?.metadata).toMatchObject({
      lastMessagePreview: 'cutucada',
      aiInactivityNudgeToken: null,
      aiInactivityNudgeSentAt: expect.any(String),
    });
    expect(failureMock).not.toHaveBeenCalled();
  });

  it('nao envia quando o lead ja respondeu: limpa o agendamento casando o token', async () => {
    const admin = createFakeAdmin(buildScript({ threads: [dueThread({ lastDirection: 'inbound' })] }));

    const summary = await sendDueConversationNudges({ admin: admin as never });

    expect(summary).toMatchObject({ due: 1, sent: 0, skipped: { replied: 1 } });
    expect(executeMock).not.toHaveBeenCalled();
    const clear = admin.calls.find((call) => call.op === 'update');
    expect(clear?.returning).toBeUndefined();
    expect(clear?.filters).toEqual(expect.arrayContaining([['eq', 'metadata->>aiInactivityNudgeToken', TOKEN]]));
    expect(clear?.payload?.metadata).toMatchObject({ aiInactivityNudgeToken: null, aiInactivityNudgeSentAt: null });
  });

  it('respeita a cutucada desligada no numero', async () => {
    const admin = createFakeAdmin(buildScript({
      threads: [dueThread({})],
      connections: [connection({ aiIdleNudge: { enabled: false, delayMinutes: 15, text: 'x' } })],
    }));

    const summary = await sendDueConversationNudges({ admin: admin as never });

    expect(summary).toMatchObject({ due: 1, sent: 0, skipped: { disabled: 1 } });
    expect(executeMock).not.toHaveBeenCalled();
    expect(admin.calls.some((call) => call.op === 'update')).toBe(true);
  });

  it('usa o prazo e o texto configurados no numero', async () => {
    const admin = createFakeAdmin(buildScript({
      threads: [dueThread({})],
      connections: [connection({ aiIdleNudge: { enabled: true, delayMinutes: 30, text: 'Ficou alguma duvida?' } })],
    }));

    await sendDueConversationNudges({ admin: admin as never });

    expect(executeMock.mock.calls[0]?.[0]).toMatchObject({
      payload: { replyText: 'Ficou alguma duvida?', metadata: { idle_nudge_delay_minutes: 30 } },
    });
  });

  it('nao envia quando outro tick reivindicou primeiro', async () => {
    const admin = createFakeAdmin(buildScript({ threads: [dueThread({})], claimRows: [] }));

    const summary = await sendDueConversationNudges({ admin: admin as never });

    expect(summary).toMatchObject({ due: 1, sent: 0, skipped: { claimed: 1 } });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('conversa sem conexao conhecida e limpa sem enviar', async () => {
    const admin = createFakeAdmin(buildScript({ threads: [dueThread({})], connections: [] }));

    const summary = await sendDueConversationNudges({ admin: admin as never });

    expect(summary).toMatchObject({ due: 1, sent: 0, skipped: { state: 1 } });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('falha no envio vira alerta operacional e nao derruba o lote', async () => {
    executeMock.mockRejectedValueOnce(new Error('Evolution fora do ar'));
    const admin = createFakeAdmin(buildScript({ threads: [dueThread({})] }));

    const summary = await sendDueConversationNudges({ admin: admin as never });

    expect(summary).toMatchObject({ due: 1, sent: 0, failed: 1 });
    expect(summary.errors[0]).toContain('Evolution fora do ar');
    expect(failureMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG,
      threadId: THREAD,
      eventId: TOKEN,
      stage: 'delivery',
      contactLabel: 'Lead Teste',
    }));
  });

  it('envio ignorado pelos gates conta como ignorado, sem alerta', async () => {
    executeMock.mockResolvedValueOnce({ ok: true, ignored: true, reason: 'ai_disabled' });
    const admin = createFakeAdmin(buildScript({ threads: [dueThread({})] }));

    const summary = await sendDueConversationNudges({ admin: admin as never });

    expect(summary).toMatchObject({ due: 1, sent: 0, skipped: { ignored: 1 } });
    expect(failureMock).not.toHaveBeenCalled();
  });

  it('sem cutucada vencida nao toca em mais nada', async () => {
    const admin = createFakeAdmin(buildScript({ threads: [] }));

    const summary = await sendDueConversationNudges({ admin: admin as never });

    expect(summary).toMatchObject({ due: 0, sent: 0 });
    expect(admin.calls).toHaveLength(1);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
