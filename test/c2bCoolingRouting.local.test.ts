// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishAutomationDraft } from '@/lib/automations/publication';
import {
  createE2AdminClient,
  createE2UserClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';

const config = loadE2SupabaseConfig();
const describeLocal = config ? describe : describe.skip;

type Scenario = {
  channelId: string;
  dealId: string;
  tagIds: string[];
  threadId: string;
};

describeLocal('C2B — esfriamento roteia por UUID no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const actorClient = config ? createE2UserClient(config) : null;
  const runId = randomUUID();
  const password = `C2B!${runId}aA1`;
  let actorId = '';
  let organizationId = '';

  async function createScenario(label: string, tagCount: number): Promise<Scenario> {
    if (!admin) throw new Error('admin local ausente');
    const contact = await admin.from('contacts').insert({
      organization_id: organizationId,
      name: `Contato ${label} ${runId}`,
      phone: `5511${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, '0')}`,
    }).select('id').single();
    if (contact.error || !contact.data) throw contact.error;
    const deal = await admin.from('deals').insert({
      organization_id: organizationId,
      contact_id: contact.data.id,
      title: `Negócio ${label} ${runId}`,
      status: 'open',
    }).select('id').single();
    if (deal.error || !deal.data) throw deal.error;
    const channel = await admin.from('channel_connections').insert({
      organization_id: organizationId,
      provider: 'evolution',
      channel_type: 'whatsapp',
      name: `Canal ${label} ${runId}`,
      status: 'connected',
      config: {},
    }).select('id').single();
    if (channel.error || !channel.data) throw channel.error;
    const thread = await admin.from('conversation_threads').insert({
      organization_id: organizationId,
      channel_connection_id: channel.data.id,
      contact_id: contact.data.id,
      deal_id: deal.data.id,
      title: `Conversa ${label} ${runId}`,
      status: 'open',
    }).select('id').single();
    if (thread.error || !thread.data) throw thread.error;
    const category = await admin.from('tag_categories').insert({
      organization_id: organizationId,
      label: `Procedimentos ${label} ${runId}`,
      cardinality: 'multiple',
    }).select('id').single();
    if (category.error || !category.data) throw category.error;

    const tags = await admin.from('tags').insert(
      Array.from({ length: tagCount }, (_, index) => ({
        organization_id: organizationId,
        category_id: category.data.id,
        name: `Procedimento ${label} ${index + 1} ${runId}`,
      })),
    ).select('id');
    if (tags.error || !tags.data || tags.data.length !== tagCount) throw tags.error;

    for (const [index, tag] of tags.data.entries()) {
      const automation = await admin.from('automations').insert({
        organization_id: organizationId,
        name: `Follow-up ${label} ${index + 1}`,
        created_by: actorId,
        trigger_config: { tag_id: tag.id },
        delivery_mode: 'simulation',
      }).select('id').single();
      if (automation.error || !automation.data) throw automation.error;
      const step = await admin.from('automation_steps').insert({
        organization_id: organizationId,
        automation_id: automation.data.id,
        step_type: 'send_message',
        sort_key: 0,
        config: {
          link_mode: 'copied',
          body_local: `Follow-up ${label} ${index + 1}`,
          message_kind: 'text',
          channel: 'whatsapp',
        },
      });
      if (step.error) throw step.error;
      await publishAutomationDraft({
        db: admin,
        automationId: automation.data.id,
        actorId,
      });
    }

    return {
      channelId: channel.data.id,
      dealId: deal.data.id,
      tagIds: tags.data.map(({ id }) => id),
      threadId: thread.data.id,
    };
  }

  async function assignTags(scenario: Scenario) {
    if (!actorClient) throw new Error('actor local ausente');
    for (const tagId of scenario.tagIds) {
      const assigned = await actorClient.rpc('assign_deal_tag', {
        p_organization_id: organizationId,
        p_deal_id: scenario.dealId,
        p_tag_id: tagId,
        p_is_primary: false,
      });
      if (assigned.error) throw assigned.error;
    }
  }

  async function insertMessage(
    scenario: Scenario,
    direction: 'inbound' | 'outbound',
    createdAt: string,
    providerMessageId?: string,
  ) {
    if (!admin) throw new Error('admin local ausente');
    const message = await admin.from('conversation_messages').insert({
      organization_id: organizationId,
      thread_id: scenario.threadId,
      channel_connection_id: scenario.channelId,
      direction,
      message_type: 'text',
      content: `Mensagem ${direction} ${randomUUID()}`,
      provider_message_id: providerMessageId,
      created_at: createdAt,
    }).select('id').single();
    if (message.error || !message.data) throw message.error;
    return message.data.id as string;
  }

  beforeAll(async () => {
    if (!admin || !actorClient || !config) return;
    const organization = await admin.from('organizations').insert({
      name: `C2B roteamento ${runId}`,
    }).select('id').single();
    if (organization.error || !organization.data) throw organization.error;
    organizationId = organization.data.id;
    const email = `c2b.routing.${runId}@example.com`;
    const actor = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (actor.error || !actor.data.user) throw actor.error;
    actorId = actor.data.user.id;
    const profile = await admin.from('profiles').upsert({
      id: actorId,
      email,
      name: 'Admin C2B',
      first_name: 'Admin',
      role: 'clinic_admin',
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    });
    if (profile.error) throw profile.error;
    const signed = await actorClient.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
  }, 120_000);

  afterAll(async () => {
    await actorClient?.auth.signOut();
    if (admin && organizationId) {
      for (const table of [
        'automation_inbox_events',
        'automation_jobs',
        'automation_waits',
        'automation_enrollments',
        'automation_routing_gates',
        'automation_routing_events',
        'automation_conversation_clocks',
        'conversation_messages',
        'automations',
        'tasks',
      ] as const) {
        const cleaned = await admin.from(table).delete().eq('organization_id', organizationId);
        if (cleaned.error) throw cleaned.error;
      }
      const removed = await admin.from('organizations').delete().eq('id', organizationId);
      if (removed.error) throw removed.error;
    }
    if (admin && actorId) await admin.auth.admin.deleteUser(actorId);
  }, 120_000);

  it('atribuir interesse não inscreve; esfriamento único inscreve uma vez sob corrida', async () => {
    if (!admin) throw new Error('admin local ausente');
    const scenario = await createScenario('direto', 1);
    await assignTags(scenario);
    const beforeCooling = await admin.from('automation_enrollments')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('deal_id', scenario.dealId);
    expect(beforeCooling.data).toEqual([]);

    const now = new Date();
    await insertMessage(
      scenario,
      'inbound',
      new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    );
    const [first, second] = await Promise.all([
      admin.rpc('process_due_automation_routing', { p_batch_limit: 20, p_now: now.toISOString() }),
      admin.rpc('process_due_automation_routing', { p_batch_limit: 20, p_now: now.toISOString() }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const [events, enrollments, gates] = await Promise.all([
      admin.from('automation_routing_events').select('status, candidate_count, task_id')
        .eq('deal_id', scenario.dealId),
      admin.from('automation_enrollments').select('id, entry_tag_id, routing_event_id')
        .eq('deal_id', scenario.dealId),
      admin.from('automation_routing_gates').select('id').eq('deal_id', scenario.dealId),
    ]);
    expect(events.data).toEqual([{ status: 'enrolled', candidate_count: 1, task_id: null }]);
    expect(enrollments.data).toHaveLength(1);
    expect(enrollments.data?.[0]).toMatchObject({ entry_tag_id: scenario.tagIds[0] });
    expect(enrollments.data?.[0].routing_event_id).toBeTruthy();
    expect(gates.data).toEqual([]);
  }, 120_000);

  it('qualquer evento novo reinicia os cinco dias', async () => {
    if (!admin) throw new Error('admin local ausente');
    const scenario = await createScenario('reinicia', 1);
    await assignTags(scenario);
    const now = new Date();
    await insertMessage(
      scenario,
      'inbound',
      new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    );
    await insertMessage(scenario, 'outbound', now.toISOString());

    const processed = await admin.rpc('process_due_automation_routing', {
      p_batch_limit: 20,
      p_now: now.toISOString(),
    });
    expect(processed.error).toBeNull();
    const enrollments = await admin.from('automation_enrollments').select('id')
      .eq('deal_id', scenario.dealId);
    expect(enrollments.data).toEqual([]);
    const clock = await admin.from('automation_conversation_clocks')
      .select('generation, last_activity_at, route_after')
      .eq('thread_id', scenario.threadId)
      .single();
    expect(clock.data?.generation).toBe(2);
    expect(new Date(clock.data!.last_activity_at).getTime()).toBe(now.getTime());
    expect(new Date(clock.data!.route_after).getTime()).toBe(
      now.getTime() + 5 * 24 * 60 * 60 * 1000,
    );
  }, 120_000);

  it('resposta pausa a inscrição e só permite reentrada após nova carência completa', async () => {
    if (!admin || !actorClient) throw new Error('clientes locais ausentes');
    const scenario = await createScenario('reentrada', 2);
    const firstAssignment = await actorClient.rpc('assign_deal_tag', {
      p_organization_id: organizationId,
      p_deal_id: scenario.dealId,
      p_tag_id: scenario.tagIds[0],
      p_is_primary: false,
    });
    expect(firstAssignment.error).toBeNull();
    const now = new Date();
    const firstActivityAt = new Date(
      now.getTime() - 12 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await insertMessage(scenario, 'inbound', firstActivityAt);
    const firstRoutingAt = new Date(
      now.getTime() - 6 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const firstRouting = await admin.rpc('process_due_automation_routing', {
      p_batch_limit: 20,
      p_now: firstRoutingAt,
    });
    expect(firstRouting.error).toBeNull();
    expect(firstRouting.data?.[0]).toMatchObject({ outcome: 'enrolled' });

    const responseAt = new Date(
      now.getTime() - 4 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const providerMessageId = `c2b-reentrada-${randomUUID()}`;
    const messageId = await insertMessage(
      scenario,
      'inbound',
      responseAt,
      providerMessageId,
    );
    const paused = await admin.rpc('resolve_automation_wait_from_inbox', {
      p_channel_connection_id: scenario.channelId,
      p_provider_message_id: providerMessageId,
      p_thread_id: scenario.threadId,
      p_message_id: messageId,
      p_quoted_provider_message_id: null,
      p_received_at: responseAt,
    });
    expect(paused.error).toBeNull();

    const removed = await actorClient.rpc('remove_deal_tag', {
      p_organization_id: organizationId,
      p_deal_id: scenario.dealId,
      p_tag_id: scenario.tagIds[0],
    });
    const reassigned = await actorClient.rpc('assign_deal_tag', {
      p_organization_id: organizationId,
      p_deal_id: scenario.dealId,
      p_tag_id: scenario.tagIds[1],
      p_is_primary: false,
    });
    expect(removed.error).toBeNull();
    expect(reassigned.error).toBeNull();

    const tooEarly = await admin.rpc('process_due_automation_routing', {
      p_batch_limit: 20,
      p_now: now.toISOString(),
    });
    expect(tooEarly.error).toBeNull();
    expect(tooEarly.data).toEqual([]);
    const beforeReentry = await admin.from('automation_enrollments')
      .select('status, pause_reason')
      .eq('deal_id', scenario.dealId);
    expect(beforeReentry.data).toEqual([{
      status: 'paused',
      pause_reason: 'patient_inbound',
    }]);

    const afterGrace = new Date(
      now.getTime() + 2 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const rerouted = await admin.rpc('process_due_automation_routing', {
      p_batch_limit: 20,
      p_now: afterGrace,
    });
    expect(rerouted.error).toBeNull();
    expect(rerouted.data?.[0]).toMatchObject({ outcome: 'enrolled' });
    const afterReentry = await admin.from('automation_enrollments')
      .select('status, entry_tag_id')
      .eq('deal_id', scenario.dealId)
      .order('entered_at');
    expect(afterReentry.data).toEqual([
      { status: 'paused', entry_tag_id: scenario.tagIds[0] },
      { status: 'active', entry_tag_id: scenario.tagIds[1] },
    ]);
  }, 120_000);

  it('dois procedimentos criam um porteiro; resolver é idempotente e só então inscreve', async () => {
    if (!admin || !actorClient) throw new Error('clientes locais ausentes');
    const scenario = await createScenario('porteiro', 2);
    await assignTags(scenario);
    const now = new Date();
    await insertMessage(
      scenario,
      'inbound',
      new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    );
    const processed = await admin.rpc('process_due_automation_routing', {
      p_batch_limit: 20,
      p_now: now.toISOString(),
    });
    expect(processed.error).toBeNull();
    expect(processed.data?.[0]).toMatchObject({ outcome: 'gated' });

    const [gate, task, beforeResolution] = await Promise.all([
      admin.from('automation_routing_gates').select('id, task_id, status')
        .eq('deal_id', scenario.dealId).single(),
      admin.from('tasks').select('id, due_date, status')
        .eq('organization_id', organizationId)
        .eq('title', 'Definir procedimento principal antes do follow-up')
        .order('created_at', { ascending: false })
        .limit(1).single(),
      admin.from('automation_enrollments').select('id').eq('deal_id', scenario.dealId),
    ]);
    expect(gate.data).toMatchObject({ status: 'open' });
    expect(task.data).toMatchObject({ id: gate.data?.task_id, status: 'open' });
    expect(task.data?.due_date).toBe(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now));
    expect(beforeResolution.data).toEqual([]);

    const first = await actorClient.rpc('resolve_automation_routing_gate', {
      p_gate_id: gate.data!.id,
      p_tag_id: scenario.tagIds[1],
    });
    const retry = await actorClient.rpc('resolve_automation_routing_gate', {
      p_gate_id: gate.data!.id,
      p_tag_id: scenario.tagIds[1],
    });
    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data.id).toBe(first.data.id);

    const [enrollments, assignments, resolvedGate, resolvedTask] = await Promise.all([
      admin.from('automation_enrollments').select('id, entry_tag_id')
        .eq('deal_id', scenario.dealId),
      admin.from('deal_tag_assignments').select('tag_id, is_primary')
        .eq('deal_id', scenario.dealId).is('removed_at', null),
      admin.from('automation_routing_gates').select('status, selected_tag_id')
        .eq('id', gate.data!.id).single(),
      admin.from('tasks').select('status, completed_at').eq('id', gate.data!.task_id).single(),
    ]);
    expect(enrollments.data).toEqual([{ id: first.data.id, entry_tag_id: scenario.tagIds[1] }]);
    expect(assignments.data?.find(({ tag_id }) => tag_id === scenario.tagIds[1])?.is_primary)
      .toBe(true);
    expect(resolvedGate.data).toMatchObject({
      status: 'resolved',
      selected_tag_id: scenario.tagIds[1],
    });
    expect(resolvedTask.data?.status).toBe('done');
    expect(resolvedTask.data?.completed_at).toBeTruthy();
  }, 120_000);
});
