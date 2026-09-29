// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { lerMedicaoDoErro, resumirMedicao } from '@/lib/ai/medicaoResposta';

// O prompt vem do catalogo/banco em producao; aqui basta um que peca o historico.
vi.mock('@/lib/ai/prompts/server', () => ({
  getResolvedPrompt: async () => ({ content: 'Responda ao lead.\n{{recentMessagesText}}', source: 'catalog' }),
}));

import { generateConversationAutoReply } from './aiReply';

/**
 * Medicao de tempo de toda resposta de IA (29/09). O SDK de verdade roda aqui, com o provedor Anthropic
 * de verdade: so a rede e trocada. E assim que se prova que as novas tentativas AUTOMATICAS do SDK
 * (invisiveis de fora de generateText) aparecem na medicao, que era a hipotese nao verificavel dos 51 s.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';

function seedAdmin() {
  return createFakeSupabaseAdmin({
    channel_connections: [{ id: CONN, organization_id: ORG, name: 'Comercial', config: { aiEnabled: true } }],
    ai_feature_flags: [{ organization_id: ORG, key: 'ai_conversation_auto_reply', enabled: true }],
    organization_settings: [{
      organization_id: ORG,
      ai_enabled: true,
      ai_provider: 'anthropic',
      ai_model: 'claude-sonnet-5',
      ai_anthropic_key: 'sk-ant-teste',
    }],
    organizations: [{ id: ORG, name: 'Empresa' }],
  });
}

const RESPOSTA = { replyText: 'Oi! Aqui e a Aurora. Com quem eu falo?', shouldHandoff: false };

/** Resposta da API de mensagens da Anthropic nos dois modos de saida estruturada do provedor. */
function respostaAnthropic(corpoPedido: string) {
  const pedido = JSON.parse(corpoPedido) as { tools?: Array<{ name: string }> };
  const viaFerramenta = pedido.tools?.some((tool) => tool.name === 'json') === true;
  const content = viaFerramenta
    ? [{ type: 'tool_use', id: 'toolu_1', name: 'json', input: RESPOSTA }]
    : [{ type: 'text', text: JSON.stringify(RESPOSTA) }];
  return new Response(JSON.stringify({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content,
    stop_reason: viaFerramenta ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** 529 = sobrecarga da Anthropic. `retry-after-ms` so encurta a espera do SDK para o teste nao demorar. */
function sobrecarga() {
  return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), {
    status: 529,
    headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
  });
}

function gerar(admin: ReturnType<typeof seedAdmin>) {
  return generateConversationAutoReply({
    admin: admin as never,
    organizationId: ORG,
    connectionId: CONN,
    contactName: 'Pedro',
    contactPhone: '5511999999999',
    recentMessages: [{ id: 'm1', direction: 'inbound', message_type: 'text', author_name: 'Pedro', content: 'oi', sent_at: '2026-09-29T12:00:00.000Z', metadata: {} }] as never,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('medicao do tempo da resposta da IA (29/09)', () => {
  it('caminho normal: 1 chamada ao provedor, 1 geracao, sem falha', async () => {
    const rede = vi.fn(async (_url: unknown, init?: RequestInit) => respostaAnthropic(String(init?.body)));
    vi.stubGlobal('fetch', rede);

    const resultado = await gerar(seedAdmin());

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.object.replyText).toBe(RESPOSTA.replyText);
    expect(resultado.timing).toMatchObject({
      model_http_calls: 1,
      model_http_errors: [],
      generations: 1,
      repaired: false,
      calendar_ms: expect.any(Number),
      setup_ms: expect.any(Number),
      model_ms: expect.any(Number),
    });
    expect(resultado.timing.total_ms).toBeGreaterThanOrEqual(resultado.timing.model_ms);
    // O pedido saiu pelo fetch medido, para a API da Anthropic.
    expect(String(rede.mock.calls[0]?.[0])).toContain('api.anthropic.com');
  });

  it('provedor sobrecarregado: a nova tentativa automatica do SDK aparece na medicao', async () => {
    const rede = vi.fn()
      .mockImplementationOnce(async () => sobrecarga())
      .mockImplementation(async (_url: unknown, init?: RequestInit) => respostaAnthropic(String(init?.body)));
    vi.stubGlobal('fetch', rede);

    const resultado = await gerar(seedAdmin());

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(rede).toHaveBeenCalledTimes(2);
    expect(resultado.timing.generations).toBe(1);
    expect(resultado.timing.model_http_calls).toBe(2);
    expect(resultado.timing.model_http_errors).toEqual([529]);
  });

  it('provedor recusa todas as tentativas: a medicao vai pendurada no erro, para o registro da falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sobrecarga()));

    const erro = await gerar(seedAdmin()).then(() => null, (e: unknown) => e);

    const medicao = lerMedicaoDoErro(erro);
    expect(medicao).not.toBeNull();
    // maxRetries: 2 = 1 chamada + 2 novas tentativas.
    expect(medicao?.model_http_calls).toBe(3);
    expect(medicao?.model_http_errors).toEqual([529, 529, 529]);
    expect(resumirMedicao(medicao!)).toContain('3 chamada(s), falhas 529,529,529');
  });

  it('erro de rede (sem resposta HTTP) entra como status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

    const erro = await gerar(seedAdmin()).then(() => null, (e: unknown) => e);

    expect(lerMedicaoDoErro(erro)?.model_http_errors[0]).toBe(0);
  });
});
