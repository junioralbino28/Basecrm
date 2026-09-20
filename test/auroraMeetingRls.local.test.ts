// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import {
  assertNoSupabaseError,
  getSupabaseAdminClient,
  requireSupabaseData,
} from './helpers/supabaseAdmin';
import { getAnonKey, getSupabaseUrl } from './helpers/env';

const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

describeLocal('Aurora meeting handoff — RLS local A↔B', () => {
  let runId = '';
  let orgAId = '';
  let orgBId = '';
  let threadAId = '';
  let threadBId = '';
  let activityAId = '';
  let activityBId = '';
  let calendarBlockAId = '';
  let calendarBlockBId = '';
  let channelAId = '';
  let userAId = '';
  let userBId = '';
  let userAEmail = '';
  const password = `Vitest!${randomUUID()}`;
  const originalDateB = '2026-09-23T18:00:00.000Z';

  beforeAll(async () => {
    if (!isLocalSupabase) return;
    const fixtures = await createMinimalFixtures();
    runId = fixtures.runId;
    orgAId = fixtures.orgA.organizationId;
    orgBId = fixtures.orgB.organizationId;

    const admin = getSupabaseAdminClient();
    const threads = await admin
      .from('conversation_threads')
      .insert([
        {
          organization_id: orgAId,
          contact_id: fixtures.contactA.contactId,
          deal_id: fixtures.dealA.dealId,
          title: `Aurora A ${runId}`,
          contact_phone: '+5511999990001',
          status: 'human_queue',
        },
        {
          organization_id: orgBId,
          contact_id: fixtures.contactB.contactId,
          deal_id: fixtures.dealB.dealId,
          title: `Aurora B ${runId}`,
          contact_phone: '+5511999990002',
          status: 'human_queue',
        },
      ])
      .select('id, organization_id');
    const threadRows = requireSupabaseData(threads, 'insert conversation threads');
    threadAId = threadRows.find(row => row.organization_id === orgAId)?.id || '';
    threadBId = threadRows.find(row => row.organization_id === orgBId)?.id || '';

    activityAId = randomUUID();
    activityBId = randomUUID();
    assertNoSupabaseError(await admin.from('activities').insert([
      {
        id: activityAId,
        organization_id: orgAId,
        title: `Reuniao Aurora A ${runId}`,
        type: 'MEETING',
        date: '2026-09-22T18:00:00.000Z',
        completed: false,
        contact_id: fixtures.contactA.contactId,
        deal_id: fixtures.dealA.dealId,
      },
      {
        id: activityBId,
        organization_id: orgBId,
        title: `Reuniao Aurora B ${runId}`,
        type: 'MEETING',
        date: originalDateB,
        completed: false,
        contact_id: fixtures.contactB.contactId,
        deal_id: fixtures.dealB.dealId,
      },
    ]), 'insert meeting activities');

    userAEmail = `aurora.admin.${runId}.${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({
      email: userAEmail,
      password,
      email_confirm: true,
      user_metadata: { role: 'clinic_admin', organization_id: orgAId },
    });
    if (created.error || !created.data.user?.id) {
      throw new Error(`Falha ao criar usuario A: ${created.error?.message}`);
    }
    userAId = created.data.user.id;
    assertNoSupabaseError(await admin.from('profiles').upsert({
      id: userAId,
      email: userAEmail,
      name: `Aurora Admin A ${runId}`,
      first_name: 'Aurora',
      organization_id: orgAId,
      role: 'clinic_admin',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' }), 'upsert profile A');

    const createdB = await admin.auth.admin.createUser({
      email: `aurora.admin.b.${runId}.${randomUUID()}@example.com`,
      password,
      email_confirm: true,
      user_metadata: { role: 'clinic_admin', organization_id: orgBId },
    });
    if (createdB.error || !createdB.data.user?.id) {
      throw new Error(`Falha ao criar usuario B: ${createdB.error?.message}`);
    }
    userBId = createdB.data.user.id;
    assertNoSupabaseError(await admin.from('profiles').upsert({
      id: userBId,
      email: createdB.data.user.email,
      name: `Aurora Admin B ${runId}`,
      first_name: 'Aurora B',
      organization_id: orgBId,
      role: 'clinic_admin',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' }), 'upsert profile B');

    const channels = requireSupabaseData(await admin.from('channel_connections').insert([
      { organization_id: orgAId, provider: 'evolution', channel_type: 'whatsapp', name: `Canal A ${runId}` },
      { organization_id: orgBId, provider: 'evolution', channel_type: 'whatsapp', name: `Canal B ${runId}` },
    ]).select('id, organization_id'), 'insert calendar channels');
    channelAId = channels.find(row => row.organization_id === orgAId)?.id || '';
    const channelBId = channels.find(row => row.organization_id === orgBId)?.id || '';
    const blocks = requireSupabaseData(await admin.from('conversation_calendar_blocks').insert([
      {
        organization_id: orgAId, channel_connection_id: channelAId, owner_id: userAId,
        title: 'Almoço A', kind: 'lunch', recurrence: 'weekly', weekdays: ['monday'],
        start_time: '12:00', end_time: '13:00', all_day: false,
      },
      {
        organization_id: orgBId, channel_connection_id: channelBId, owner_id: userBId,
        title: 'Almoço B', kind: 'lunch', recurrence: 'weekly', weekdays: ['monday'],
        start_time: '12:00', end_time: '13:00', all_day: false,
      },
    ]).select('id, organization_id'), 'insert calendar blocks');
    calendarBlockAId = blocks.find(row => row.organization_id === orgAId)?.id || '';
    calendarBlockBId = blocks.find(row => row.organization_id === orgBId)?.id || '';
  }, 120_000);

  afterAll(async () => {
    if (!isLocalSupabase) return;
    const admin = getSupabaseAdminClient();
    if (userBId) await admin.auth.admin.deleteUser(userBId);
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('usuario do tenant A nao enxerga thread nem atividade do tenant B', async () => {
    const client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await client.auth.signInWithPassword({ email: userAEmail, password });
    expect(signIn.error).toBeNull();

    const threads = await client.from('conversation_threads').select('id, organization_id');
    expect(threads.error).toBeNull();
    expect((threads.data || []).map(row => row.id)).toContain(threadAId);
    expect((threads.data || []).map(row => row.id)).not.toContain(threadBId);

    const activities = await client.from('activities').select('id, organization_id');
    expect(activities.error).toBeNull();
    expect((activities.data || []).map(row => row.id)).toContain(activityAId);
    expect((activities.data || []).map(row => row.id)).not.toContain(activityBId);
  });

  it('usuario do tenant A nao consegue ajustar atividade do tenant B', async () => {
    const client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await client.auth.signInWithPassword({ email: userAEmail, password });
    expect(signIn.error).toBeNull();

    const attempted = await client
      .from('activities')
      .update({ date: '2026-09-30T18:00:00.000Z' })
      .eq('id', activityBId)
      .select('id');
    expect(attempted.error).toBeNull();
    expect(attempted.data).toEqual([]);

    const persisted = await getSupabaseAdminClient()
      .from('activities')
      .select('date')
      .eq('id', activityBId)
      .eq('organization_id', orgBId)
      .single();
    expect(
      new Date(requireSupabaseData(persisted, 'read activity B').date).toISOString()
    ).toBe(originalDateB);
  });

  it('usuario do tenant A enxerga e altera apenas bloqueios da propria organizacao', async () => {
    const client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await client.auth.signInWithPassword({ email: userAEmail, password });
    expect(signIn.error).toBeNull();

    const visible = await client.from('conversation_calendar_blocks').select('id, organization_id');
    expect(visible.error).toBeNull();
    expect((visible.data || []).map(row => row.id)).toContain(calendarBlockAId);
    expect((visible.data || []).map(row => row.id)).not.toContain(calendarBlockBId);

    const attempted = await client
      .from('conversation_calendar_blocks')
      .update({ title: 'Alterado por A' })
      .eq('id', calendarBlockBId)
      .select('id');
    expect(attempted.error).toBeNull();
    expect(attempted.data).toEqual([]);
  });

  it('o banco recusa responsável de outra organização mesmo via service role', async () => {
    const attempted = await getSupabaseAdminClient().from('conversation_calendar_blocks').insert({
      organization_id: orgAId,
      channel_connection_id: channelAId,
      owner_id: userBId,
      title: 'Responsável cruzado',
      kind: 'busy',
      recurrence: 'once',
      block_date: '2026-09-25',
      weekdays: [],
      start_time: '10:00',
      end_time: '11:00',
      all_day: false,
    });
    expect(attempted.error?.message).toContain('calendar block owner must belong to organization');
  });
});
