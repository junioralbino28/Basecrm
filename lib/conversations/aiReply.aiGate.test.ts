import { describe, expect, it, vi } from 'vitest';
import { executeConversationAIReply } from './aiReply';

describe('executeConversationAIReply — defesa em profundidade do kill switch', () => {
  it('nao consulta nem envia quando a conexao esta desativada', async () => {
    const from = vi.fn();

    const result = await executeConversationAIReply({
      admin: { from } as never,
      connection: {
        id: '22222222-2222-4222-8222-222222222222',
        organization_id: '11111111-1111-4111-8111-111111111111',
        name: 'Comercial',
        config: { aiEnabled: false },
      },
      payload: {
        threadId: '33333333-3333-4333-8333-333333333333',
        replyText: 'Mensagem que nao pode ser enviada',
      },
    });

    expect(result).toEqual({ ok: true, ignored: true, reason: 'connection_ai_disabled' });
    expect(from).not.toHaveBeenCalled();
  });
});
