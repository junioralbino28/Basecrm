// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { carregarVersaoPublicada } from './agentRuntime';

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA = '99999999-9999-4999-8999-999999999999';
const AGENTE = '33333333-3333-4333-8333-333333333333';
const V1 = '44444444-4444-4444-8444-444444444444';

function semear(overrides: { publishedVersionId?: string | null; versoes?: Record<string, unknown>[] } = {}) {
  return createFakeSupabaseAdmin({
    ai_agents: [{ id: AGENTE, organization_id: ORG, name: 'Aurora', published_version_id: overrides.publishedVersionId === undefined ? V1 : overrides.publishedVersionId }],
    ai_agent_versions: overrides.versoes ?? [
      { id: V1, agent_id: AGENTE, organization_id: ORG, version: 1, prompt: 'Prompt da v1', model: null, settings: {} },
    ],
  });
}

describe('versão publicada do agente', () => {
  it('carrega prompt, versão e modelo da versão publicada', async () => {
    const r = await carregarVersaoPublicada(semear() as never, { organizationId: ORG, agentId: AGENTE });
    expect(r).toEqual({ ok: true, versao: { agentId: AGENTE, versionId: V1, version: 1, prompt: 'Prompt da v1', model: null } });
  });

  it('agente de outra organização não é encontrado', async () => {
    const r = await carregarVersaoPublicada(semear() as never, { organizationId: OUTRA, agentId: AGENTE });
    expect(r).toEqual({ ok: false, motivo: 'agent_not_found' });
  });

  it('agente sem versão publicada', async () => {
    const r = await carregarVersaoPublicada(semear({ publishedVersionId: null }) as never, { organizationId: ORG, agentId: AGENTE });
    expect(r).toEqual({ ok: false, motivo: 'agent_not_published' });
  });

  it('ponteiro para versão que não existe', async () => {
    const r = await carregarVersaoPublicada(semear({ versoes: [] }) as never, { organizationId: ORG, agentId: AGENTE });
    expect(r).toEqual({ ok: false, motivo: 'agent_not_published' });
  });

  it('erro de leitura', async () => {
    const admin = semear();
    admin.failOn('ai_agents', 'select', 'boom');
    const r = await carregarVersaoPublicada(admin as never, { organizationId: ORG, agentId: AGENTE });
    expect(r).toEqual({ ok: false, motivo: 'agent_read_error' });
  });
});
