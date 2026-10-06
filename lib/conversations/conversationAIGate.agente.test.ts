// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { loadFreshConversationAIGate } from './conversationAIGate';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';

// projetarSelect: a linha volta só com as colunas que o código pede. Sem `ai_agent_id` no select,
// o teste fica vermelho, que é o que ele precisa provar.
function semear(aiAgentId: string | null) {
  return createFakeSupabaseAdmin({
    channel_connections: [{ id: CONN, organization_id: ORG, name: 'Comercial', config: { aiEnabled: true }, ai_agent_id: aiAgentId }],
    ai_feature_flags: [{ organization_id: ORG, key: 'ai_conversation_auto_reply', enabled: true }],
    organization_settings: [{ organization_id: ORG, ai_enabled: true }],
  }, { projetarSelect: true });
}

describe('portão da IA e o agente do número', () => {
  it('devolve o ai_agent_id da conexão', async () => {
    const gate = await loadFreshConversationAIGate({ admin: semear('33333333-3333-4333-8333-333333333333') as never, connectionId: CONN, organizationId: ORG });
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.connection.ai_agent_id).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('número sem agente devolve null', async () => {
    const gate = await loadFreshConversationAIGate({ admin: semear(null) as never, connectionId: CONN, organizationId: ORG });
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.connection.ai_agent_id ?? null).toBeNull();
  });
});
