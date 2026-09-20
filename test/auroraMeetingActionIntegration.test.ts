import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Aurora meeting action integration', () => {
  it('valida a ação no PATCH e mantém atividade dentro do tenant', () => {
    const source = fs.readFileSync(
      path.join(root, 'app/api/platform/tenants/[tenantId]/conversations/[threadId]/route.ts'),
      'utf8'
    );

    expect(source).toContain('handoff_action: ConversationMeetingActionSchema.optional()');
    expect(source).toContain("requiredPermissions: parsed.data.handoff_action");
    expect(source).toContain(".from('activities')");
    expect(source).toContain(".eq('organization_id', tenantId)");
    expect(source).toContain(".select('id, contact_id, deal_id')");
    expect(source).toContain('A atividade da reuniao pertence a outro contexto.');
    expect(source).toContain("admin.rpc('reserve_conversation_meeting'");
    expect(source).toContain('p_allow_update: true');
    expect(source).toContain('p_channel_connection_id: existingThread.data.channel_connection_id');
    expect(source).toContain('Este horario nao esta mais disponivel para o responsavel.');
  });

  it('conecta o card ao payload de confirmação e ajuste', () => {
    const source = fs.readFileSync(
      path.join(root, 'features/platform/tenants/TenantConversationsPage.tsx'),
      'utf8'
    );

    expect(source).toContain('<ConversationHandoffCard');
    expect(source).toContain("type: 'confirm_meeting'");
    expect(source).toContain("type: 'adjust_meeting'");
  });

  it('so permite confirmacao automatica com agenda configurada e reserva no banco', () => {
    const aiSource = fs.readFileSync(path.join(root, 'lib/conversations/aiReply.ts'), 'utf8');
    const webhookSource = fs.readFileSync(
      path.join(root, 'app/api/public/channels/evolution/[connectionId]/webhook/route.ts'),
      'utf8',
    );

    expect(aiSource).toContain('calendarContext');
    expect(aiSource).toContain('availableMeetingSlots');
    expect(aiSource).toContain("handoffType === 'meeting_confirmed'");
    expect(aiSource).toContain("admin.rpc('reserve_conversation_meeting'");
    expect(aiSource).toContain('p_allow_update: false');
    expect(webhookSource).toContain('connectionConfig');
  });
});
