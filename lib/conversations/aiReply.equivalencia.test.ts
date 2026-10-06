// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

const capturado = vi.hoisted(() => ({ prompts: [] as string[], modelos: [] as string[] }));

vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('ai')>();
  return {
    ...real,
    generateText: vi.fn(async (args: { prompt: string }) => {
      capturado.prompts.push(args.prompt);
      return { output: { replyText: 'ok', shouldHandoff: false } };
    }),
  };
});
vi.mock('@/lib/ai/config', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/config')>();
  return {
    ...real,
    getModel: vi.fn((_provider: string, _key: string, modelId: string) => {
      capturado.modelos.push(modelId);
      return { modelId };
    }),
  };
});

import { generateConversationAutoReply } from './aiReply';
import { buscarPromptResolvido } from '@/lib/ai/prompts/resolve';
import { resolveConversationAIAgentConfig } from './aiAgentConfig';

/**
 * Regra de ouro da Central de Agentes: até alguém mexer, Aurora e Julia respondem igual. Aqui se captura o
 * PROMPT QUE SAI PARA O MODELO pelos dois caminhos — o de hoje (número sem agente) e o do agente com a v1
 * migrada (conteúdo = o que a resolução de hoje devolve) — e se exige string idêntica e o mesmo sha256
 * gravado no metadata. O prompt real passa pela resolução de verdade (catálogo e override); só o modelo
 * é trocado por um espião. O relógio fica congelado: a Aurora recebe {{currentDateTime}}.
 */
const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const AGENTE = '33333333-3333-4333-8333-333333333333';
const V1 = '44444444-4444-4444-8444-444444444444';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
const HISTORICO = [
  { id: 'm1', direction: 'inbound', message_type: 'text', author_name: 'Pedro', content: 'Oi, vi o anuncio', sent_at: '2026-09-29T14:58:00.000Z', metadata: {} },
  { id: 'm2', direction: 'outbound', message_type: 'text', author_name: 'Aurora', content: 'Oi! Aqui e a Aurora.', sent_at: '2026-09-29T14:58:30.000Z', metadata: {} },
  { id: 'm3', direction: 'inbound', message_type: 'text', author_name: 'Pedro', content: 'Tenho uma loja', sent_at: '2026-09-29T14:59:00.000Z', metadata: {} },
];

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

function semear(config: Record<string, unknown>, extras: Record<string, Record<string, unknown>[]>, aiAgentId: string | null) {
  return createFakeSupabaseAdmin({
    channel_connections: [{ id: CONN, organization_id: ORG, name: 'Comercial', config: { aiEnabled: true, ...config }, ai_agent_id: aiAgentId }],
    ai_feature_flags: [{ organization_id: ORG, key: 'ai_conversation_auto_reply', enabled: true }],
    organization_settings: [{ organization_id: ORG, ai_enabled: true, ai_provider: 'anthropic', ai_model: 'claude-sonnet-5', ai_anthropic_key: 'sk-ant-teste' }],
    organizations: [{ id: ORG, name: 'Empresa Teste' }],
    ...extras,
  });
}

async function enviado(admin: ReturnType<typeof semear>, config: Record<string, unknown>) {
  capturado.prompts.length = 0;
  capturado.modelos.length = 0;
  const r = await generateConversationAutoReply({
    admin: admin as never,
    organizationId: ORG,
    connectionId: CONN,
    contactName: 'Pedro',
    contactPhone: '5511999999999',
    recentMessages: HISTORICO as never,
    // Como o webhook: a chave resolvida da conexão, `null` quando inválida.
    promptKey: resolveConversationAIAgentConfig({ aiEnabled: true, ...config }).promptKey,
    closing: null,
    threadMetadata: {},
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`geração falhou: ${r.reason}`);
  return { prompt: capturado.prompts[0], modelo: capturado.modelos[0], resultado: r };
}

async function provar(config: Record<string, unknown>, extras: Record<string, Record<string, unknown>[]> = {}, adulterar = (t: string) => t) {
  const legado = await enviado(semear(config, extras, null), config);
  const chave = resolveConversationAIAgentConfig({ aiEnabled: true, ...config }).promptKey!;
  const conteudo = (await buscarPromptResolvido(semear(config, extras, null) as never, ORG, chave))!.content;
  const agente = await enviado(semear(config, {
    ...extras,
    ai_agents: [{ id: AGENTE, organization_id: ORG, name: 'Agente', published_version_id: V1 }],
    ai_agent_versions: [{ id: V1, agent_id: AGENTE, organization_id: ORG, version: 1, prompt: adulterar(conteudo), model: null }],
  }, AGENTE), config);
  return { legado, agente, conteudo };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T15:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('equivalência byte a byte: número sem agente × agente com a v1 migrada', () => {
  it('Aurora (chave da Cenoura Hub, sem override)', async () => {
    const { legado, agente, conteudo } = await provar({ aiPromptKey: AURORA });
    expect(agente.prompt).toBe(legado.prompt);
    expect(sha256(agente.prompt)).toBe(sha256(legado.prompt));
    expect(agente.modelo).toBe(legado.modelo);
    expect(agente.resultado.source).toBe('agent');
    expect(agente.resultado.promptSha256).toBe(legado.resultado.promptSha256);
    expect(legado.resultado.promptSha256).toBe(sha256(conteudo));
  });

  it('Julia (número sem chave: prompt padrão, sem override)', async () => {
    const { legado, agente } = await provar({});
    expect(agente.prompt).toBe(legado.prompt);
    expect(agente.modelo).toBe(legado.modelo);
    expect(agente.resultado.promptSha256).toBe(legado.resultado.promptSha256);
  });

  it('cliente com override ativo em ai_prompt_templates', async () => {
    const extras = {
      ai_prompt_templates: [{ organization_id: ORG, key: PADRAO, content: 'Texto proprio {{contactName}}\n{{recentMessagesText}}', version: 3, is_active: true, updated_at: '2026-09-01T00:00:00Z' }],
    };
    const { legado, agente } = await provar({}, extras);
    expect(legado.resultado.source).toBe('override');
    expect(agente.prompt).toBe(legado.prompt);
    expect(agente.resultado.promptSha256).toBe(legado.resultado.promptSha256);
  });

  it('o teste enxerga diferença (caso positivo): um espaço a mais na versão muda o prompt e o sha', async () => {
    const { legado, agente } = await provar({ aiPromptKey: AURORA }, {}, (t) => `${t} `);
    expect(agente.prompt).not.toBe(legado.prompt);
    expect(agente.resultado.promptSha256).not.toBe(legado.resultado.promptSha256);
  });
});
