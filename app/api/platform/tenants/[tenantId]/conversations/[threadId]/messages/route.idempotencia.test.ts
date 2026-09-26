import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { fingerprintDoPedido } from '@/lib/conversations/idempotenciaManual';
import { PENDING_REVIEW_WARNING } from '@/lib/conversations/dispatchConversationOutbound';

/**
 * Replay do envio manual: a mesma chave com o MESMO pedido devolve a tentativa original sem
 * nenhum efeito novo — nao pausa automacao de novo, nao reenvia, nao mexe no preview da thread.
 * A mesma chave com pedido DIFERENTE e conflito (409), nunca um segundo envio.
 */

let fake: FakeSupabaseAdmin;
let entregue: Record<string, unknown> | null = null;
let dispatchResultado: { messageId: string; status: string; error: string | null; duplicate?: boolean };
const requireTenantAccessMock = vi.fn();
const sendTextMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const THREAD = '33333333-3333-4333-8333-333333333333';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const USER = '44444444-4444-4444-8444-444444444444';
const CHAVE = 'manual:33333333-3333-4333-8333-333333333333:retry-1';

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => fake }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: vi.fn(async () => ({
    apiUrl: 'https://evolution.example.com',
    apiKey: 'CHAVE-EVO',
    source: 'connection',
  })),
}));
vi.mock('@/lib/channels/evolution', () => ({
  sendEvolutionTextMessage: (...args: unknown[]) => sendTextMock(...args),
}));
vi.mock('@/lib/conversations/conversationMedia', () => ({
  dispatchConversationMedia: vi.fn(async () => ({ delivery_status: 'sent', provider_message_id: 'evo-2' })),
}));
vi.mock('@/lib/conversations/server', () => ({
  getConversationAssigneeDisplayName: () => 'Vitoria',
  loadConversationThreadInboxItem: vi.fn(async () => ({ id: THREAD })),
}));
vi.mock('@/lib/conversations/dispatchConversationOutbound', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/conversations/dispatchConversationOutbound')>();
  return {
    ...original,
    dispatchManualConversationOutbound: async ({
      message,
      deliver,
    }: {
      message: Record<string, unknown>;
      deliver: () => Promise<unknown>;
    }) => {
      entregue = message;
      if (!dispatchResultado.duplicate) {
        await deliver();
        // Imita o dispatcher real: a linha existe quando a rota a rebusca por id.
        fake.rowsOf('conversation_messages').push({
          id: dispatchResultado.messageId,
          thread_id: message.threadId,
          organization_id: message.organizationId,
          direction: 'outbound',
          message_type: message.messageType,
          author_name: message.authorName,
          content: message.content,
          metadata: message.metadata,
          idempotency_key: message.idempotencyKey,
          delivery_status: dispatchResultado.status,
          sent_at: message.sentAt,
          created_at: message.sentAt,
        });
      }
      return dispatchResultado;
    },
  };
});

import { POST } from './route';

const pedido = (content: string) => ({
  organizationId: TENANT,
  threadId: THREAD,
  atorId: USER,
  direction: 'outbound',
  content,
  attachmentPath: null,
  sendExternal: true,
});

function seed(opts: {
  config?: Record<string, unknown>;
  linhaExistente?: Record<string, unknown> | null;
} = {}) {
  fake = createFakeSupabaseAdmin({
    conversation_threads: [
      {
        id: THREAD,
        organization_id: TENANT,
        status: 'human_active',
        metadata: { marcadorOriginal: true, lastMessagePreview: 'texto de antes' },
        channel_connection_id: CONNECTION,
        contact_phone: '5521999990000',
        assigned_user_id: USER,
        deal_id: null,
      },
    ],
    channel_connections: [
      {
        id: CONNECTION,
        organization_id: TENANT,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: 'Recepcao',
        config: { instanceName: 'recepcao', ...(opts.config ?? {}) },
      },
    ],
    conversation_messages: opts.linhaExistente === null ? [] : [
      opts.linhaExistente ?? {
        id: 'msg-original',
        thread_id: THREAD,
        organization_id: TENANT,
        direction: 'outbound',
        message_type: 'text',
        author_name: 'Vitoria',
        content: 'Oi, confirmo amanha as 14h',
        metadata: { intencao: { versao: 1, hash: fingerprintDoPedido(pedido('Oi, confirmo amanha as 14h')) } },
        idempotency_key: CHAVE,
        delivery_status: 'sent',
        delivery_error: null,
        sent_at: '2026-09-26T12:00:00.000Z',
        created_at: '2026-09-26T12:00:00.000Z',
      },
    ],
  });
}

function post(body: unknown) {
  return POST(
    new Request(`https://crm.test/api/platform/tenants/${TENANT}/conversations/${THREAD}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tenantId: TENANT, threadId: THREAD }) },
  );
}

const thread = () => fake.rowsOf('conversation_threads')[0] as { metadata: Record<string, unknown>; status: string };
const pausas = () => fake.rpcCalls.filter((call) => call.name === 'pause_automation_enrollments_for_thread');

beforeEach(() => {
  vi.clearAllMocks();
  entregue = null;
  dispatchResultado = { messageId: 'msg-nova', status: 'sent', error: null };
  sendTextMock.mockResolvedValue({ providerMessageId: 'evo-1', attemptLabel: 'number_text', raw: {} });
  requireTenantAccessMock.mockResolvedValue({
    profile: {
      id: USER,
      email: 'vitoria@clinica.com',
      first_name: 'Vitoria',
      last_name: null,
      nickname: 'Vitoria',
      role: 'clinic_staff',
      organization_id: TENANT,
    },
  });
});

describe('replay: mesma chave, mesmo pedido', () => {
  it('devolve a tentativa original sem NENHUM efeito novo', async () => {
    seed();

    const response = await post({
      direction: 'outbound',
      content: 'Oi, confirmo amanha as 14h',
      idempotency_key: CHAVE,
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.replayed).toBe(true);
    expect((body.message as { id: string }).id).toBe('msg-original');
    expect(body.warning).toBeNull();
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(pausas()).toHaveLength(0);
    expect(entregue).toBeNull();
    // O preview da conversa continua o de antes — o corpo do segundo POST nao vaza para a lista.
    expect(thread().metadata.marcadorOriginal).toBe(true);
    expect(thread().metadata.lastMessagePreview).toBe('texto de antes');
  });

  it('linha que ficou pending volta com a frase de revisao obrigatoria, sem reenvio', async () => {
    seed({
      linhaExistente: {
        id: 'msg-pendente',
        thread_id: THREAD,
        organization_id: TENANT,
        direction: 'outbound',
        message_type: 'text',
        author_name: 'Vitoria',
        content: 'Oi, confirmo amanha as 14h',
        metadata: { intencao: { versao: 1, hash: fingerprintDoPedido(pedido('Oi, confirmo amanha as 14h')) } },
        idempotency_key: CHAVE,
        delivery_status: 'pending',
        delivery_error: null,
        sent_at: '2026-09-26T12:00:00.000Z',
        created_at: '2026-09-26T12:00:00.000Z',
      },
    });

    const response = await post({
      direction: 'outbound',
      content: 'Oi, confirmo amanha as 14h',
      idempotency_key: CHAVE,
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.warning).toBe(PENDING_REVIEW_WARNING);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('nao depende do perfil nem da configuracao ATUAIS: replay passa mesmo sem nome utilizavel', async () => {
    // Entre a 1a tentativa e o retry, a assinatura ligou e o perfil perdeu o nome. O pedido
    // original ja foi feito: o retry devolve a linha, nao um 422 novo.
    seed({ config: { signManualReplies: true } });
    requireTenantAccessMock.mockResolvedValue({
      profile: {
        id: USER,
        email: 'vitoria@clinica.com',
        first_name: null,
        last_name: null,
        nickname: null,
        role: 'clinic_staff',
        organization_id: TENANT,
      },
    });

    const response = await post({
      direction: 'outbound',
      content: 'Oi, confirmo amanha as 14h',
      idempotency_key: CHAVE,
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { replayed?: boolean }).replayed).toBe(true);
  });
});

describe('conflito: mesma chave, pedido diferente', () => {
  it('devolve 409 sem tocar em nada', async () => {
    seed();

    const response = await post({
      direction: 'outbound',
      content: 'texto COMPLETAMENTE diferente',
      idempotency_key: CHAVE,
    });

    expect(response.status).toBe(409);
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(pausas()).toHaveLength(0);
    expect(thread().metadata.lastMessagePreview).toBe('texto de antes');
  });

  it('corrida que o dispatcher segurou: fingerprint divergente tambem e 409, sem update de thread', async () => {
    // Dois POSTs simultaneos passam pela consulta previa sem achar nada; o INSERT decide e o
    // perdedor recebe duplicate. Se o pedido do perdedor nem era o mesmo, e conflito.
    seed({ linhaExistente: null });
    fake.rowsOf('conversation_messages').push({
      id: 'msg-vencedora',
      thread_id: THREAD,
      organization_id: TENANT,
      direction: 'outbound',
      message_type: 'text',
      author_name: 'Vitoria',
      content: 'corpo do vencedor',
      metadata: { intencao: { versao: 1, hash: fingerprintDoPedido(pedido('corpo do vencedor')) } },
      idempotency_key: CHAVE,
      delivery_status: 'sent',
      delivery_error: null,
      sent_at: '2026-09-26T12:00:00.000Z',
      created_at: '2026-09-26T12:00:00.000Z',
    });
    // A consulta previa nao pode achar a linha (corrida): rouba o filtro tirando a chave da vista
    // e devolvendo-a so no caminho do dispatcher? Nao da no fake — em vez disso, o dispatcher
    // devolve duplicate apontando para a vencedora, como na corrida real.
    dispatchResultado = { messageId: 'msg-vencedora', status: 'sent', error: null, duplicate: true };

    const response = await post({
      direction: 'outbound',
      content: 'corpo do PERDEDOR, diferente',
      // Sem chave do cliente a consulta previa nao roda — exatamente como numa corrida em que
      // ela nao viu a linha ainda; o dispatcher e quem devolve duplicate.
    });

    expect(response.status).toBe(409);
    expect(thread().metadata.lastMessagePreview).toBe('texto de antes');
  });

  it('corrida com o MESMO pedido devolve replay, sem update de thread', async () => {
    seed({ linhaExistente: null });
    fake.rowsOf('conversation_messages').push({
      id: 'msg-vencedora',
      thread_id: THREAD,
      organization_id: TENANT,
      direction: 'outbound',
      message_type: 'text',
      author_name: 'Vitoria',
      content: 'mesmo corpo',
      metadata: { intencao: { versao: 1, hash: fingerprintDoPedido(pedido('mesmo corpo')) } },
      idempotency_key: CHAVE,
      delivery_status: 'sent',
      delivery_error: null,
      sent_at: '2026-09-26T12:00:00.000Z',
      created_at: '2026-09-26T12:00:00.000Z',
    });
    dispatchResultado = { messageId: 'msg-vencedora', status: 'sent', error: null, duplicate: true };

    const response = await post({ direction: 'outbound', content: 'mesmo corpo' });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.replayed).toBe(true);
    expect(thread().metadata.lastMessagePreview).toBe('texto de antes');
  });
});

describe('intencao nova com chave do cliente', () => {
  it('cria a mensagem com o fingerprint gravado no servidor, imune ao payload do navegador', async () => {
    seed({ linhaExistente: null });

    const response = await post({
      direction: 'outbound',
      content: 'primeira tentativa',
      idempotency_key: CHAVE,
      metadata: { intencao: { versao: 99, hash: 'forjado' } },
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.delivery_status).toBe('sent');
    expect(entregue?.idempotencyKey).toBe(CHAVE);
    const metadata = entregue?.metadata as { intencao?: { versao: number; hash: string } };
    expect(metadata.intencao?.versao).toBe(1);
    expect(metadata.intencao?.hash).toBe(fingerprintDoPedido(pedido('primeira tentativa')));
  });
});
