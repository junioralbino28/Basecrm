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

  it('na geracao, o encerramento pula a politica de reuniao, zera o handoff e so vale para prompt com o marcador', () => {
    expect(source).toContain('if (closing) {\n    // Encerramento nunca abre handoff novo nem mexe na agenda.');
    expect(source).toContain("reason: 'closing_unsupported' as const");
    expect(source).not.toContain('SITUACAO DA CONVERSA: ${conversationStageContext}');
  });

  it('grava e-mail e segmento do lead no contato sem sobrescrever e-mail existente', () => {
    // 21/09 (midia recebida): e-mail que so existe na transcricao de um audio nunca vai para o contato.
    // Emenda do mesmo dia (pedido do Junior): vale o digitado ou o que a Aurora escreveu para conferir e o
    // lead confirmou. Regras da trava em lib/conversations/inboundMediaPrompt.test.ts.
    expect(source).toContain('leadEmail: resolveConfirmedLeadEmail(recentMessages, normalizeLeadEmail(generated.leadEmail)),');
    expect(source).toContain('buildContactProfileUpdate({');
    expect(source).toContain(".from('contacts')");
  });

  it('tenta a geracao de novo quando o modelo nao devolve o objeto, com reparo do texto cru', () => {
    expect(source).toContain('NoObjectGeneratedError.isInstance(error)');
    expect(source).toContain('repairStructuredOutputText(rawText)');
    expect(source).toContain('generated = (await generateOnce()).output;');
  });

  it('reivindica a resposta de encerramento de forma atomica antes de enviar e respeita mudanca de estado feita por humano', () => {
    expect(source).toContain("resolveClosingReplyEligibility({ status: thread.status, metadata: thread.metadata, now })");
    expect(source).toContain("claimBase.or('metadata->>aiClosingReplies.is.null,metadata->>aiClosingReplies.eq.0')");
    expect(source).toContain("claimBase.eq('metadata->>aiClosingReplies', String(eligibility.repliesUsed))");
    expect(source).toContain("reason: 'closing_claimed' as const");
    expect(source).toContain("await threadUpdateBase.eq('status', 'human_queue').select('id')");
  });
});
