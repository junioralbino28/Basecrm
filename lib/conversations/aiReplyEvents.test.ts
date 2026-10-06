// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { lerCommitDaPublicacao, lerDeploymentDaPublicacao, registrarEventoDeResposta } from './aiReplyEvents';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);
const DEPLOYMENT = 'dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3';

const dados = {
  organizationId: ORG,
  channelConnectionId: CONN,
  threadId: THREAD,
  deliveredAt: '2026-09-29T12:00:01.000Z',
  promptSha256: SHA,
  promptKey: 'task_conversations_whatsapp_auto_reply',
  promptSource: 'default' as const,
  agentId: null,
  agentVersion: null,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('commit da publicação', () => {
  it('lê VERCEL_GIT_COMMIT_SHA quando é um sha de 40 hex', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', COMMIT);
    expect(lerCommitDaPublicacao()).toBe(COMMIT);
  });

  it('fora da Vercel (ou com valor torto) é nulo, nunca inventado', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    expect(lerCommitDaPublicacao()).toBeNull();
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
    expect(lerCommitDaPublicacao()).toBeNull();
  });
});

describe('deployment da publicação', () => {
  it('lê VERCEL_DEPLOYMENT_ID quando tem o formato dpl_', () => {
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', DEPLOYMENT);
    expect(lerDeploymentDaPublicacao()).toBe(DEPLOYMENT);
  });

  it('fora da Vercel (ou com valor torto) é nulo, nunca inventado', () => {
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', '');
    expect(lerDeploymentDaPublicacao()).toBeNull();
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'deploy-123');
    expect(lerDeploymentDaPublicacao()).toBeNull();
  });
});

describe('registrar o evento de resposta', () => {
  it('grava uma linha com as colunas do evento', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', COMMIT);
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', DEPLOYMENT);
    const admin = createFakeSupabaseAdmin();
    await registrarEventoDeResposta(admin as never, dados);
    expect(admin.rowsOf('ai_reply_events')).toEqual([expect.objectContaining({
      organization_id: ORG,
      channel_connection_id: CONN,
      thread_id: THREAD,
      prompt_sha256: SHA,
      prompt_key: 'task_conversations_whatsapp_auto_reply',
      prompt_source: 'default',
      agent_id: null,
      agent_version: null,
      release_commit: COMMIT,
      release_deployment: DEPLOYMENT,
      delivered_at: '2026-09-29T12:00:01.000Z',
    })]);
  });

  it('com agente, grava agente e versão e a chave nula', async () => {
    const admin = createFakeSupabaseAdmin();
    await registrarEventoDeResposta(admin as never, { ...dados, promptKey: null, promptSource: 'agent', agentId: 'agente-1', agentVersion: 3 });
    expect(admin.rowsOf('ai_reply_events')[0]).toMatchObject({ prompt_key: null, prompt_source: 'agent', agent_id: 'agente-1', agent_version: 3, release_commit: null, release_deployment: null });
  });

  it('falha do banco só avisa: a resposta já saiu e não pode cair por causa do registro', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.failOn('ai_reply_events', 'insert', 'boom');
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(registrarEventoDeResposta(admin as never, dados)).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalledWith('[Conversation AI] Failed to record reply event', expect.objectContaining({ error: 'boom' }));
  });

  it('insert que LANÇA (rejeição do cliente, rede) também só avisa: nada sobe para o chamador', async () => {
    // O cliente real pode rejeitar em vez de devolver { error } (5ª rodada do Codex, achado 3). Um stub mínimo basta:
    // o banco falso só sabe devolver { error }.
    const admin = { from: () => ({ insert: () => Promise.reject(new Error('fetch failed')) }) };
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(registrarEventoDeResposta(admin as never, dados)).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalledWith('[Conversation AI] Failed to record reply event', expect.objectContaining({ error: 'fetch failed' }));
  });

  it('insert que lança de forma SÍNCRONA também só avisa', async () => {
    const admin = { from: () => ({ insert: () => { throw new Error('cliente quebrado'); } }) };
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(registrarEventoDeResposta(admin as never, dados)).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalledWith('[Conversation AI] Failed to record reply event', expect.objectContaining({ error: 'cliente quebrado' }));
  });
});
