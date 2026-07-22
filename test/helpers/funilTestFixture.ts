import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishAutomationDraft } from '@/lib/automations/publication';
import type {
  AutomationEdgeOutcome,
  AutomationStepType,
} from '@/lib/automations/compiler';

type FixtureStep = {
  type: AutomationStepType;
  config: Record<string, unknown>;
};

type FixtureEdge = {
  from: number;
  to: number;
  outcome: AutomationEdgeOutcome;
  order?: number;
};

type FixtureTagContext = {
  tagIdsByName: Record<string, string>;
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
  tagIdsByName: Record<string, string>;
  threadId: string;
  triggerTagId: string;
  versionId: string;
  cleanup: () => Promise<void>;
};

function fail(label: string, error?: { message?: string } | null): never {
  throw new Error(`${label}: ${error?.message ?? 'retorno incompleto'}`);
}

export async function createFunilTestFixture(params: {
  admin: SupabaseClient;
  label: string;
  steps: FixtureStep[] | ((context: FixtureTagContext) => FixtureStep[]);
  edges?: FixtureEdge[];
  dealTags?: string[];
  entityTagNames?: string[];
  assignedEntityTagNames?: string[];
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
      tags: params.dealTags ?? [],
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

  const category = await admin
    .from('tag_categories')
    .insert({
      organization_id: organizationId,
      label: `Serviços ${params.label} ${runId}`,
      cardinality: 'multiple',
    })
    .select('id')
    .single();
  if (category.error || !category.data) fail('tag category fixture', category.error);

  const triggerTagName = `Gatilho ${params.label} ${runId}`;
  const entityTagNames = [...new Set(params.entityTagNames ?? [])];
  const tags = await admin
    .from('tags')
    .insert([triggerTagName, ...entityTagNames].map((name) => ({
      organization_id: organizationId,
      category_id: category.data.id,
      name,
    })))
    .select('id, name');
  if (tags.error || !tags.data) fail('tags fixture', tags.error);
  const triggerTagId = tags.data.find(({ name }) => name === triggerTagName)?.id;
  if (!triggerTagId) fail('trigger tag fixture');
  const tagIdsByName = Object.fromEntries(
    entityTagNames.map((name) => {
      const tagId = tags.data.find((tag) => tag.name === name)?.id;
      if (!tagId) fail(`entity tag fixture ${name}`);
      return [name, tagId];
    }),
  );

  const assignedEntityTagNames = [...new Set(params.assignedEntityTagNames ?? [])];
  if (assignedEntityTagNames.length) {
    const unknownName = assignedEntityTagNames.find((name) => !tagIdsByName[name]);
    if (unknownName) fail(`assigned entity tag desconhecida ${unknownName}`);
    const assignedAt = new Date().toISOString();
    const assignments = await admin.from('deal_tag_assignments').insert(
      assignedEntityTagNames.map((name, index) => ({
        organization_id: organizationId,
        deal_id: dealId,
        category_id: category.data.id,
        tag_id: tagIdsByName[name],
        is_primary: index === 0,
        provenance: 'api',
        applied_at: assignedAt,
        recorded_at: assignedAt,
      })),
    );
    if (assignments.error) fail('deal tag assignments fixture', assignments.error);
  }

  const automation = await admin
    .from('automations')
    .insert({
      organization_id: organizationId,
      name: `Automação ${params.label}`,
      created_by: actorId,
      trigger_config: { tag_id: triggerTagId },
    })
    .select('id')
    .single();
  if (automation.error || !automation.data) fail('automation fixture', automation.error);
  const automationId = automation.data.id;

  const fixtureSteps = typeof params.steps === 'function'
    ? params.steps({ tagIdsByName })
    : params.steps;
  const insertedSteps = [];
  for (const [index, step] of fixtureSteps.entries()) {
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
      order: edge.order ?? index,
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
    tagIdsByName,
    threadId,
    triggerTagId,
    versionId,
    cleanup: async () => {
      const cleanupTables = [
        'automation_inbox_events',
        'automation_waits',
        'automation_step_attempts',
        'conversation_messages',
        'automation_jobs',
        'automation_enrollments',
        'deal_tag_assignments',
      ] as const;
      for (const table of cleanupTables) {
        const deleted = await admin
          .from(table)
          .delete()
          .eq('organization_id', organizationId);
        if (deleted.error) fail(`cleanup ${table}`, deleted.error);
      }

      const deletedOrganization = await admin
        .from('organizations')
        .delete()
        .eq('id', organizationId);
      if (deletedOrganization.error) {
        fail('cleanup organization', deletedOrganization.error);
      }

      const deletedActor = await admin.auth.admin.deleteUser(actorId);
      if (deletedActor.error) fail('cleanup actor', deletedActor.error);
    },
  };
}
