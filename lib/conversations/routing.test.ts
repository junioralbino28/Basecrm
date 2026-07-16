import { describe, expect, it } from 'vitest';
import { getConversationStatusAfterInbound } from './routing';

describe('getConversationStatusAfterInbound', () => {
  it('mantém o comportamento atual quando a IA não foi desligada', () => {
    expect(getConversationStatusAfterInbound('resolved', true)).toBe('ai_active');
    expect(getConversationStatusAfterInbound('resolved', undefined)).toBe('ai_active');
    expect(getConversationStatusAfterInbound('human_active', true)).toBe('human_active');
    expect(getConversationStatusAfterInbound('closed', true)).toBe('closed');
  });

  it('manda inbound para fila humana quando o número está com IA desligada', () => {
    expect(getConversationStatusAfterInbound(null, false)).toBe('human_queue');
    expect(getConversationStatusAfterInbound('ai_active', false)).toBe('human_queue');
    expect(getConversationStatusAfterInbound('resolved', false)).toBe('human_queue');
    expect(getConversationStatusAfterInbound('human_active', false)).toBe('human_active');
    expect(getConversationStatusAfterInbound('closed', false)).toBe('closed');
  });
});
