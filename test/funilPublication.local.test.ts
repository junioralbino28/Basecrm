// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createE2AdminClient,
  createE2UserClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';
import { publishAutomationDraft } from '@/lib/automations/publication';

const config = loadE2SupabaseConfig();
const describeE2 = config ? describe : describe.skip;

describeE2('F2 — publicação e pinagem de versão no Supabase local', () => {
  const runId = randomUUID();
  const password = `F2!${randomUUID()}aA1`;
  const admin = config ? createE2AdminClient(config) : null;

  let actorId = '';
  const actorClient = config ? createE2UserClient(config) : null;
  let organizationA = '';
  let organizationB = '';
  let dealA = '';
  let dealB = '';
  let contactA = '';
  let threadA = '';
  let channelA = '';
  let automationA = '';
  let templateA = '';
  let version1 = '';
  let enrollment1 = '';

  async function createCrmFixture(organizationId: string, label: string) {
    if (!admin) throw new Error('admin E2 ausente');
    const board = await admin
      .from('boards')
      .insert({
        organization_id: organizationId,
        name: `Board ${label} ${runId}`,
        is_default: false,
      })
      .select('id')
      .single();
    if (board.error) throw new Error(`board ${label}: ${board.error.message}`);

    const stage = await admin
      .from('board_stages')
      .insert({
        organization_id: organizationId,
        board_id: board.data.id,
        name: `Entrada ${label}`,
        color: '#3b82f6',
        order: 0,
      })
      .select('id')
      .single();
    if (stage.error) throw new Error(`stage ${label}: ${stage.error.message}`);

    const contact = await admin
      .from('contacts')
      .insert({
        organization_id: organizationId,
        name: `Contato ${label} ${runId}`,
        email: `f2.${label}.${runId}@example.com`,
      })
      .select('id')
      .single();
    if (contact.error) throw new Error(`contact ${label}: ${contact.error.message}`);

    const deal = await admin
      .from('deals')
      .insert({
        organization_id: organizationId,
        board_id: board.data.id,
        stage_id: stage.data.id,
        contact_id: contact.data.id,
        title: `Deal ${label} ${runId}`,
        value: 100,
        status: 'open',
      })
      .select('id')
      .single();
    if (deal.error) throw new Error(`deal ${label}: ${deal.error.message}`);
    return { contactId: contact.data.id, dealId: deal.data.id };
  }

  beforeAll(async () => {
    if (!admin || !config || !actorClient) return;

    const organizations = await admin
      .from('organizations')
      .insert([
        { name: `Funil F2 A ${runId}` },
        { name: `Funil F2 B ${runId}` },
      ])
      .select('id');
    if (organizations.error || organizations.data?.length !== 2) {
      throw new Error(`organizations F2: ${organizations.error?.message ?? 'retorno incompleto'}`);
    }
    organizationA = organizations.data[0].id;
    organizationB = organizations.data[1].id;

    const fixtureA = await createCrmFixture(organizationA, 'A');
    const fixtureB = await createCrmFixture(organizationB, 'B');
    contactA = fixtureA.contactId;
    dealA = fixtureA.dealId;
    dealB = fixtureB.dealId;

    const channel = await admin
      .from('channel_connections')
      .insert({
        organization_id: organizationA,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: `Canal F2 ${runId}`,
        status: 'connected',
      })
      .select('id')
      .single();
    if (channel.error) throw new Error(`channel F2: ${channel.error.message}`);
    channelA = channel.data.id;

    const thread = await admin
      .from('conversation_threads')
      .insert({
        organization_id: organizationA,
        channel_connection_id: channelA,
        contact_id: contactA,
        deal_id: dealA,
        title: `Thread F2 ${runId}`,
      })
      .select('id')
      .single();
    if (thread.error) throw new Error(`thread F2: ${thread.error.message}`);
    threadA = thread.data.id;

    const email = `funil.f2.editor.${runId}@example.com`;
    const actor = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'clinic_admin', organization_id: organizationA },
    });
    if (actor.error || !actor.data.user?.id) {
      throw new Error(`actor F2: ${actor.error?.message}`);
    }
    actorId = actor.data.user.id;
    const profile = await admin.from('profiles').upsert({
      id: actorId,
      email,
      name: 'Editor F2',
      first_name: 'Editor',
      role: 'clinic_admin',
      organization_id: organizationA,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (profile.error) throw new Error(`profile F2: ${profile.error.message}`);
    const signed = await actorClient.auth.signInWithPassword({ email, password });
    if (signed.error) throw new Error(`signIn F2: ${signed.error.message}`);

    const template = await admin
      .from('message_templates')
      .insert({
        organization_id: organizationA,
        name: `Template F2 ${runId}`,
        body: 'Olá {{ contato.primeiro_nome | default: "tudo bem" }}',
        variables: ['contato.primeiro_nome'],
        created_by: actorId,
      })
      .select('id')
      .single();
    if (template.error) throw new Error(`template F2: ${template.error.message}`);
    templateA = template.data.id;

    const automation = await admin
      .from('automations')
      .insert({
        organization_id: organizationA,
        name: `Automação F2 ${runId}`,
        created_by: actorId,
        trigger_config: { tag: 'f2' },
      })
      .select('id')
      .single();
    if (automation.error) throw new Error(`automation F2: ${automation.error.message}`);
    automationA = automation.data.id;

    const steps = await admin
      .from('automation_steps')
      .insert([
        {
          organization_id: organizationA,
          automation_id: automationA,
          step_type: 'send_message',
          sort_key: 0,
          config: {
            link_mode: 'linked',
            template_id: templateA,
            message_kind: 'text',
          },
        },
        {
          organization_id: organizationA,
          automation_id: automationA,
          step_type: 'wait_for_event',
          sort_key: 1,
          config: { timeout_amount: 1, timeout_unit: 'days' },
        },
        {
          organization_id: organizationA,
          automation_id: automationA,
          step_type: 'create_task',
          sort_key: 2,
          config: { title: 'Atender resposta' },
        },
        {
          organization_id: organizationA,
          automation_id: automationA,
          step_type: 'create_task',
          sort_key: 3,
          config: { title: 'Retomar contato' },
        },
      ])
      .select('id, sort_key');
    if (steps.error || steps.data?.length !== 4) {
      throw new Error(`steps F2: ${steps.error?.message ?? 'retorno incompleto'}`);
    }
    const stepId = (sortKey: number) =>
      steps.data.find((step) => step.sort_key === sortKey)?.id ?? '';
    const edges = await admin.from('automation_step_edges').insert([
      {
        organization_id: organizationA,
        automation_id: automationA,
        from_step_id: stepId(0),
        outcome: 'success',
        to_step_id: stepId(1),
        order: 0,
      },
      {
        organization_id: organizationA,
        automation_id: automationA,
        from_step_id: stepId(1),
        outcome: 'answered',
        to_step_id: stepId(2),
        order: 0,
      },
      {
        organization_id: organizationA,
        automation_id: automationA,
        from_step_id: stepId(1),
        outcome: 'timeout',
        to_step_id: stepId(3),
        order: 1,
      },
    ]);
    if (edges.error) throw new Error(`edges F2: ${edges.error.message}`);
  }, 120_000);

  afterAll(async () => {
    await actorClient?.auth.signOut();
    if (admin && actorId) await admin.auth.admin.deleteUser(actorId);
  }, 120_000);

  it('publica versão 1 por compiler + RPC transacional', async () => {
    if (!admin) throw new Error('admin E2 ausente');
    const published = await publishAutomationDraft({
      db: admin,
      automationId: automationA,
      actorId,
    });
    expect(published.version.version).toBe(1);
    expect(published.version.definition_hash).toBe(published.definitionHash);
    version1 = published.version.id;

    const automation = await admin
      .from('automations')
      .select('lifecycle_status, published_version_id')
      .eq('id', automationA)
      .single();
    expect(automation.error).toBeNull();
    expect(automation.data).toMatchObject({
      lifecycle_status: 'published',
      published_version_id: version1,
    });
  });

  it('cria inscrição fixada na versão vigente', async () => {
    if (!admin) throw new Error('admin E2 ausente');
    const enrolled = await admin
      .rpc('create_automation_enrollment', {
        p_automation_id: automationA,
        p_deal_id: dealA,
        p_contact_id: contactA,
        p_thread_id: threadA,
        p_channel_connection_id: channelA,
      });
    expect(enrolled.error).toBeNull();
    expect(enrolled.data).toMatchObject({
      organization_id: organizationA,
      automation_version_id: version1,
      status: 'active',
    });
    enrollment1 = enrolled.data.id;
  });

  it('republica template linked em v2 sem mover inscrição existente', async () => {
    if (!admin) throw new Error('admin E2 ausente');
    const changed = await admin
      .from('message_templates')
      .update({ body: 'Novo texto {{ contato.nome | default: "pessoa" }}' })
      .eq('id', templateA)
      .select('revision')
      .single();
    expect(changed.error).toBeNull();
    expect(changed.data.revision).toBe(2);

    const published = await publishAutomationDraft({
      db: admin,
      automationId: automationA,
      actorId,
    });
    expect(published.version.version).toBe(2);
    expect(published.version.id).not.toBe(version1);

    const originalEnrollment = await admin
      .from('automation_enrollments')
      .select('automation_version_id')
      .eq('id', enrollment1)
      .single();
    expect(originalEnrollment.data?.automation_version_id).toBe(version1);

    const nextEnrollment = await admin.rpc('create_automation_enrollment', {
      p_automation_id: automationA,
      p_deal_id: dealA,
      p_contact_id: contactA,
      p_thread_id: threadA,
      p_channel_connection_id: channelA,
    });
    expect(nextEnrollment.error).toBeNull();
    expect(nextEnrollment.data.automation_version_id).toBe(published.version.id);
  });

  it('bloqueia mutação de versão e inscrição cross-tenant no banco', async () => {
    if (!admin) throw new Error('admin E2 ausente');
    const mutateVersion = await admin
      .from('automation_versions')
      .update({ definition_hash: 'a'.repeat(64) })
      .eq('id', version1);
    expect(mutateVersion.error?.code).toBe('55000');

    const crossTenant = await admin.rpc('create_automation_enrollment', {
      p_automation_id: automationA,
      p_deal_id: dealB,
      p_contact_id: contactA,
      p_thread_id: threadA,
      p_channel_connection_id: channelA,
    });
    expect(crossTenant.error?.code).toBe('23503');
  });

  it('não expõe as RPCs de publicação/inscrição ao authenticated', async () => {
    if (!actorClient) throw new Error('client E2 ausente');
    const publishAttempt = await actorClient.rpc('publish_automation_version', {
      p_automation_id: automationA,
      p_expected_draft_revision: 1,
      p_definition_canonical: '{}',
      p_definition_hash: 'a'.repeat(64),
      p_created_by: actorId,
    });
    expect(publishAttempt.error?.code).toBe('42501');

    const enrollmentAttempt = await actorClient.rpc('create_automation_enrollment', {
      p_automation_id: automationA,
      p_deal_id: dealA,
      p_contact_id: contactA,
      p_thread_id: threadA,
      p_channel_connection_id: channelA,
    });
    expect(enrollmentAttempt.error?.code).toBe('42501');
  });
});
