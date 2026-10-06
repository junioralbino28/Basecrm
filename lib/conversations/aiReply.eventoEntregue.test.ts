import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * Central de Agentes: o evento de prova (ai_reply_events) só é gravado com a entrega feita e só quando quem
 * chama manda `replyEvent` (o webhook). Rota do n8n e cutucada não mandam, e não gravam.
 */
const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64);
const COMMIT = 'c'.repeat(40);
const DEPLOYMENT = 'dpl_entrega1';

let fake: FakeSupabaseAdmin;
let envioFalha = false;
let enviadoEm: number[] = [];

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
    if (envioFalha) throw new Error('Evolution fora do ar');
    await new Promise((resolve) => setTimeout(resolve, 5));
    enviadoEm.push(Date.now());
    return { providerMessageId: `msg-${enviadoEm.length}`, attemptLabel: 'number_text', raw: {} };
  }),
}));
vi.mock('@/lib/conversations/server', () => ({
  loadConversationThreadInboxItem: vi.fn(async () => {
    const row = fake.rowsOf('conversation_threads').find((thread) => thread.id === THREAD);
    return row ? { id: row.id, status: row.status, metadata: row.metadata } : null;
  }),
}));

import { executeConversationAIReply } from './aiReply';

const replyEvent = { promptSha256: SHA, promptKey: 'task_conversations_whatsapp_auto_reply', promptSource: 'default' as const, agentId: null, agentVersion: null };

function seed() {
  fake = createFakeSupabaseAdmin({
    conversation_threads: [{
      id: THREAD, organization_id: ORG, channel_connection_id: CONN, contact_id: null, deal_id: null,
      contact_name: 'Marina', contact_phone: '5521999990000', status: 'ai_active', assigned_user_id: null,
      metadata: { lastDirection: 'inbound', unreadCount: 1 },
    }],
  });
}

function responder(payload: Record<string, unknown>) {
  return executeConversationAIReply({
    admin: fake as never,
    connection: { id: CONN, organization_id: ORG, name: 'Aurora', config: { aiEnabled: true, instanceName: 'inst-teste' } },
    payload: { threadId: THREAD, replyText: 'Parte um. '.repeat(30) + '\n\n' + 'Parte dois.', ...payload } as never,
  });
}

beforeEach(() => {
  seed();
  envioFalha = false;
  enviadoEm = [];
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', COMMIT);
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', DEPLOYMENT);
});
afterEach(() => vi.unstubAllEnvs());

describe('evento de prova da resposta nativa', () => {
  it('grava um evento por resposta, depois da última parte entregue, com o commit da publicação', async () => {
    const antes = Date.now();
    const r = await responder({ replyEvent, metadata: { native_ai: true }, automationSource: 'native_crm' });
    expect(r.ok).toBe(true);

    const eventos = fake.rowsOf('ai_reply_events');
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      organization_id: ORG, channel_connection_id: CONN, thread_id: THREAD,
      prompt_sha256: SHA, prompt_key: 'task_conversations_whatsapp_auto_reply', prompt_source: 'default',
      agent_id: null, agent_version: null, release_commit: COMMIT, release_deployment: DEPLOYMENT,
    });
    // Várias partes enviadas (quantas, decide o divisor de partes do gerador), UM evento, e a hora é a do fim
    // da entrega (depois do último envio), não o sent_at das mensagens, que é fixado antes de qualquer envio.
    const enviadas = fake.rowsOf('conversation_messages').filter((m) => m.direction === 'outbound');
    expect(enviadas.length).toBeGreaterThan(1);
    expect(enviadoEm).toHaveLength(enviadas.length);
    const entregueEm = Date.parse(String(eventos[0].delivered_at));
    expect(entregueEm).toBeGreaterThanOrEqual(enviadoEm.at(-1)!);
    expect(entregueEm).toBeGreaterThanOrEqual(antes);
    const sentAt = Date.parse(String(fake.rowsOf('conversation_messages')[0].sent_at));
    expect(entregueEm).toBeGreaterThanOrEqual(sentAt);
  });

  it('entrega falhou: mensagem gravada como failed e NENHUM evento', async () => {
    envioFalha = true;
    const r = await responder({ replyEvent, automationSource: 'native_crm' });
    expect(r.ok).toBe(true);
    expect('warning' in r && r.warning).toBeTruthy();
    expect(fake.rowsOf('ai_reply_events')).toEqual([]);
    expect(fake.rowsOf('conversation_messages').some((m) => (m.metadata as Record<string, unknown>).delivery_status === 'failed')).toBe(true);
  });

  it('sem replyEvent (rota do n8n, cutucada): entrega normal e nenhum evento', async () => {
    const r = await responder({ automationSource: 'n8n', metadata: { prompt_sha256: SHA } });
    expect(r.ok).toBe(true);
    expect(fake.rowsOf('ai_reply_events')).toEqual([]);
  });

  it('falha ao gravar o evento não derruba nem marca a resposta', async () => {
    fake.failOn('ai_reply_events', 'insert', 'boom');
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await responder({ replyEvent, automationSource: 'native_crm' });
    expect(r.ok).toBe(true);
    expect('warning' in r && r.warning).toBeNull();
    expect(aviso).toHaveBeenCalledWith('[Conversation AI] Failed to record reply event', expect.anything());
    aviso.mockRestore();
  });
});
