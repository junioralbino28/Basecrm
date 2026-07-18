// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createE2AdminClient,
  createE2UserClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';
import { publishAutomationDraft } from '@/lib/automations/publication';
import {
  dispatchAutomationSimulation,
  dispatchManualConversationOutbound,
} from '@/lib/conversations/dispatchConversationOutbound';

const config = loadE2SupabaseConfig();
const describeE2 = config ? describe : describe.skip;

describeE2('F3 — outbox idempotente e dispatch simulation no Supabase local', () => {
  const runId = randomUUID();
  const password = `F3!${randomUUID()}aA1`;
  const admin = config ? createE2AdminClient(config) : null;
  const actorClient = config ? createE2UserClient(config) : null;

  let actorId = '';
  let organizationId = '';
  let foreignOrganizationId = '';
  let enrollmentId = '';
  let stepKey = '';
  let threadId = '';
  let channelConnectionId = '';
  let jobId = '';

  beforeAll(async () => {
    if (!admin || !actorClient) return;

    const organizations = await admin
      .from('organizations')
      .insert([
        { name: `Funil F3 ${runId}` },
        { name: `Funil F3 foreign ${runId}` },
      ])
      .select('id');
    if (organizations.error || organizations.data?.length !== 2) {
      throw new Error(`organizations F3: ${organizations.error?.message ?? 'retorno incompleto'}`);
    }
    organizationId = organizations.data[0].id;
    foreignOrganizationId = organizations.data[1].id;

    const board = await admin
      .from('boards')
      .insert({
        organization_id: organizationId,
        name: `Board F3 ${runId}`,
        is_default: false,
      })
      .select('id')
      .single();
    if (board.error) throw new Error(`board F3: ${board.error.message}`);
    const stage = await admin
      .from('board_stages')
      .insert({
        organization_id: organizationId,
        board_id: board.data.id,
        name: 'Entrada F3',
        color: '#3b82f6',
        order: 0,
      })
      .select('id')
      .single();
    if (stage.error) throw new Error(`stage F3: ${stage.error.message}`);
    const contact = await admin
      .from('contacts')
      .insert({
        organization_id: organizationId,
        name: `Contato F3 ${runId}`,
        email: `f3.${runId}@example.com`,
        phone: '5511999999999',
      })
      .select('id')
      .single();
    if (contact.error) throw new Error(`contact F3: ${contact.error.message}`);
    const deal = await admin
      .from('deals')
      .insert({
        organization_id: organizationId,
        board_id: board.data.id,
        stage_id: stage.data.id,
        contact_id: contact.data.id,
        title: `Deal F3 ${runId}`,
        value: 100,
        status: 'open',
      })
      .select('id')
      .single();
    if (deal.error) throw new Error(`deal F3: ${deal.error.message}`);

    const channel = await admin
      .from('channel_connections')
      .insert({
        organization_id: organizationId,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: `Canal F3 ${runId}`,
        status: 'connected',
        config: {},
      })
      .select('id')
      .single();
    if (channel.error) throw new Error(`channel F3: ${channel.error.message}`);
    channelConnectionId = channel.data.id;
    const thread = await admin
      .from('conversation_threads')
      .insert({
        organization_id: organizationId,
        channel_connection_id: channel.data.id,
        contact_id: contact.data.id,
        deal_id: deal.data.id,
        contact_phone: '5511999999999',
        title: `Thread F3 ${runId}`,
        status: 'ai_active',
        metadata: { routingMode: 'ai', humanLocked: false },
      })
      .select('id')
      .single();
    if (thread.error) throw new Error(`thread F3: ${thread.error.message}`);
    threadId = thread.data.id;

    const email = `funil.f3.editor.${runId}@example.com`;
    const actor = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'clinic_admin', organization_id: organizationId },
    });
    if (actor.error || !actor.data.user?.id) throw new Error(`actor F3: ${actor.error?.message}`);
    actorId = actor.data.user.id;
    const profile = await admin.from('profiles').upsert({
      id: actorId,
      email,
      name: 'Editor F3',
      first_name: 'Editor',
      role: 'clinic_admin',
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (profile.error) throw new Error(`profile F3: ${profile.error.message}`);
    const signed = await actorClient.auth.signInWithPassword({ email, password });
    if (signed.error) throw new Error(`signIn F3: ${signed.error.message}`);

    const automation = await admin
      .from('automations')
      .insert({
        organization_id: organizationId,
        name: `Automação F3 ${runId}`,
        created_by: actorId,
        trigger_config: { tag: 'f3' },
      })
      .select('id')
      .single();
    if (automation.error) throw new Error(`automation F3: ${automation.error.message}`);
    const step = await admin
      .from('automation_steps')
      .insert({
        organization_id: organizationId,
        automation_id: automation.data.id,
        step_type: 'send_message',
        config: {
          link_mode: 'copied',
          body_local: 'Olá {{ contato.primeiro_nome | default: "tudo bem" }}',
          message_kind: 'text',
        },
      })
      .select('step_key')
      .single();
    if (step.error) throw new Error(`step F3: ${step.error.message}`);
    stepKey = step.data.step_key;

    await publishAutomationDraft({
      db: admin,
      automationId: automation.data.id,
      actorId,
    });
    const enrolled = await admin.rpc('create_automation_enrollment', {
      p_automation_id: automation.data.id,
      p_deal_id: deal.data.id,
      p_contact_id: contact.data.id,
      p_thread_id: threadId,
      p_channel_connection_id: channel.data.id,
    });
    if (enrolled.error) throw new Error(`enrollment F3: ${enrolled.error.message}`);
    enrollmentId = enrolled.data.id;
  }, 120_000);

  afterAll(async () => {
    await actorClient?.auth.signOut();
    if (admin && actorId) await admin.auth.admin.deleteUser(actorId);
  }, 120_000);

  it('capability de live nasce false', async () => {
    if (!admin) throw new Error('admin E2 ausente');
    const settings = await admin
      .from('organization_settings')
      .select('automation_live_enabled')
      .eq('organization_id', organizationId)
      .single();
    expect(settings.error).toBeNull();
    expect(settings.data?.automation_live_enabled).toBe(false);
  });

  it('manual persiste pending antes do adapter e deduplica a repetição', async () => {
    if (!admin) throw new Error('admin E2 ausente');
    const idempotencyKey = `manual:f3:${runId}`;
    const deliver = vi.fn(async () => {
      const pending = await admin
        .from('conversation_messages')
        .select('delivery_status')
        .eq('organization_id', organizationId)
        .eq('idempotency_key', idempotencyKey)
        .single();
      expect(pending.data?.delivery_status).toBe('pending');
      return {
        status: 'sent' as const,
        providerMessageId: `provider-${runId}`,
        attemptLabel: 'test-adapter',
        error: null,
        metadata: { provider: 'fake-local' },
      };
    });
    const message = {
      threadId,
      organizationId,
      channelConnectionId,
      idempotencyKey,
      messageType: 'text',
      authorName: 'Operador',
      content: 'Mensagem manual persist-first',
      metadata: {},
      sentAt: new Date().toISOString(),
    };

    const first = await dispatchManualConversationOutbound({
      db: admin,
      message,
      deliver,
    });
    const repeated = await dispatchManualConversationOutbound({
      db: admin,
      message,
      deliver,
    });

    expect(first.status).toBe('sent');
    expect(repeated.duplicate).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(1);
    const stored = await admin
      .from('conversation_messages')
      .select('delivery_status, provider_message_id', { count: 'exact' })
      .eq('organization_id', organizationId)
      .eq('idempotency_key', idempotencyKey);
    expect(stored.count).toBe(1);
    expect(stored.data).toEqual([{
      delivery_status: 'sent',
      provider_message_id: `provider-${runId}`,
    }]);
  });

  it('enqueue repetido devolve o mesmo job e rejeita colisão semântica', async () => {
    if (!admin) throw new Error('admin E2 ausente');
    const payload = {
      content: 'Payload renderizado F3',
      messageType: 'text',
      authorName: 'Automação',
      metadata: { test_run: runId },
    };
    const first = await admin.rpc('enqueue_automation_job', {
      p_enrollment_id: enrollmentId,
      p_step_key: stepKey,
      p_job_type: 'send_message',
      p_idempotency_key: `enrollment:${enrollmentId}:step:${stepKey}:1`,
      p_payload: payload,
    });
    expect(first.error).toBeNull();
    jobId = first.data.id;

    const repeated = await admin.rpc('enqueue_automation_job', {
      p_enrollment_id: enrollmentId,
      p_step_key: stepKey,
      p_job_type: 'send_message',
      p_idempotency_key: `enrollment:${enrollmentId}:step:${stepKey}:1`,
      p_payload: payload,
    });
    expect(repeated.error).toBeNull();
    expect(repeated.data.id).toBe(jobId);

    const collision = await admin.rpc('enqueue_automation_job', {
      p_enrollment_id: enrollmentId,
      p_step_key: stepKey,
      p_job_type: 'send_message',
      p_idempotency_key: `enrollment:${enrollmentId}:step:${stepKey}:1`,
      p_payload: { ...payload, content: 'Outro conteúdo' },
    });
    expect(collision.error?.code).toBe('23505');
  });

  it('simula uma única vez, sem provider ID e sem takeover humano', async () => {
    if (!admin) throw new Error('admin E2 ausente');
    const dispatched = await dispatchAutomationSimulation({ db: admin, jobId });
    expect(dispatched).toMatchObject({
      status: 'simulated',
      providerMessageId: null,
    });

    const [job, messages, attempts, thread] = await Promise.all([
      admin.from('automation_jobs').select('status, attempt_count').eq('id', jobId).single(),
      admin
        .from('conversation_messages')
        .select('id, delivery_status, provider_message_id, content')
        .eq('automation_job_id', jobId),
      admin
        .from('automation_step_attempts')
        .select('status, provider_message_id, rendered_content')
        .eq('job_id', jobId),
      admin
        .from('conversation_threads')
        .select('status, metadata')
        .eq('id', threadId)
        .single(),
    ]);
    expect(job.data).toEqual({ status: 'simulated', attempt_count: 1 });
    expect(messages.data).toEqual([
      expect.objectContaining({
        delivery_status: 'simulated',
        provider_message_id: null,
        content: 'Payload renderizado F3',
      }),
    ]);
    expect(attempts.data).toEqual([
      expect.objectContaining({
        status: 'simulated',
        provider_message_id: null,
        rendered_content: 'Payload renderizado F3',
      }),
    ]);
    expect(thread.data?.status).toBe('ai_active');
    expect(thread.data?.metadata).toMatchObject({
      routingMode: 'ai',
      humanLocked: false,
    });

    const repeated = await dispatchAutomationSimulation({ db: admin, jobId });
    expect(repeated.duplicate).toBe(true);
    const counts = await Promise.all([
      admin
        .from('conversation_messages')
        .select('id', { count: 'exact', head: true })
        .eq('automation_job_id', jobId),
      admin
        .from('automation_step_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId),
    ]);
    expect(counts[0].count).toBe(1);
    expect(counts[1].count).toBe(1);
  });

  it('FK tenant-safe recusa job forjado e authenticated não chama RPC interna', async () => {
    if (!admin || !actorClient) throw new Error('clients E2 ausentes');
    const current = await admin
      .from('automation_jobs')
      .select('version_id')
      .eq('id', jobId)
      .single();
    const forged = await admin.from('automation_jobs').insert({
      organization_id: foreignOrganizationId,
      enrollment_id: enrollmentId,
      version_id: current.data?.version_id,
      step_key: stepKey,
      job_type: 'send_message',
      idempotency_key: `forged:${runId}`,
    });
    expect(forged.error?.code).toBe('23503');

    const forbidden = await actorClient.rpc('prepare_automation_outbound', {
      p_job_id: jobId,
    });
    expect(forbidden.error?.code).toBe('42501');
  });
});
