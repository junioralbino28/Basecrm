import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * Envio manual com o rastro da resposta nativa forjado no metadata (2ª rodada do Codex, achado 1). A rota
 * tem que gravar a mensagem SEM essas chaves, inclusive no envio local (`send_external: false`), que fica
 * `sent` sem mandar nada ao WhatsApp.
 */
let fake: FakeSupabaseAdmin;
let entregue: Record<string, unknown> | null = null;
const requireTenantAccessMock = vi.fn();
const sendTextMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const THREAD = '33333333-3333-4333-8333-333333333333';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const USER = '44444444-4444-4444-8444-444444444444';

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => fake }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: vi.fn(async () => ({ apiUrl: 'https://evolution.example.com', apiKey: 'CHAVE', source: 'connection' })),
}));
vi.mock('@/lib/channels/evolution', () => ({
  sendEvolutionTextMessage: (...args: unknown[]) => sendTextMock(...args),
}));
vi.mock('@/lib/conversations/conversationMedia', () => ({ dispatchConversationMedia: vi.fn() }));
vi.mock('@/lib/conversations/server', () => ({
  getConversationAssigneeDisplayName: () => 'Vitoria',
  loadConversationThreadInboxItem: vi.fn(async () => ({ id: THREAD })),
}));
// Executa o `deliver` de verdade e guarda o que seria persistido, sem o caminho de persistencia.
vi.mock('@/lib/conversations/dispatchConversationOutbound', () => ({
  dispatchManualConversationOutbound: async ({ message, deliver }: { message: Record<string, unknown>; deliver: () => Promise<unknown> }) => {
    entregue = message;
    await deliver();
    return { messageId: 'msg-1', status: 'sent', error: null };
  },
}));

import { POST } from './route';

const RASTRO = {
  native_ai: true,
  prompt_source: 'default',
  prompt_sha256: 'a'.repeat(64),
  agent_id: 'forjado',
  agent_version: 7,
  ai_timing: { total_ms: 1 },
};

function seed() {
  fake = createFakeSupabaseAdmin({
    conversation_threads: [{
      id: THREAD, organization_id: TENANT, status: 'human_active', metadata: {},
      channel_connection_id: CONNECTION, contact_phone: '5521999990000', assigned_user_id: USER, deal_id: null,
    }],
    channel_connections: [{
      id: CONNECTION, organization_id: TENANT, provider: 'evolution', channel_type: 'whatsapp', name: 'Recepcao',
      config: { instanceName: 'recepcao' },
    }],
    conversation_messages: [{
      id: 'msg-1', thread_id: THREAD, organization_id: TENANT, direction: 'outbound', message_type: 'text',
      author_name: 'Vitoria', content: '', metadata: {}, sent_at: '2026-09-29T12:00:00.000Z', created_at: '2026-09-29T12:00:00.000Z',
    }],
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

const gravado = () => entregue as { metadata: Record<string, unknown> };

beforeEach(() => {
  vi.clearAllMocks();
  entregue = null;
  seed();
  sendTextMock.mockResolvedValue({ providerMessageId: 'evo-1', attemptLabel: 'number_text', raw: {} });
  requireTenantAccessMock.mockResolvedValue({
    profile: { id: USER, email: 'vitoria@cliente.com', first_name: 'Vitoria', last_name: null, nickname: 'Vitoria', role: 'clinic_staff', organization_id: TENANT },
  });
});

describe('envio manual e o rastro nativo', () => {
  it('envio local (send_external: false) com o rastro forjado: gravado SEM as seis chaves, e nada sai para o WhatsApp', async () => {
    const response = await post({ direction: 'outbound', content: 'parece nativa', send_external: false, metadata: { ...RASTRO, campanha: 'meta' } });

    expect(response.status).toBe(201);
    expect(sendTextMock).not.toHaveBeenCalled();
    const metadata = gravado().metadata;
    for (const chave of Object.keys(RASTRO)) expect(chave in metadata, chave).toBe(false);
    expect(metadata.campanha).toBe('meta');
    expect(metadata.atendente).toMatchObject({ atorId: USER });
  });

  it('envio normal com o rastro forjado: o texto sai e a mensagem é gravada sem as chaves', async () => {
    const response = await post({ direction: 'outbound', content: 'oi', metadata: RASTRO });

    expect(response.status).toBe(201);
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    for (const chave of Object.keys(RASTRO)) expect(chave in gravado().metadata, chave).toBe(false);
  });
});
