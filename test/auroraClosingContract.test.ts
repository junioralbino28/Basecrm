import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contrato estatico do encerramento em executeConversationAIReply: a resposta de encerramento
// passa em human_queue (nunca em human_active), nao abre handoff e mantem a conversa na fila.
describe('encerramento depois do handoff — contrato do executor', () => {
  const source = readFileSync(resolve(__dirname, '../lib/conversations/aiReply.ts'), 'utf-8');

  it('so libera a fila humana quando a resposta e de encerramento', () => {
    expect(source).toContain("thread.status === 'human_active' || (thread.status === 'human_queue' && !closingReply)");
  });

  it('encerramento nunca abre handoff nem devolve a conversa para a IA', () => {
    expect(source).toContain('let shouldHandoff = !closingReply && Boolean(payload.shouldHandoff || effectiveHandoffType);');
    expect(source).toContain("const nextStatus = requiresHumanAttention || closingReply ? 'human_queue' : 'ai_active';");
    expect(source).toContain('buildClosingReplyMetadata(');
  });

  it('na geracao, o encerramento pula a politica de reuniao e zera o handoff', () => {
    expect(source).toContain('if (closing) {\n    // Encerramento nunca abre handoff novo nem mexe na agenda.');
    expect(source).toContain("prompt = `SITUACAO DA CONVERSA: ${conversationStageContext}");
  });
});
