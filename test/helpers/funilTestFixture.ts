import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishAutomationDraft } from '@/lib/automations/publication';

type FixtureStep = {
  type: 'send_message' | 'delay' | 'wait_for_event' | 'create_task';
  config: Record<string, unknown>;
};

type FixtureEdge = {
  from: number;
  to: number;
  outcome: 'success' | 'answered' | 'timeout' | 'failed';
};

export type FunilTestFixture = {
  actorId: string;
  automationId: string;
  channelConnectionId: string;
  contactId: string;
  dealId: string;
  enrollmentId: string;
  organizationId: string;
  stepKeys: string[];
  threadId: string;
  versionId: string;
  cleanup: () => Promise<void>;
};

function fail(label: string, error?: { message?: string } | null): never {
  throw new Error(`${label}: ${error?.message ?? 'retorno incompleto'}`);
}

export async function createFunilTestFixture(params: {
  admin: SupabaseClient;
  label: string;
  steps: FixtureStep[];
  edges?: FixtureEdge[];
}): Promise<FunilTestFixture> {
  const { admin } = params;
  const runId = randomUUID();
  const password = `Funil!${randomUUID()}aA1`;

  const organization = await admin
    .from('organizations')
    .insert({ name: `${params.label} ${runId}` })
    .select('id')
    .single();
  if (organization.error || !organization.data) fail('organization fixture', organization.error);
  const organizationId = organization.data.id;

  const actorEmail = `funil.${runId}@example.com`;
  const actor = await admin.auth.admin.createUser({
    email: actorEmail,
    password,
    email_confirm: true,
    user_metadata: { role: 'clinic_admin', organization_id: organizationId },
  });
  if (actor.error || !actor.data.user?.id) fail('actor fixture', actor.error);
  const actorId = actor.data.user.id;

  const profile = await admin.from('profiles').upsert({
    id: actorId,
    email: actorEmail,
    name: `Editor ${params.label}`,
    first_name: 'Editor',
    role: 'clinic_admin',
    organization_id: organizationId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (profile.error) fail('profile fixture', profile.error);

  const board = await admin
    .from('boards')
    .insert({
      organization_id: organizationId,
      name: `Board ${params.label} ${runId}`,
      is_default: false,
    })
    .select('id')
    .single();
  if (board.error || !board.data) fail('board fixture', board.error);

  const stage = await admin
    .from('board_stages')
    .insert({
      organization_id: organizationId,
      board_id: board.data.id,
      name: 'Entrada',
      color: '#3b82f6',
      order: 0,
    })
    .select('id')
    .single();
  if (stage.error || !stage.data) fail('stage fixture', stage.error);

  const contact = await admin
    .from('contacts')
    .insert({
      organization_id: organizationId,
      name: 'Maria da Silva',
      email: `contato.${runId}@example.com`,
      phone: '5511999999999',
    })
    .select('id')
    .single();
  if (contact.error || !contact.data) fail('contact fixture', contact.error);
  const contactId = contact.data.id;

  const deal = await admin
    .from('deals')
    .insert({
      organization_id: organizationId,
      board_id: board.data.id,
      stage_id: stage.data.id,
      contact_id: contactId,
      title: `Oportunidade ${params.label}`,
      value: 100,
      status: 'open',
    })
    .select('id')
    .single();
  if (deal.error || !deal.data) fail('deal fixture', deal.error);
  const dealId = deal.data.id;

  const channel = await admin
    .from('channel_connections')
    .insert({
      organization_id: organizationId,
      provider: 'evolution',
      channel_type: 'whatsapp',
      name: `Canal ${params.label}`,
      status: 'connected',
      config: {},
    })
    .select('id')
    .single();
  if (channel.error || !channel.data) fail('channel fixture', channel.error);
  const channelConnectionId = channel.data.id;

  const thread = await admin
    .from('conversation_threads')
    .insert({
      organization_id: organizationId,
      channel_connection_id: channelConnectionId,
      contact_id: contactId,
      deal_id: dealId,
      contact_phone: '5511999999999',
      title: `Conversa ${params.label}`,
      status: 'ai_active',
      metadata: { routingMode: 'ai', humanLocked: false },
    })
    .select('id')
    .single();
  if (thread.error || !thread.data) fail('thread fixture', thread.error);
  const threadId = thread.data.id;

  const automation = await admin
    .from('automations')
    .insert({
      organization_id: organizationId,
      name: `Automação ${params.label}`,
      created_by: actorId,
      trigger_config: { tag: `tag-${runId}` },
    })
    .select('id')
    .single();
  if (automation.error || !automation.data) fail('automation fixture', automation.error);
  const automationId = automation.data.id;

  const insertedSteps = [];
  for (const [index, step] of params.steps.entries()) {
    const inserted = await admin
      .from('automation_steps')
      .insert({
        organization_id: organizationId,
        automation_id: automationId,
        step_type: step.type,
        config: step.config,
        sort_key: index,
      })
      .select('id, step_key')
      .single();
    if (inserted.error || !inserted.data) fail(`step fixture ${index}`, inserted.error);
    insertedSteps.push(inserted.data);
  }

  for (const [index, edge] of (params.edges ?? []).entries()) {
    const inserted = await admin.from('automation_step_edges').insert({
      organization_id: organizationId,
      automation_id: automationId,
      from_step_id: insertedSteps[edge.from].id,
      outcome: edge.outcome,
      to_step_id: insertedSteps[edge.to].id,
      order: index,
    });
    if (inserted.error) fail(`edge fixture ${index}`, inserted.error);
  }

  const published = await publishAutomationDraft({
    db: admin,
    automationId,
    actorId,
  });
  const versionId = published.version.id;

  const enrollment = await admin.rpc('create_automation_enrollment', {
    p_automation_id: automationId,
    p_deal_id: dealId,
    p_contact_id: contactId,
    p_thread_id: threadId,
    p_channel_connection_id: channelConnectionId,
  });
  if (enrollment.error || !enrollment.data) fail('enrollment fixture', enrollment.error);

  return {
    actorId,
    automationId,
    channelConnectionId,
    contactId,
    dealId,
    enrollmentId: enrollment.data.id,
    organizationId,
    stepKeys: insertedSteps.map((step) => step.step_key),
    threadId,
    versionId,
    cleanup: async () => {
      await admin.auth.admin.deleteUser(actorId);
    },
  };
}
