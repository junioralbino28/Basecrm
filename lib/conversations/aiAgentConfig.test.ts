import { describe, expect, it } from 'vitest';
import { resolveConversationAIAgentConfig } from './aiAgentConfig';

describe('conversation AI agent config', () => {
  it('permite configurar Aurora e o prompt da Cenoura por conexao', () => {
    expect(
      resolveConversationAIAgentConfig({
        aiAgentName: ' Aurora ',
        aiPromptKey: 'task_conversations_whatsapp_cenno_aurora',
      })
    ).toEqual({
      agentName: 'Aurora',
      promptKey: 'task_conversations_whatsapp_cenno_aurora',
    });
  });

  it('mantem a Julia como fallback para conexoes existentes', () => {
    expect(resolveConversationAIAgentConfig({})).toEqual({
      agentName: 'Julia',
      promptKey: 'task_conversations_whatsapp_auto_reply',
    });
  });

  it('falha fechado para uma chave de prompt fora do formato permitido', () => {
    expect(
      resolveConversationAIAgentConfig({
        aiAgentName: '<script>Aurora</script>',
        aiPromptKey: '../../segredo',
      })
    ).toEqual({
      agentName: 'Julia',
      promptKey: null,
    });
  });

  it('falha fechado para uma chave bem formada que nao existe no catalogo', () => {
    expect(
      resolveConversationAIAgentConfig({
        aiAgentName: 'Aurora',
        aiPromptKey: 'task_prompt_inexistente',
      })
    ).toEqual({
      agentName: 'Aurora',
      promptKey: null,
    });
  });
});
