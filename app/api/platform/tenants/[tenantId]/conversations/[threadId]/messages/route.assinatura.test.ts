import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * Identidade do atendente no envio manual.
 *
 * Duas coisas separadas e testadas separadamente:
 *  - QUEM ASSINA o texto que vai para a Evolution (so com o interruptor ligado);
 *  - QUEM FICA GRAVADO como autor no CRM (sempre o perfil autenticado, nos dois modos).
 *
 * O `content` persistido nunca leva o prefixo: o historico que a IA le ja traz o autor num campo
 * separado, e o prefixo dentro do texto duplicaria o dado.
 */

let fake: FakeSupabaseAdmin;
let entregue: Record<string, unknown> | null = null;
const requireTenantAccessMock = vi.fn();
const sendTextMock = vi.fn();
const sendMediaMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const THREAD = '33333333-3333-4333-8333-333333333333';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const USER = '44444444-4444-4444-8444-444444444444';
const DEAL = '55555555-5555-4555-8555-555555555555';

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => fake }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: vi.fn(async () => ({
    apiUrl: 'https://evolution.example.com',
    apiKey: 'CHAVE',
    source: 'connection',
  })),
}));
vi.mock('@/lib/channels/evolution', () => ({
  sendEvolutionTextMessage: (...args: unknown[]) => sendTextMock(...args),
}));
vi.mock('@/lib/conversations/conversationMedia', () => ({
  dispatchConversationMedia: (...args: unknown[]) => sendMediaMock(...args),
}));
vi.mock('@/lib/conversations/server', () => ({
  getConversationAssigneeDisplayName: () => 'Vitoria',
  loadConversationThreadInboxItem: vi.fn(async () => ({ id: THREAD })),
}));
// Executa o `deliver` de verdade e guarda o que seria persistido, sem o caminho de persistencia.
vi.mock('@/lib/conversations/dispatchConversationOutbound', () => ({
  dispatchManualConversationOutbound: async ({
    message,
    deliver,
  }: {
    message: Record<string, unknown>;
    deliver: () => Promise<unknown>;
  }) => {
    entregue = message;
    await deliver();
    return { messageId: 'msg-1', status: 'sent', error: null };
  },
}));

import { POST } from './route';

function seed(config: Record<string, unknown>) {
  fake = createFakeSupabaseAdmin({
    conversation_threads: [
      {
        id: THREAD,
        organization_id: TENANT,
        status: 'human_active',
        metadata: {},
        channel_connection_id: CONNECTION,
        contact_phone: '5521999990000',
        assigned_user_id: USER,
        deal_id: DEAL,
      },
    ],
    channel_connections: [
      {
        id: CONNECTION,
        organization_id: TENANT,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: 'Recepcao',
        config: { instanceName: 'recepcao', ...config },
      },
    ],
    conversation_messages: [
      {
        id: 'msg-1',
        thread_id: THREAD,
        organization_id: TENANT,
        direction: 'outbound',
        message_type: 'text',
        author_name: 'Vitoria',
        content: '',
        metadata: {},
        sent_at: '2026-09-25T12:00:00.000Z',
        created_at: '2026-09-25T12:00:00.000Z',
      },
    ],
    deal_files: [
      {
        id: 'arq-1',
        deal_id: DEAL,
        file_path: 'tenant/audio.ogg',
        file_name: 'audio.ogg',
        mime_type: 'audio/ogg',
        file_size: 1234,
      },
    ],
    deals: [{ id: DEAL, organization_id: TENANT }],
  });

  // O helper nao imita o Storage; o anexo precisa do signed URL gerado no servidor.
  (fake as unknown as { storage: unknown }).storage = {
    from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/arquivo' }, error: null }),
    }),
  };
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

/** O que a rota gravou na mensagem. */
const gravado = () => entregue as { content: string; authorName: string; metadata: Record<string, unknown> };
/** O texto que saiu para a Evolution. */
const textoEnviado = () => (sendTextMock.mock.calls[0]?.[0] as { text: string } | undefined)?.text;

beforeEach(() => {
  vi.clearAllMocks();
  entregue = null;
  sendTextMock.mockResolvedValue({ providerMessageId: 'evo-1', attemptLabel: 'number_text', raw: {} });
  sendMediaMock.mockResolvedValue({ delivery_status: 'sent', provider_message_id: 'evo-2' });
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

describe('envio manual: quem fica gravado como autor', () => {
  it('com a assinatura DESLIGADA o autor ja e o perfil autenticado, nao o author_name do corpo', async () => {
    // `author_name` e campo livre do payload: se vencesse, quem pode responder se passaria por
    // outro atendente — e a IA le exatamente esse campo para montar o historico.
    seed({});

    const response = await post({ direction: 'outbound', author_name: 'Dr. Adel', content: 'pode vir amanha' });

    expect(response.status).toBe(201);
    expect(gravado().authorName).toBe('Vitoria');
  });

  it('com a assinatura LIGADA o autor tambem e o perfil autenticado', async () => {
    seed({ signManualReplies: true });

    const response = await post({ direction: 'outbound', author_name: 'Dr. Adel', content: 'pode vir amanha' });

    expect(response.status).toBe(201);
    expect(gravado().authorName).toBe('Vitoria');
  });

  it('registra o ator no metadado, e o payload do navegador nao o sobrescreve', async () => {
    seed({ signManualReplies: true });

    const response = await post({
      direction: 'outbound',
      content: 'oi',
      metadata: { atendente: { atorId: 'forjado', nome: 'Dr. Adel', assinado: false } },
    });

    expect(response.status).toBe(201);
    expect(gravado().metadata.atendente).toEqual({
      versao: 1,
      atorId: USER,
      nome: 'Vitoria',
      assinado: true,
    });
  });

  it('com a assinatura desligada o metadado marca que nada foi assinado', async () => {
    seed({});

    await post({ direction: 'outbound', content: 'oi' });

    expect(gravado().metadata.atendente).toMatchObject({ atorId: USER, nome: 'Vitoria', assinado: false });
  });
});

describe('envio manual: assinatura do texto externo', () => {
  it('LIGADA: o lead recebe o nome e o CRM grava o texto puro', async () => {
    seed({ signManualReplies: true });

    const response = await post({ direction: 'outbound', content: 'Oi, confirmo amanha as 14h' });

    expect(response.status).toBe(201);
    expect(textoEnviado()).toBe('Vitoria: Oi, confirmo amanha as 14h');
    expect(gravado().content).toBe('Oi, confirmo amanha as 14h');
  });

  it('DESLIGADA: nada muda no texto externo — o comportamento de hoje', async () => {
    seed({});

    const response = await post({ direction: 'outbound', content: 'Oi, confirmo amanha as 14h' });

    expect(response.status).toBe(201);
    expect(textoEnviado()).toBe('Oi, confirmo amanha as 14h');
    expect(gravado().content).toBe('Oi, confirmo amanha as 14h');
  });

  it('nota interna nunca sai para o lead', async () => {
    seed({ signManualReplies: true });

    const response = await post({ direction: 'internal', content: 'lead pediu desconto' });

    expect(response.status).toBe(201);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('envio apenas local nao assina, porque nao ha payload externo', async () => {
    seed({ signManualReplies: true });

    const response = await post({ direction: 'outbound', send_external: false, content: 'registro' });

    expect(response.status).toBe(201);
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(gravado().metadata.atendente).toMatchObject({ assinado: false });
  });
});

describe('envio manual: recusas antes de qualquer efeito', () => {
  it('recusa quando a assinatura esta ligada e o perfil nao tem nome utilizavel', async () => {
    // O trecho antes do @ do e-mail vazaria o endereco ao lead, entao nao serve de identidade.
    seed({ signManualReplies: true });
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

    const response = await post({ direction: 'outbound', content: 'oi' });

    expect(response.status).toBe(422);
    expect(entregue).toBeNull();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('recusa texto que estoura o limite externo DEPOIS do prefixo', async () => {
    seed({ signManualReplies: true });

    const response = await post({ direction: 'outbound', content: 'a'.repeat(4000) });

    expect(response.status).toBe(422);
    expect(entregue).toBeNull();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('com a assinatura desligada, o mesmo texto no teto do schema passa', async () => {
    seed({});

    const response = await post({ direction: 'outbound', content: 'a'.repeat(4000) });

    expect(response.status).toBe(201);
    expect(textoEnviado()).toHaveLength(4000);
  });

  it('recusa audio externo acompanhado de texto, antes de criar a linha', async () => {
    // O caminho de audio da Evolution descarta a legenda: enviar assim registraria "enviado"
    // com um texto que o lead nunca recebeu.
    seed({ signManualReplies: true });

    const response = await post({
      direction: 'outbound',
      content: 'segue o audio explicando',
      attachment: { kind: 'audio', file_path: 'tenant/audio.ogg', file_name: 'audio.ogg' },
    });

    expect(response.status).toBe(422);
    expect(entregue).toBeNull();
    expect(sendMediaMock).not.toHaveBeenCalled();
  });

  it('audio sem texto continua passando', async () => {
    seed({ signManualReplies: true });

    const response = await post({
      direction: 'outbound',
      attachment: { kind: 'audio', file_path: 'tenant/audio.ogg', file_name: 'audio.ogg' },
    });

    expect(response.status).toBe(201);
    expect(sendMediaMock).toHaveBeenCalled();
  });
});
