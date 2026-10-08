import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * G22, rodadas 5 e 6 do Codex (fatia 3 da Central de Agentes): a falha de entrega da resposta da IA vira texto FIXO no
 * `delivery_error` da mensagem, no registro da falha e no aviso. A mensagem livre da Evolution nunca chega lá, porque ela
 * pode repetir o texto enviado (inteiro, curto ou em pedaço). O envio é o REAL (`sendEvolutionTextMessage`); só o
 * `fetch` responde, como uma Evolution que devolvesse o texto no motivo.
 */
const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const SENTINELA = 'SENTINELA-ENTREGA-3301';

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
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A Evolution responde `status` e põe no motivo o que `eco` fizer com o texto enviado. */
function evolutionEcoando(status: number, eco: (texto: string) => string) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const enviado = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const texto = String(enviado.text ?? enviado.textMessage ?? enviado.body ?? (enviado.message as { text?: string })?.text ?? '');
    return new Response(JSON.stringify({ status, error: 'Erro', response: { message: [`numero invalido para: ${eco(texto)}`] } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

async function responder(resposta: string) {
  const r = await executeConversationAIReply({
    admin: fake as never,
    connection: { id: CONN, organization_id: ORG, name: 'Aurora', config: { aiEnabled: true, instanceName: 'inst-teste' } },
    payload: { threadId: THREAD, replyText: resposta, metadata: { native_ai: true }, automationSource: 'native_crm' } as never,
  });
  const mensagem = fake.rowsOf('conversation_messages').find((m) => m.thread_id === THREAD && m.direction === 'outbound');
  const conversa = fake.rowsOf('conversation_threads').find((t) => t.id === THREAD)?.metadata as Record<string, unknown>;
  return {
    mensagem,
    deliveryError: (mensagem?.metadata as Record<string, unknown> | undefined)?.delivery_error,
    aiFailureError: conversa.aiFailureError,
    aviso: (r as { warning?: string | null }).warning,
    previa: conversa.lastMessagePreview,
  };
}

describe('falha de entrega da resposta da IA: texto fixo, sem a mensagem livre da Evolution', () => {
  const casos: Array<[string, string, (texto: string) => string]> = [
    ['eco inteiro de uma resposta longa', `Oi Marina, aqui é a Aurora ${SENTINELA}. Posso te ajudar?`, (t) => t],
    ['eco de uma resposta curta', 'Oi Ana', (t) => t],
    ['eco parcial (só o começo)', `${SENTINELA} e o resto da resposta que ficou de fora`, (t) => t.slice(0, 30)],
  ];

  for (const [nome, resposta, eco] of casos) {
    it(`${nome}: HTTP 400 vira "Evolution recusou o envio (HTTP 400)." nos três lugares`, async () => {
      vi.stubGlobal('fetch', evolutionEcoando(400, eco));
      const r = await responder(resposta);
      for (const [onde, valor] of [['delivery_error', r.deliveryError], ['aiFailureError', r.aiFailureError], ['aviso', r.aviso]] as const) {
        expect(valor, onde).toBe('Evolution recusou o envio (HTTP 400).');
      }
      // O texto continua como CONTEÚDO (o balão e a prévia da caixa de entrada mostram a resposta); só o diagnóstico é fixo.
      expect(r.mensagem?.content).toBe(resposta);
      expect(r.previa).toBe(resposta);
    });
  }

  it('HTTP 5xx: o diagnóstico diz que não dá para saber se saiu, sem o motivo da Evolution', async () => {
    vi.stubGlobal('fetch', evolutionEcoando(503, (t) => t));
    const r = await responder(`Oi Marina ${SENTINELA}`);
    expect(r.deliveryError).toBe('Evolution respondeu HTTP 503; não dá para saber se a mensagem saiu.');
    expect(JSON.stringify([r.deliveryError, r.aiFailureError, r.aviso])).not.toContain(SENTINELA);
  });

  it('sem resposta da Evolution (rede): diagnóstico fixo, sem a mensagem do erro de rede', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(`fetch failed ${SENTINELA}`); }));
    const r = await responder('Oi Marina, tudo bem?');
    expect(r.deliveryError).toBe('Sem resposta da Evolution (rede ou tempo esgotado); não dá para saber se a mensagem saiu.');
    expect(JSON.stringify([r.deliveryError, r.aiFailureError, r.aviso])).not.toContain(SENTINELA);
  });
});
