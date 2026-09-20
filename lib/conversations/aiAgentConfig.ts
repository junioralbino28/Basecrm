import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';

export const DEFAULT_CONVERSATION_AI_AGENT_NAME = 'Julia';
export const DEFAULT_CONVERSATION_AI_PROMPT_KEY = 'task_conversations_whatsapp_auto_reply';

const AGENT_NAME_PATTERN = /^[\p{L}\p{N} .'-]{1,80}$/u;
const PROMPT_KEY_PATTERN = /^task_[a-z0-9_]{1,115}$/;
const CONVERSATION_PROMPT_KEYS = new Set(Object.keys(getPromptCatalogMap()));

export function isConversationAIPromptKey(value: string) {
  return PROMPT_KEY_PATTERN.test(value) && CONVERSATION_PROMPT_KEYS.has(value);
}

export function resolveConversationAIAgentConfig(config: Record<string, unknown> | null | undefined) {
  const rawAgentName = typeof config?.aiAgentName === 'string' ? config.aiAgentName.trim() : '';
  const rawPromptKey = typeof config?.aiPromptKey === 'string' ? config.aiPromptKey.trim() : '';

  return {
    agentName: AGENT_NAME_PATTERN.test(rawAgentName)
      ? rawAgentName
      : DEFAULT_CONVERSATION_AI_AGENT_NAME,
    promptKey: rawPromptKey
      ? isConversationAIPromptKey(rawPromptKey)
        ? rawPromptKey
        : null
      : DEFAULT_CONVERSATION_AI_PROMPT_KEY,
  };
}
