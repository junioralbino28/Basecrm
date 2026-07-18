// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createE2AdminClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';
import {
  createFunilTestFixture,
  type FunilTestFixture,
} from './helpers/funilTestFixture';
import { dispatchAutomationSimulation } from '@/lib/conversations/dispatchConversationOutbound';

const config = loadE2SupabaseConfig();
const describeLocal = config ? describe : describe.skip;

type PreparedWait = {
  fixture: FunilTestFixture;
  waitId: string;
};

describeLocal('F5 — wait_for_event e inbox idempotente no Supabase local', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const fixtures: FunilTestFixture[] = [];

  async function prepareWait(label: string, expiresAt: string): Promise<PreparedWait> {
    if (!admin) throw new Error('admin local ausente');
    const fixture = await createFunilTestFixture({
      admin,
      label,
      steps: [
        {
          type: 'send_message',
          config: {
            link_mode: 'copied',
            body_local: 'Mensagem inicial',
            message_kind: 'text',
          },
        },
        {
          type: 'wait_for_event',
          config: { timeout_amount: 1, timeout_unit: 'days' },
        },
        {
          type: 'create_task',
          config: { title: 'Resposta recebida' },
        },
        {
          type: 'create_task',
          config: { title: 'Sem resposta' },
        },
      ],
      edges: [
        { from: 0, to: 1, outcome: 'success' },
        { from: 1, to: 2, outcome: 'answered' },
        { from: 1, to: 3, outcome: 'timeout' },
      ],
    });
    fixtures.push(fixture);

    const materialized = await admin.rpc('materialize_automation_jobs', {
      p_batch_limit: 20,
    });
    if (materialized.error) throw new Error(materialized.error.message);
    const job = await admin
      .from('automation_jobs')
      .select('id')
      .eq('enrollment_id', fixture.enrollmentId)
      .eq('step_key', fixture.stepKeys[0])
      .single();
    if (job.error) throw new Error(job.error.message);
    await dispatchAutomationSimulation({ db: admin, jobId: job.data.id });

    const opened = await admin.rpc('open_automation_wait', {
      p_enrollment_id: fixture.enrollmentId,
      p_step_key: fixture.stepKeys[1],
      p_expires_at: expiresAt,
      p_outbound_provider_message_id: `outbound-${label}`,
    });
    if (opened.error) throw new Error(opened.error.message);

    return { fixture, waitId: opened.data.id };
  }

  beforeAll(() => {
    if (!admin) return;
  });

  afterAll(async () => {
    await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
  }, 120_000);

  it('mantém no máximo uma espera pendente por conversa e abertura repetida é idempotente', async () => {
    if (!admin) throw new Error('admin local ausente');
    const prepared = await prepareWait(
      'f5-one-pending',
      new Date(Date.now() + 60_000).toISOString(),
    );

    const repeated = await admin.rpc('open_automation_wait', {
      p_enrollment_id: prepared.fixture.enrollmentId,
      p_step_key: prepared.fixture.stepKeys[1],
      p_expires_at: new Date(Date.now() + 60_000).toISOString(),
      p_outbound_provider_message_id: 'outbound-f5-one-pending',
    });
    expect(repeated.error).toBeNull();
    expect(repeated.data.id).toBe(prepared.waitId);

    const pending = await admin
      .from('automation_waits')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', prepared.fixture.threadId)
      .eq('status', 'pending');
    expect(pending.count).toBe(1);
  });

  it('quote forte resolve uma única vez mesmo com inbox duplicada', async () => {
    if (!admin) throw new Error('admin local ausente');
    const prepared = await prepareWait(
      'f5-strong-quote',
      new Date(Date.now() + 60_000).toISOString(),
    );
    const message = await admin
      .from('conversation_messages')
      .insert({
        organization_id: prepared.fixture.organizationId,
        thread_id: prepared.fixture.threadId,
        channel_connection_id: prepared.fixture.channelConnectionId,
        direction: 'inbound',
        message_type: 'conversation',
        content: 'Quero continuar',
        provider_message_id: 'inbound-f5-strong-quote',
        delivery_status: 'sent',
      })
      .select('id, created_at')
      .single();
    expect(message.error).toBeNull();

    const receivedAt = new Date().toISOString();
    const candidate = await admin
      .from('automation_waits')
      .select('channel_connection_id, outbound_provider_message_id, opened_at')
      .eq('id', prepared.waitId)
      .single();
    expect(candidate.data).toMatchObject({
      channel_connection_id: prepared.fixture.channelConnectionId,
      outbound_provider_message_id: 'outbound-f5-strong-quote',
    });
    expect(new Date(candidate.data?.opened_at ?? 0).getTime()).toBeLessThanOrEqual(
      new Date(message.data?.created_at ?? 0).getTime(),
    );

    const args = {
      p_channel_connection_id: prepared.fixture.channelConnectionId,
      p_provider_message_id: 'inbound-f5-strong-quote',
      p_thread_id: prepared.fixture.threadId,
      p_message_id: message.data?.id,
      p_quoted_provider_message_id: 'outbound-f5-strong-quote',
      p_received_at: receivedAt,
    };
    const results = await Promise.all([
      admin.rpc('resolve_automation_wait_from_inbox', args),
      admin.rpc('resolve_automation_wait_from_inbox', args),
    ]);
    expect(results.every((result) => result.error === null)).toBe(true);
    expect(results.flatMap((result) => result.data)).toContainEqual(
      expect.objectContaining({ resolution: 'quote' }),
    );
    expect(results.flatMap((result) => result.data).filter((row) => !row.duplicate)).toHaveLength(1);

    const [wait, enrollment, events] = await Promise.all([
      admin.from('automation_waits').select('status, resolution_source').eq('id', prepared.waitId).single(),
      admin.from('automation_enrollments').select('status, current_step_key').eq('id', prepared.fixture.enrollmentId).single(),
      admin
        .from('automation_inbox_events')
        .select('id', { count: 'exact', head: true })
        .eq('channel_connection_id', prepared.fixture.channelConnectionId)
        .eq('provider_message_id', 'inbound-f5-strong-quote'),
    ]);
    expect(wait.data).toMatchObject({ status: 'resolved', resolution_source: 'quote' });
    expect(enrollment.data).toMatchObject({
      status: 'active',
      current_step_key: prepared.fixture.stepKeys[2],
    });
    expect(events.count).toBe(1);
  });

  it('resposta sem quote usa fallback determinístico pela conversa', async () => {
    if (!admin) throw new Error('admin local ausente');
    const prepared = await prepareWait(
      'f5-fallback',
      new Date(Date.now() + 60_000).toISOString(),
    );
    const message = await admin
      .from('conversation_messages')
      .insert({
        organization_id: prepared.fixture.organizationId,
        thread_id: prepared.fixture.threadId,
        channel_connection_id: prepared.fixture.channelConnectionId,
        direction: 'inbound',
        message_type: 'conversation',
        content: 'Resposta sem citação',
        provider_message_id: 'inbound-f5-fallback',
        delivery_status: 'sent',
      })
      .select('id')
      .single();

    const resolved = await admin.rpc('resolve_automation_wait_from_inbox', {
      p_channel_connection_id: prepared.fixture.channelConnectionId,
      p_provider_message_id: 'inbound-f5-fallback',
      p_thread_id: prepared.fixture.threadId,
      p_message_id: message.data?.id,
      p_quoted_provider_message_id: null,
      p_received_at: new Date().toISOString(),
    });
    expect(resolved.error).toBeNull();
    expect(resolved.data).toContainEqual(
      expect.objectContaining({ resolution: 'conversation_fallback' }),
    );

    const wait = await admin
      .from('automation_waits')
      .select('status, resolution_source')
      .eq('id', prepared.waitId)
      .single();
    expect(wait.data).toEqual({ status: 'resolved', resolution_source: 'conversation_fallback' });
  });

  it('resposta e timeout disputam a mesma linha; somente um caminho vence', async () => {
    if (!admin) throw new Error('admin local ausente');
    const prepared = await prepareWait(
      'f5-race',
      new Date(Date.now() + 60_000).toISOString(),
    );
    const opened = await admin
      .from('automation_waits')
      .select('opened_at')
      .eq('id', prepared.waitId)
      .single();
    expect(opened.error).toBeNull();
    const dueAt = new Date(
      new Date(opened.data?.opened_at ?? 0).getTime() + 50,
    ).toISOString();
    const madeDue = await admin
      .from('automation_waits')
      .update({ expires_at: dueAt })
      .eq('id', prepared.waitId);
    expect(madeDue.error).toBeNull();

    const remainingMs = new Date(dueAt).getTime() - Date.now();
    if (remainingMs >= 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingMs + 10));
    }

    const message = await admin
      .from('conversation_messages')
      .insert({
        organization_id: prepared.fixture.organizationId,
        thread_id: prepared.fixture.threadId,
        channel_connection_id: prepared.fixture.channelConnectionId,
        direction: 'inbound',
        message_type: 'conversation',
        content: 'Resposta no limite',
        provider_message_id: 'inbound-f5-race',
        delivery_status: 'sent',
      })
      .select('id')
      .single();

    const [inbox, timeout] = await Promise.all([
      admin.rpc('resolve_automation_wait_from_inbox', {
        p_channel_connection_id: prepared.fixture.channelConnectionId,
        p_provider_message_id: 'inbound-f5-race',
        p_thread_id: prepared.fixture.threadId,
        p_message_id: message.data?.id,
        p_quoted_provider_message_id: 'outbound-f5-race',
        p_received_at: new Date().toISOString(),
      }),
      admin.rpc('expire_due_automation_waits', { p_batch_limit: 20 }),
    ]);
    expect(inbox.error).toBeNull();
    expect(timeout.error).toBeNull();

    const [wait, enrollment] = await Promise.all([
      admin.from('automation_waits').select('status').eq('id', prepared.waitId).single(),
      admin.from('automation_enrollments').select('current_step_key').eq('id', prepared.fixture.enrollmentId).single(),
    ]);
    const winner = wait.data?.status;
    expect(['resolved', 'expired']).toContain(winner);
    expect(enrollment.data?.current_step_key).toBe(
      winner === 'resolved'
        ? prepared.fixture.stepKeys[2]
        : prepared.fixture.stepKeys[3],
    );
  });

  it('takeover humano pausa a inscrição sem apagar a espera', async () => {
    if (!admin) throw new Error('admin local ausente');
    const prepared = await prepareWait(
      'f5-takeover',
      new Date(Date.now() + 60_000).toISOString(),
    );

    const paused = await admin.rpc('pause_automation_enrollments_for_thread', {
      p_thread_id: prepared.fixture.threadId,
      p_actor_id: prepared.fixture.actorId,
      p_reason: 'human_active',
    });
    expect(paused.error).toBeNull();
    expect(paused.data).toHaveLength(1);

    const [enrollment, wait] = await Promise.all([
      admin
        .from('automation_enrollments')
        .select('status, paused_from_status, pause_reason')
        .eq('id', prepared.fixture.enrollmentId)
        .single(),
      admin.from('automation_waits').select('status').eq('id', prepared.waitId).single(),
    ]);
    expect(enrollment.data).toEqual({
      status: 'paused',
      paused_from_status: 'waiting',
      pause_reason: 'human_active',
    });
    expect(wait.data?.status).toBe('pending');
  });
});
