// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { getSupabaseAdminClient } from './helpers/supabaseAdmin';
import { getAnonKey, getSupabaseUrl } from './helpers/env';

const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

describeLocal('reserva atomica de reuniao da Aurora — Supabase local', () => {
  let fixtures: Awaited<ReturnType<typeof createMinimalFixtures>>;
  let ownerAId = '';
  let channelAId = '';

  beforeAll(async () => {
    fixtures = await createMinimalFixtures();
    const admin = getSupabaseAdminClient();
    const created = await admin.auth.admin.createUser({
      email: `aurora.reservation.${fixtures.runId}.${randomUUID()}@example.com`,
      password: `Vitest!${randomUUID()}`,
      email_confirm: true,
    });
    if (created.error || !created.data.user?.id) {
      throw new Error(`Falha ao criar responsavel da agenda: ${created.error?.message}`);
    }
    ownerAId = created.data.user.id;
    const profile = await admin.from('profiles').upsert({
      id: ownerAId,
      email: created.data.user.email,
      name: `Responsavel Aurora ${fixtures.runId}`,
      first_name: 'Aurora',
      organization_id: fixtures.orgA.organizationId,
      role: 'clinic_admin',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (profile.error) throw new Error(profile.error.message);

    const channel = await admin.from('channel_connections').insert({
      organization_id: fixtures.orgA.organizationId,
      provider: 'evolution',
      channel_type: 'whatsapp',
      name: `Agenda Aurora ${fixtures.runId}`,
    }).select('id').single();
    if (channel.error || !channel.data?.id) throw new Error(channel.error?.message || 'Canal nao criado.');
    channelAId = channel.data.id;
  }, 120_000);

  afterAll(async () => {
    if (ownerAId) await getSupabaseAdminClient().auth.admin.deleteUser(ownerAId);
    if (fixtures?.runId) await cleanupFixtures(fixtures.runId);
  }, 120_000);

  function reservation(input: {
    organizationId: string;
    contactId: string;
    dealId: string;
    activityId?: string;
    date: string;
    ownerId?: string | null;
    channelConnectionId?: string | null;
    timezone?: string;
    allowUpdate?: boolean;
  }) {
    return getSupabaseAdminClient().rpc('reserve_conversation_meeting', {
      p_activity_id: input.activityId || randomUUID(),
      p_organization_id: input.organizationId,
      p_channel_connection_id: input.channelConnectionId ?? null,
      p_owner_id: input.ownerId ?? null,
      p_contact_id: input.contactId,
      p_deal_id: input.dealId,
      p_title: `Reuniao Aurora ${fixtures.runId}`,
      p_description: 'Reserva automatica de teste.',
      p_date: input.date,
      p_created_at: new Date().toISOString(),
      p_timezone: input.timezone || 'America/Sao_Paulo',
      p_allow_update: input.allowUpdate ?? false,
    });
  }

  it('bloqueia inicio a menos de 60 minutos e permite exatamente 60 minutos', async () => {
    const baseTimestamp = Date.now() + 7 * 24 * 60 * 60_000;
    const first = await reservation({
      organizationId: fixtures.orgA.organizationId,
      contactId: fixtures.contactA.contactId,
      dealId: fixtures.dealA.dealId,
      date: new Date(baseTimestamp).toISOString(),
    });
    const thirtyMinutesLater = await reservation({
      organizationId: fixtures.orgA.organizationId,
      contactId: fixtures.contactA.contactId,
      dealId: fixtures.dealA.dealId,
      date: new Date(baseTimestamp + 30 * 60_000).toISOString(),
    });
    const sixtyMinutesLater = await reservation({
      organizationId: fixtures.orgA.organizationId,
      contactId: fixtures.contactA.contactId,
      dealId: fixtures.dealA.dealId,
      date: new Date(baseTimestamp + 60 * 60_000).toISOString(),
    });

    expect(first.error).toBeNull();
    expect(first.data).toBe(true);
    expect(thirtyMinutesLater.error).toBeNull();
    expect(thirtyMinutesLater.data).toBe(false);
    expect(sixtyMinutesLater.error).toBeNull();
    expect(sixtyMinutesLater.data).toBe(true);
  });

  it('serializa duas tentativas simultaneas para o mesmo horario', async () => {
    const date = new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString();
    const results = await Promise.all([
      reservation({
        organizationId: fixtures.orgB.organizationId,
        contactId: fixtures.contactB.contactId,
        dealId: fixtures.dealB.dealId,
        date,
      }),
      reservation({
        organizationId: fixtures.orgB.organizationId,
        contactId: fixtures.contactB.contactId,
        dealId: fixtures.dealB.dealId,
        date,
      }),
    ]);

    expect(results.map(result => result.error)).toEqual([null, null]);
    expect(results.map(result => result.data).sort()).toEqual([false, true]);
  });

  it('revalida bloqueio manual dentro da reserva', async () => {
    const target = new Date(Date.now() + 12 * 24 * 60 * 60_000);
    const dateKey = target.toISOString().slice(0, 10);
    const startAt = `${dateKey}T15:00:00.000Z`;
    const block = await getSupabaseAdminClient().from('conversation_calendar_blocks').insert({
      organization_id: fixtures.orgA.organizationId,
      channel_connection_id: channelAId,
      owner_id: ownerAId,
      title: 'Almoco bloqueado no banco',
      kind: 'lunch',
      recurrence: 'once',
      block_date: dateKey,
      weekdays: [],
      start_time: '11:30',
      end_time: '13:00',
      all_day: false,
    });
    expect(block.error).toBeNull();

    const attempted = await reservation({
      organizationId: fixtures.orgA.organizationId,
      contactId: fixtures.contactA.contactId,
      dealId: fixtures.dealA.dealId,
      ownerId: ownerAId,
      channelConnectionId: channelAId,
      date: startAt,
    });

    expect(attempted.error).toBeNull();
    expect(attempted.data).toBe(false);
  });

  it('permite ajuste humano atomico e bloqueia concorrente no novo horario', async () => {
    const activityId = randomUUID();
    const original = new Date(Date.now() + 16 * 24 * 60 * 60_000).toISOString();
    const adjusted = new Date(Date.now() + 17 * 24 * 60 * 60_000).toISOString();
    const initial = await reservation({
      activityId,
      organizationId: fixtures.orgA.organizationId,
      contactId: fixtures.contactA.contactId,
      dealId: fixtures.dealA.dealId,
      ownerId: ownerAId,
      channelConnectionId: channelAId,
      date: original,
    });
    expect(initial.data).toBe(true);

    const moved = await reservation({
      activityId,
      organizationId: fixtures.orgA.organizationId,
      contactId: fixtures.contactA.contactId,
      dealId: fixtures.dealA.dealId,
      ownerId: ownerAId,
      channelConnectionId: channelAId,
      date: adjusted,
      allowUpdate: true,
    });
    const competitor = await reservation({
      organizationId: fixtures.orgA.organizationId,
      contactId: fixtures.contactA.contactId,
      dealId: fixtures.dealA.dealId,
      ownerId: ownerAId,
      channelConnectionId: channelAId,
      date: adjusted,
    });

    expect(moved.error).toBeNull();
    expect(moved.data).toBe(true);
    expect(competitor.error).toBeNull();
    expect(competitor.data).toBe(false);
  });

  it('nao permite executar a reserva com a chave anonima', async () => {
    const anon = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const attempted = await anon.rpc('reserve_conversation_meeting', {
      p_activity_id: randomUUID(),
      p_organization_id: fixtures.orgA.organizationId,
      p_channel_connection_id: channelAId,
      p_owner_id: null,
      p_contact_id: fixtures.contactA.contactId,
      p_deal_id: fixtures.dealA.dealId,
      p_title: 'Nao autorizado',
      p_description: null,
      p_date: new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString(),
      p_created_at: new Date().toISOString(),
      p_timezone: 'America/Sao_Paulo',
      p_allow_update: false,
    });

    expect(attempted.error).not.toBeNull();
  });
});
