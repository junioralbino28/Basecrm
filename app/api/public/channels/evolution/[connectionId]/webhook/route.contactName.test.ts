import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * SÓ QUEM CHEGA NOMEIA O CONTATO.
 *
 * Uma mensagem de SAÍDA que entra por este webhook foi mandada do celular por uma pessoa (o que
 * a IA e o CRM enviam pela API não volta por aqui), e o `pushName` dela é o do DONO do número —
 * o nome do perfil do WhatsApp da conta, não o do lead.
 *
 * Até 24/09/2026 esse nome era gravado como nome do LEAD. Medido em produção: 4 dos 6 contatos
 * do Cenno Hub viraram "Aurora | Assessoria Cenoura Hub", e na Dra. Jéssica Barros um contato
 * virou "Barros Odontologia". O nome errado não fica na lista de contatos: segue para o contexto
 * que a Aurora lê, para o título do evento no Google Agenda e para o lembrete de reunião que é
 * enviado AO PRÓPRIO LEAD pelo WhatsApp.
 */

const afterMock = vi.fn();
let fake: FakeSupabaseAdmin;

vi.mock('next/server', () => ({ after: (callback: unknown) => afterMock(callback) }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => fake,
}));
vi.mock('@/lib/conversations/aiReply', () => ({
  generateConversationAutoReply: vi.fn(),
  executeConversationAIReply: vi.fn(),
}));
vi.mock('@/lib/conversations/conversationAIGate', () => ({
  loadFreshConversationAIGate: vi.fn(),
}));
vi.mock('@/lib/conversations/conversationAIFailure', () => ({
  recordConversationAIFailure: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/conversations/conversationRateLimit', () => ({
  consumeConversationRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock('@/lib/conversations/n8nAutomation', () => ({
  notifyConversationAutomation: vi.fn(),
}));

import { POST } from './route';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const BOARD = '66666666-6666-4666-8666-666666666666';
const STAGE = '77777777-7777-4777-8777-777777777777';
const SECRET = 'segredo-de-teste';
const JID = '5521999990000@s.whatsapp.net';

/** O nome do perfil do número da agência — o que o WhatsApp manda quando ELA escreve. */
const DONO_DO_NUMERO = 'Aurora | Assessoria Cenoura Hub';
/** O nome do lead de verdade, como ele aparece no WhatsApp dele. */
const LEAD = 'Púlpitos Gênesis';

function seed(config: Record<string, unknown> = {}) {
  fake = createFakeSupabaseAdmin({
    channel_connections: [
      {
        id: CONNECTION,
        organization_id: TENANT,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: 'WhatsApp IA',
        config: { webhookSecret: SECRET, instanceName: 'teste', aiEnabled: true, ...config },
        metadata: {},
      },
    ],
    boards: [{ id: BOARD, organization_id: TENANT, name: 'Funil', key: 'funil', position: 0, created_at: '2026-01-01', deleted_at: null }],
    board_stages: [{ id: STAGE, organization_id: TENANT, board_id: BOARD, name: 'Novo', order: 0 }],
  });
}

let timestamp = 1_790_000_000;
function payload(text: string, id: string, fromMe: boolean) {
  timestamp += 30;
  return {
    event: 'messages.upsert',
    instance: 'teste',
    data: {
      key: { id, remoteJid: JID, fromMe },
      // É ESTE o ponto: quando quem escreve é a agência, o WhatsApp manda o nome DELA.
      pushName: fromMe ? DONO_DO_NUMERO : LEAD,
      message: { conversation: text },
      messageTimestamp: timestamp,
    },
  };
}

async function post(body: unknown) {
  const response = await POST(
    new Request(`https://crm.test/api/public/channels/evolution/${CONNECTION}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ connectionId: CONNECTION }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const contato = () => fake.rowsOf('contacts')[0] as { name: string; phone: string };
const thread = () => fake.rowsOf('conversation_threads')[0] as { contact_name: string | null; title: string | null };

beforeEach(() => {
  afterMock.mockClear();
});

describe('webhook: só a mensagem que CHEGA nomeia o contato', () => {
  it('mensagem do celular NÃO renomeia o contato com o nome do dono do número', async () => {
    seed({ manualReplyPausesAI: true });

    await post(payload('Oi, vi o anúncio de vocês', 'IN-1', false));
    expect(contato().name).toBe(LEAD);

    // Foi isto que quebrou em produção: o Junior respondeu pelo celular e o contato do lead
    // passou a se chamar como o perfil do número da agência.
    await post(payload('Oi! Consegue falar agora?', 'OUT-1', true));

    expect(contato().name).toBe(LEAD);
    expect(contato().name).not.toBe(DONO_DO_NUMERO);
    expect(thread().contact_name).toBe(LEAD);
  });

  it('o lead troca o nome do perfil: aí sim o contato é renomeado', async () => {
    seed();
    await post(payload('oi', 'IN-1', false));
    expect(contato().name).toBe(LEAD);

    // Mesmo lead, mesmo número, nome do perfil trocado — e a mensagem CHEGA.
    timestamp += 30;
    await post({
      event: 'messages.upsert',
      instance: 'teste',
      data: {
        key: { id: 'IN-2', remoteJid: JID, fromMe: false },
        pushName: 'Carlos',
        message: { conversation: 'aqui é o Carlos, troquei o perfil' },
        messageTimestamp: timestamp,
      },
    });

    // Nomear continua funcionando — o conserto restringe a DIREÇÃO, não desliga a nomeação.
    expect(contato().name).toBe('Carlos');
  });

  it('conversa que NASCE de uma mensagem do celular não batiza o lead com o nome da agência', async () => {
    seed({ manualReplyPausesAI: true });

    // Número novo, puxado pelo celular: não existe nome do lead em lugar nenhum ainda.
    await post(payload('Oi, tudo bem? Aqui é da Cenoura Hub', 'OUT-1', true));

    // O certo é cair no rótulo por telefone, nunca no nome do dono do número.
    expect(contato().name).not.toBe(DONO_DO_NUMERO);
    expect(contato().name).toMatch(/Lead WhatsApp/i);
    expect(thread().title).not.toContain(DONO_DO_NUMERO);

    // E quando o lead responde, o nome dele entra normalmente.
    await post(payload('oi! tudo sim', 'IN-1', false));
    expect(contato().name).toBe(LEAD);
  });
});
