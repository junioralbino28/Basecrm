import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * G22, rodada 5 do Codex (fatia 3 da Central de Agentes): se a Evolution repetir no motivo do erro a parte que tentamos
 * enviar, essa parte não pode chegar ao `delivery_error` da mensagem nem ao registro da falha. O envio é o REAL
 * (`sendEvolutionTextMessage`); só o `fetch` responde HTTP 400 com o eco, como uma Evolution que devolvesse o texto.
 */
const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const SENTINELA = 'SENTINELA-ENTREGA-3301';
const RESPOSTA = `Oi Marina, aqui é a Aurora ${SENTINELA}. Posso te ajudar?`;

let fake: FakeSupabaseAdmin;

vi.mock('@/lib/conversations/conversationAIGate', () => ({
  loadFreshConversationAIGate: vi.fn(async () => ({
    ok: true,
    connection: { id: CONN, organization_id: ORG, name: 'Aurora', config: { aiEnabled: true, instanceName: 'inst-teste' } },
  })),
}));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: vi.fn(async () => ({ apiUrl: 'https://evolution.example', apiKey: 'chave-de-teste', source: 'connection' })),
}));
// Endereço de teste: o guarda real recusaria por DNS; aqui só o fetch importa.
vi.mock('@/lib/channels/evolutionUrlGuard', () => ({ assertSafeEvolutionUrl: vi.fn(async () => undefined) }));
vi.mock('@/lib/conversations/server', () => ({
  loadConversationThreadInboxItem: vi.fn(async () => {
    const row = fake.rowsOf('conversation_threads').find((thread) => thread.id === THREAD);
    return row ? { id: row.id, status: row.status, metadata: row.metadata } : null;
  }),
}));

import { executeConversationAIReply } from './aiReply';

beforeEach(() => {
  fake = createFakeSupabaseAdmin({
    conversation_threads: [{
      id: THREAD, organization_id: ORG, channel_connection_id: CONN, contact_id: null, deal_id: null,
      contact_name: 'Marina', contact_phone: '5521999990000', status: 'ai_active', assigned_user_id: null,
      metadata: { lastDirection: 'inbound', unreadCount: 1 },
    }],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('falha de entrega com eco do texto enviado', () => {
  it('o eco vira "[texto da resposta]" na mensagem, no registro da falha e no aviso; o motivo da Evolution fica', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const enviado = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const texto = String(enviado.text ?? enviado.textMessage ?? enviado.body ?? (enviado.message as { text?: string })?.text ?? '');
      return new Response(JSON.stringify({ status: 400, error: 'Bad Request', response: { message: [`numero invalido para: ${texto}`] } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const r = await executeConversationAIReply({
      admin: fake as never,
      connection: { id: CONN, organization_id: ORG, name: 'Aurora', config: { aiEnabled: true, instanceName: 'inst-teste' } },
      payload: { threadId: THREAD, replyText: RESPOSTA, metadata: { native_ai: true }, automationSource: 'native_crm' } as never,
    });

    expect(fetchMock).toHaveBeenCalled();
    const mensagem = fake.rowsOf('conversation_messages').find((m) => m.thread_id === THREAD && m.direction === 'outbound');
    const erroDaMensagem = String((mensagem?.metadata as Record<string, unknown> | undefined)?.delivery_error);
    expect(erroDaMensagem).toBe('numero invalido para: [texto da resposta]');
    const metadadoDaConversa = fake.rowsOf('conversation_threads').find((t) => t.id === THREAD)?.metadata as Record<string, unknown>;
    expect(metadadoDaConversa.aiFailureError).toBe('numero invalido para: [texto da resposta]');
    expect((r as { warning?: string | null }).warning).toBe('numero invalido para: [texto da resposta]');
    // O texto continua como CONTEÚDO (o balão e a prévia da caixa de entrada mostram a resposta); só o diagnóstico perde o eco.
    expect(mensagem?.content).toBe(RESPOSTA);
    expect(metadadoDaConversa.lastMessagePreview).toBe(RESPOSTA);
  });
});
