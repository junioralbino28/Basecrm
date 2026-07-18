// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createE2AdminClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';
import {
  createFunilTestFixture,
  type FunilTestFixture,
} from './helpers/funilTestFixture';
import {
  runAutomationSimulationTest,
  saveAutomationDraft,
} from '@/lib/automations/builder';
import { publishAutomationDraft } from '@/lib/automations/publication';

const config = loadE2SupabaseConfig();
const describeLocal = config ? describe : describe.skip;

describeLocal('F6 — builder, publicação e teste seguro no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  let fixture: FunilTestFixture | null = null;

  afterAll(async () => {
    await fixture?.cleanup();
  }, 120_000);

  it('salva o grafo, publica snapshot e simula sem habilitar envio real', async () => {
    if (!admin) throw new Error('admin local ausente');
    fixture = await createFunilTestFixture({
      admin,
      label: 'f6-target',
      steps: [{ type: 'create_task', config: { title: 'Fixture alvo' } }],
    });

    const sendStepKey = randomUUID();
    const terminalStepKey = randomUUID();
    const draft = {
      id: null,
      name: 'Boas-vindas demonstrável',
      triggerConfig: { tag: 'lead-novo' },
      steps: [
        {
          stepKey: sendStepKey,
          stepType: 'send_message' as const,
          sortKey: 0,
          config: {
            link_mode: 'copied',
            body_local: 'Olá, {{ contato.nome | default: "tudo bem" }}!',
            message_kind: 'text',
            channel: 'whatsapp',
          },
        },
        {
          stepKey: terminalStepKey,
          stepType: 'create_task' as const,
          sortKey: 1,
          config: { title: 'Dar continuidade' },
        },
      ],
      edges: [{
        fromStepKey: sendStepKey,
        outcome: 'success' as const,
        toStepKey: terminalStepKey,
        order: 0,
      }],
    };
    const saved = await saveAutomationDraft({
      db: admin,
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      draft,
    });

    const updated = await saveAutomationDraft({
      db: admin,
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      draft: {
        ...draft,
        id: saved.automationId,
        draftRevision: saved.draftRevision,
      },
    });
    await expect(saveAutomationDraft({
      db: admin,
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      draft: {
        ...draft,
        id: saved.automationId,
        draftRevision: saved.draftRevision,
        name: 'Edição concorrente obsoleta',
      },
    })).rejects.toThrow(/outra sessão/);
    expect(updated.draftRevision).toBeGreaterThan(saved.draftRevision);

    const published = await publishAutomationDraft({
      db: admin,
      automationId: saved.automationId,
      actorId: fixture.actorId,
    });
    expect(published.version.version).toBe(1);

    const result = await runAutomationSimulationTest({
      db: admin,
      organizationId: fixture.organizationId,
      automationId: saved.automationId,
      threadId: fixture.threadId,
    });
    expect(result).toMatchObject({
      deliveryStatus: 'simulated',
      threadId: fixture.threadId,
    });

    const [settings, automation, message] = await Promise.all([
      admin
        .from('organization_settings')
        .select('automation_live_enabled')
        .eq('organization_id', fixture.organizationId)
        .single(),
      admin
        .from('automations')
        .select('delivery_mode, lifecycle_status')
        .eq('id', saved.automationId)
        .single(),
      admin
        .from('conversation_messages')
        .select('delivery_status, content')
        .eq('id', result.messageId)
        .single(),
    ]);
    expect(settings.data?.automation_live_enabled).toBe(false);
    expect(automation.data).toEqual({
      delivery_mode: 'simulation',
      lifecycle_status: 'published',
    });
    expect(message.data).toEqual({
      delivery_status: 'simulated',
      content: 'Olá, Maria da Silva!',
    });
  });
});
