import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * A assinatura do atendente vale SO para resposta humana manual (decisao do Junior, 25/09/2026:
 * "so humano"). Estes caminhos mandam mensagem sem ninguem no teclado — assinar ali poria um nome
 * de gente numa mensagem automatica, e na IA produziria "Aurora: Oi, aqui e a Aurora", porque o
 * prompt dela ja se apresenta dentro do texto.
 *
 * O teste tem duas metades, e a primeira e a que prova: o payload REAL da IA com o interruptor
 * ligado. A segunda e uma rede estrutural, por `import` (nao por presenca da palavra no arquivo,
 * que um comentario derrubaria).
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';

let fake: FakeSupabaseAdmin;
const sendTextMock = vi.fn();

vi.mock('@/lib/conversations/conversationAIGate', () => ({
  loadFreshConversationAIGate: vi.fn(async () => ({
    ok: true,
    connection: {
      id: CONN,
      organization_id: ORG,
      name: 'Aurora',
      config: { aiEnabled: true, instanceName: 'inst-teste', signManualReplies: true },
    },
  })),
}));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: vi.fn(async () => ({
    apiUrl: 'https://evolution.example',
    apiKey: 'chave-de-teste',
    source: 'connection',
  })),
}));
vi.mock('@/lib/channels/evolution', () => ({
  sendEvolutionTextMessage: (...args: unknown[]) => sendTextMock(...args),
}));
vi.mock('@/lib/conversations/server', () => ({
  loadConversationThreadInboxItem: vi.fn(async () => {
    const row = fake.rowsOf('conversation_threads').find((thread) => thread.id === THREAD);
    return row ? { id: row.id, status: row.status, metadata: row.metadata } : null;
  }),
}));

import { executeConversationAIReply } from './aiReply';

beforeEach(() => {
  vi.clearAllMocks();
  sendTextMock.mockResolvedValue({ providerMessageId: 'msg-1', attemptLabel: 'number_text', raw: {} });
  fake = createFakeSupabaseAdmin({
    conversation_threads: [{
      id: THREAD,
      organization_id: ORG,
      channel_connection_id: CONN,
      contact_id: null,
      deal_id: null,
      contact_name: 'Marina',
      contact_phone: '5521999990000',
      status: 'ai_active',
      assigned_user_id: null,
      metadata: { lastDirection: 'inbound', unreadCount: 1 },
    }],
  });
});

describe('a IA nao assina, mesmo no numero com a assinatura ligada', () => {
  it('o texto que sai para o lead e exatamente o que a IA escreveu', async () => {
    await executeConversationAIReply({
      admin: fake as never,
      connection: {
        id: CONN,
        organization_id: ORG,
        name: 'Aurora',
        config: { aiEnabled: true, instanceName: 'inst-teste', signManualReplies: true },
      },
      payload: { threadId: THREAD, replyText: 'Perfeito, anotei aqui.' },
    });

    expect(sendTextMock).toHaveBeenCalled();
    expect((sendTextMock.mock.calls[0]?.[0] as { text: string }).text).toBe('Perfeito, anotei aqui.');
  });

  it('o conteudo gravado tambem sai sem prefixo', async () => {
    await executeConversationAIReply({
      admin: fake as never,
      connection: {
        id: CONN,
        organization_id: ORG,
        name: 'Aurora',
        config: { aiEnabled: true, instanceName: 'inst-teste', signManualReplies: true },
      },
      payload: { threadId: THREAD, replyText: 'Perfeito, anotei aqui.' },
    });

    const saida = fake.rowsOf('conversation_messages').find((row) => row.direction === 'outbound');
    expect(saida?.content).toBe('Perfeito, anotei aqui.');
  });
});

describe('rede estrutural: quem nao pode alcancar o modulo de assinatura', () => {
  // Por `import`, e nao pela presenca do nome no arquivo: um comentario citando a funcao
  // derrubaria um teste de texto solto sem que nada estivesse errado.
  const IMPORTA_ASSINATURA = /from\s+['"][^'"]*assinaturaAtendente['"]/;

  const AUTOMATICOS = [
    ['a resposta da IA (cobre tambem a cutucada, que envia por ela)', 'lib/conversations/aiReply.ts'],
    ['o lembrete de reuniao', 'lib/conversations/meetingReminder.ts'],
    ['o executor de automacao', 'lib/automations/executor.ts'],
    ['o teste de envio da conexao', 'app/api/platform/tenants/[tenantId]/channels/[connectionId]/send-test/route.ts'],
    ['o despacho de midia, que recebe a legenda ja pronta', 'lib/conversations/conversationMedia.ts'],
  ] as const;

  it.each(AUTOMATICOS)('%s nao importa o modulo de assinatura', (_rotulo, caminho) => {
    const fonte = readFileSync(resolve(process.cwd(), caminho), 'utf8');
    expect(fonte).not.toMatch(IMPORTA_ASSINATURA);
  });

  it('a rota de envio manual e a UNICA que importa', () => {
    const rota = resolve(
      process.cwd(),
      'app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts',
    );
    expect(readFileSync(rota, 'utf8')).toMatch(IMPORTA_ASSINATURA);
  });
});
