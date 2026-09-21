import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

// Decisao do Junior (21/09): nada atropela o "assumir". O envio pela Evolution leva segundos; a escrita
// final da resposta usava a foto da conversa lida ANTES do envio e devolvia a conversa para ai_active
// (e podia ressuscitar uma cutucada ja cancelada pelo tick).

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';

let fake: FakeSupabaseAdmin;
let duringSend: (() => void) | null = null;

vi.mock('@/lib/conversations/conversationAIGate', () => ({
  loadFreshConversationAIGate: vi.fn(async () => ({
    ok: true,
    connection: { id: CONN, organization_id: ORG, name: 'Aurora', config: { aiEnabled: true, instanceName: 'inst-teste' } },
  })),
}));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: vi.fn(async () => ({ apiUrl: 'https://evolution.example', apiKey: 'chave-de-teste', source: 'connection' })),
}));
vi.mock('@/lib/channels/evolution', () => ({
  sendEvolutionTextMessage: vi.fn(async () => {
    duringSend?.();
    return { providerMessageId: 'msg-1', attemptLabel: 'number_text', raw: {} };
  }),
}));
vi.mock('@/lib/conversations/server', () => ({
  loadConversationThreadInboxItem: vi.fn(async () => {
    const row = fake.rowsOf('conversation_threads').find((thread) => thread.id === THREAD);
    return row ? { id: row.id, status: row.status, metadata: row.metadata } : null;
  }),
}));

import { executeConversationAIReply } from './aiReply';
import { recordConversationAIFailure } from './conversationAIFailure';

function seed(metadata: Record<string, unknown>, status = 'ai_active') {
  fake = createFakeSupabaseAdmin({
    conversation_threads: [{
      id: THREAD,
      organization_id: ORG,
      channel_connection_id: CONN,
      contact_id: null,
      deal_id: null,
      contact_name: 'Marina',
      contact_phone: '5521999990000',
      status,
      assigned_user_id: null,
      metadata,
    }],
  });
}

const thread = () => fake.rowsOf('conversation_threads').find((row) => row.id === THREAD) as {
  status: string;
  metadata: Record<string, unknown>;
};

async function reply() {
  return executeConversationAIReply({
    admin: fake as never,
    connection: { id: CONN, organization_id: ORG, name: 'Aurora', config: { aiEnabled: true, instanceName: 'inst-teste' } },
    payload: { threadId: THREAD, replyText: 'Perfeito, anotei aqui.' },
  });
}

describe('executeConversationAIReply: a escrita final respeita o que mudou durante o envio', () => {
  beforeEach(() => {
    duringSend = null;
  });

  it('operador assumiu no meio do envio: a conversa continua com ele, nao volta para a IA', async () => {
    seed({ lastDirection: 'inbound', unreadCount: 1 });
    duringSend = () => {
      Object.assign(thread(), { status: 'human_active', metadata: { ...thread().metadata, humanLocked: true, routingMode: 'human' } });
    };

    const result = await reply();

    expect(thread().status).toBe('human_active');
    expect(thread().metadata.humanLocked).toBe(true);
    expect(thread().metadata.routingMode).toBe('human');
    // Quem chama (agendar a cutucada) ve o status de verdade, nao o que a resposta pretendia.
    expect('status' in result && result.status).toBe('human_active');
    // A mensagem ja saiu: ela fica gravada na conversa.
    expect(fake.rowsOf('conversation_messages').some((row) => row.direction === 'outbound' && row.content === 'Perfeito, anotei aqui.')).toBe(true);
  });

  it('sem mudanca de estado: grava a saida normalmente', async () => {
    seed({ lastDirection: 'inbound', unreadCount: 2 });

    const result = await reply();

    expect(thread().status).toBe('ai_active');
    expect(thread().metadata.lastDirection).toBe('outbound');
    expect(thread().metadata.unreadCount).toBe(0);
    expect('status' in result && result.status).toBe('ai_active');
  });

  it('cutucada cancelada pelo tick durante o envio nao ressuscita (a foto antiga ainda tinha o token)', async () => {
    seed({
      lastDirection: 'inbound',
      aiInactivityNudgeToken: 'cutucada-velha',
      aiInactivityNudgeDueAt: '2026-09-21T19:00:00.000Z',
      aiInactivityNudgeScheduledAt: '2026-09-21T18:45:00.000Z',
      aiInactivityNudgeSentAt: '2026-09-21T18:00:00.000Z',
    });
    duringSend = () => {
      Object.assign(thread(), { metadata: { ...thread().metadata, aiInactivityNudgeToken: null, aiInactivityNudgeDueAt: null } });
    };

    await reply();

    expect(thread().metadata.aiInactivityNudgeToken).toBeNull();
    expect(thread().metadata.aiInactivityNudgeDueAt).toBeNull();
    expect(thread().metadata.aiInactivityNudgeScheduledAt).toBeNull();
    // O registro da ultima cutucada enviada continua (e ele que impede cutucada em cascata).
    expect(thread().metadata.aiInactivityNudgeSentAt).toBe('2026-09-21T18:00:00.000Z');
  });
});

describe('recordConversationAIFailure: falha da IA nao rebaixa quem ja assumiu', () => {
  const fail = (metadata: Record<string, unknown>) => recordConversationAIFailure({
    admin: fake as never,
    organizationId: ORG,
    threadId: THREAD,
    eventId: 'evento-1',
    contactLabel: 'Marina',
    stage: 'provider',
    metadata,
  });

  it('com humano ativo: o status fica human_active e o sino nao repete "precisa de voce"', async () => {
    seed({ humanLocked: true }, 'human_active');
    const result = await fail(thread().metadata);
    expect(result.ok).toBe(true);
    expect(thread().status).toBe('human_active');
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);
  });

  it('conversa que o operador resolveu no meio do caminho continua resolvida', async () => {
    seed({ resolvedAt: '2026-09-21T19:00:00.000Z' }, 'resolved');
    await fail(thread().metadata);
    expect(thread().status).toBe('resolved');
    expect(thread().metadata.resolvedAt).toBe('2026-09-21T19:00:00.000Z');
    expect(fake.rowsOf('system_notifications')).toHaveLength(0);
  });

  it('com a IA ativa: vai para a fila humana e o sino avisa, como antes', async () => {
    seed({});
    await fail(thread().metadata);
    expect(thread().status).toBe('human_queue');
    expect(fake.rowsOf('system_notifications')).toHaveLength(1);
  });
});
