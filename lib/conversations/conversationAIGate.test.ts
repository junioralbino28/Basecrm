import { describe, expect, it, vi } from 'vitest';
import { loadFreshConversationAIGate } from './conversationAIGate';

const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';

function makeAdmin(rows: Record<string, { data: unknown; error: unknown }>) {
  const from = vi.fn((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve(rows[table]),
    };
    return chain;
  });
  return { admin: { from } as never, from };
}

describe('fresh conversation AI gate', () => {
  it('bloqueia uma configuracao antiga quando a conexao foi desativada no banco', async () => {
    const { admin, from } = makeAdmin({
      channel_connections: {
        data: {
          id: CONNECTION_ID,
          organization_id: ORGANIZATION_ID,
          name: 'Comercial',
          config: { aiEnabled: false },
        },
        error: null,
      },
    });

    await expect(loadFreshConversationAIGate({
      admin,
      connectionId: CONNECTION_ID,
      organizationId: ORGANIZATION_ID,
    })).resolves.toEqual({ ok: false, reason: 'connection_ai_disabled' });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('exige flag da funcionalidade e IA da organizacao explicitamente ativas', async () => {
    const { admin } = makeAdmin({
      channel_connections: {
        data: {
          id: CONNECTION_ID,
          organization_id: ORGANIZATION_ID,
          name: 'Comercial',
          config: { aiEnabled: true },
        },
        error: null,
      },
      ai_feature_flags: { data: { enabled: true }, error: null },
      organization_settings: { data: { ai_enabled: true }, error: null },
    });

    const result = await loadFreshConversationAIGate({
      admin,
      connectionId: CONNECTION_ID,
      organizationId: ORGANIZATION_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      connection: { id: CONNECTION_ID, config: { aiEnabled: true } },
    });
  });

  it('falha fechado quando a flag da funcionalidade esta ausente', async () => {
    const { admin } = makeAdmin({
      channel_connections: {
        data: {
          id: CONNECTION_ID,
          organization_id: ORGANIZATION_ID,
          name: 'Comercial',
          config: { aiEnabled: true },
        },
        error: null,
      },
      ai_feature_flags: { data: null, error: null },
    });

    await expect(loadFreshConversationAIGate({
      admin,
      connectionId: CONNECTION_ID,
      organizationId: ORGANIZATION_ID,
    })).resolves.toEqual({ ok: false, reason: 'feature_disabled' });
  });
});
