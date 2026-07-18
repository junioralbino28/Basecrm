// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const threadRoute = readFileSync(
  resolve(
    process.cwd(),
    'app/api/platform/tenants/[tenantId]/conversations/[threadId]/route.ts',
  ),
  'utf8',
);
const messageRoute = readFileSync(
  resolve(
    process.cwd(),
    'app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts',
  ),
  'utf8',
);
const aiReply = readFileSync(
  resolve(process.cwd(), 'lib/conversations/aiReply.ts'),
  'utf8',
);

describe('F5 — integração do takeover humano', () => {
  it('pausa inscrições quando a thread entra em fila/atendimento humano', () => {
    expect(threadRoute).toContain("rpc('pause_automation_enrollments_for_thread'");
    expect(threadRoute).toContain("nextStatus === 'human_queue' || nextStatus === 'human_active'");
  });

  it('pausa inscrições depois de uma mensagem manual persistida', () => {
    expect(messageRoute).toContain("rpc('pause_automation_enrollments_for_thread'");
    expect(messageRoute).toContain("p_reason: 'manual_message'");
  });

  it('pausa inscrições no handoff iniciado pela IA', () => {
    expect(aiReply).toContain("rpc('pause_automation_enrollments_for_thread'");
    expect(aiReply).toContain("p_reason: 'ai_handoff'");
  });
});
