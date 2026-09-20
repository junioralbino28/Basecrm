import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Aurora handoff integration', () => {
  it('usa o contrato estruturado do AI SDK v6 e limita a geracao', () => {
    const source = fs.readFileSync(path.join(root, 'lib/conversations/aiReply.ts'), 'utf8');

    expect(source).toContain("import { generateText, NoObjectGeneratedError, Output } from 'ai'");
    expect(source).not.toContain('generateObject(');
    expect(source).toContain('Output.object({');
    expect(source).toContain('maxOutputTokens: 4096');
    expect(source).toContain('handoffType');
    expect(source).toContain('requestedScheduleAt');
    expect(source).toContain('requestedScheduleText');
  });

  it('grava o alerta no CRM com idempotencia por evento', () => {
    const source = fs.readFileSync(path.join(root, 'lib/conversations/aiReply.ts'), 'utf8');

    expect(source).toContain(".from('system_notifications')");
    expect(source).toContain('.upsert(handoffNotification, { onConflict: \'id\' })');
    expect(source).toContain('notificationEventId');
    expect(source).toContain('handoff,');
    expect(source.indexOf(".from('system_notifications')")).toBeLessThan(
      source.indexOf("admin.rpc('pause_automation_enrollments_for_thread'")
    );
    expect(source).not.toContain('if (paused.error) throw new Error(paused.error.message)');
    expect(source).toContain(".from('activities')");
    expect(source).toContain(".upsert(meetingActivity, { onConflict: 'id' })");
  });

  it('seleciona nome e prompt do agente a partir da conexao', () => {
    const source = fs.readFileSync(
      path.join(root, 'app/api/public/channels/evolution/[connectionId]/webhook/route.ts'),
      'utf8'
    );

    expect(source).toContain('loadFreshConversationAIGate({');
    expect(source).toContain('resolveConversationAIAgentConfig(freshConnectionConfig)');
    expect(source).toContain('promptKey');
    expect(source).toContain('agentName');
  });

  it('nao aciona fallback depois que a execucao nativa assumiu o envio', () => {
    const source = fs.readFileSync(
      path.join(root, 'app/api/public/channels/evolution/[connectionId]/webhook/route.ts'),
      'utf8'
    );

    expect(source).toContain('let nativeExecutionStarted = false;');
    expect(source).toContain('nativeExecutionStarted = true;');
    expect(source).toContain('if (nativeExecutionStarted) {');
    expect(source).toContain("stage: 'delivery'");
  });

  it('revalida o gate imediatamente antes de gerar e antes de enviar', () => {
    const source = fs.readFileSync(path.join(root, 'lib/conversations/aiReply.ts'), 'utf8');

    expect(source.match(/loadFreshConversationAIGate\(\{/g)).toHaveLength(2);
    expect(source).toContain('orgSettings?.ai_enabled !== true');
  });
});
