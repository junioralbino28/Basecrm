// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

const capturado = vi.hoisted(() => ({ prompts: [] as string[], modelos: [] as string[] }));
const getResolvedPromptMock = vi.hoisted(() => vi.fn());

vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('ai')>();
  return {
    ...real,
    generateText: vi.fn(async (args: { prompt: string }) => {
      capturado.prompts.push(args.prompt);
      return { output: { replyText: 'Oi!', shouldHandoff: false } };
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
vi.mock('@/lib/ai/prompts/server', () => ({ getResolvedPrompt: getResolvedPromptMock }));

import { generateConversationAutoReply } from './aiReply';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const AGENTE = '33333333-3333-4333-8333-333333333333';
const V2 = '44444444-4444-4444-8444-444444444444';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

function semear(opcoes: { aiAgentId?: string | null; agentes?: Record<string, unknown>[]; versoes?: Record<string, unknown>[] }) {
  return createFakeSupabaseAdmin({
    channel_connections: [{ id: CONN, organization_id: ORG, name: 'Comercial', config: { aiEnabled: true }, ai_agent_id: opcoes.aiAgentId ?? null }],
    ai_feature_flags: [{ organization_id: ORG, key: 'ai_conversation_auto_reply', enabled: true }],
    organization_settings: [{ organization_id: ORG, ai_enabled: true, ai_provider: 'anthropic', ai_model: 'claude-sonnet-5', ai_anthropic_key: 'sk-ant-teste' }],
    organizations: [{ id: ORG, name: 'Empresa' }],
    ai_agents: opcoes.agentes ?? [{ id: AGENTE, organization_id: ORG, name: 'Aurora', published_version_id: V2 }],
    ai_agent_versions: opcoes.versoes ?? [{ id: V2, agent_id: AGENTE, organization_id: ORG, version: 2, prompt: 'AGENTE {{recentMessagesText}}', model: null }],
  });
}

function gerar(admin: ReturnType<typeof semear>, promptKey?: string | null) {
  return generateConversationAutoReply({
    admin: admin as never,
    organizationId: ORG,
    connectionId: CONN,
    contactName: 'Pedro',
    contactPhone: '5511999999999',
    recentMessages: [{ id: 'm1', direction: 'inbound', message_type: 'text', author_name: 'Pedro', content: 'oi', sent_at: '2026-09-29T12:00:00.000Z', metadata: {} }] as never,
    promptKey,
  });
}

beforeEach(() => {
  capturado.prompts.length = 0;
  capturado.modelos.length = 0;
  getResolvedPromptMock.mockReset();
  getResolvedPromptMock.mockResolvedValue({ key: PADRAO, content: 'LEGADO {{recentMessagesText}}', source: 'default' });
});

describe('resposta com agente no número (fatia 1)', () => {
  it('usa o prompt da versão publicada e informa origem, versão e o sha256 do texto usado', async () => {
    const r = await gerar(semear({ aiAgentId: AGENTE }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(capturado.prompts[0]).toMatch(/^AGENTE /);
    expect(getResolvedPromptMock).not.toHaveBeenCalled();
    expect(r.source).toBe('agent');
    expect(r.agent).toEqual({ id: AGENTE, version: 2 });
    expect(r.promptSha256).toBe(sha256('AGENTE {{recentMessagesText}}'));
    expect(capturado.modelos[0]).toBe('claude-sonnet-5');
  });

  it('usa o modelo da versão quando ela tem um', async () => {
    await gerar(semear({
      aiAgentId: AGENTE,
      versoes: [{ id: V2, agent_id: AGENTE, organization_id: ORG, version: 2, prompt: 'AGENTE', model: 'claude-haiku-4-5' }],
    }));
    expect(capturado.modelos[0]).toBe('claude-haiku-4-5');
  });

  it('agente ligado mas sem versão publicada: falha sem chamar o modelo', async () => {
    const r = await gerar(semear({
      aiAgentId: AGENTE,
      agentes: [{ id: AGENTE, organization_id: ORG, name: 'Aurora', published_version_id: null }],
    }));
    expect(r).toEqual({ ok: false, reason: 'agent_unavailable' });
    expect(capturado.prompts).toHaveLength(0);
  });

  it('número sem agente segue o caminho de hoje (chave padrão) e também informa o sha256', async () => {
    const r = await gerar(semear({ aiAgentId: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getResolvedPromptMock).toHaveBeenCalledWith(expect.anything(), ORG, PADRAO);
    expect(capturado.prompts[0]).toMatch(/^LEGADO /);
    expect(r.source).toBe('default');
    expect(r.agent).toBeNull();
    expect(r.promptSha256).toBe(sha256('LEGADO {{recentMessagesText}}'));
  });

  it('chave nula e sem agente: missing_prompt, nunca o prompt padrão', async () => {
    const r = await gerar(semear({ aiAgentId: null }), null);
    expect(r).toEqual({ ok: false, reason: 'missing_prompt' });
    expect(getResolvedPromptMock).not.toHaveBeenCalled();
    expect(capturado.prompts).toHaveLength(0);
  });

  it('chave nula com agente: responde pelo agente', async () => {
    const r = await gerar(semear({ aiAgentId: AGENTE }), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('agent');
  });
});
