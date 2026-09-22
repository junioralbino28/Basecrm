// @vitest-environment node
//
// RLS local das tabelas do Google Agenda (Fatia 1). Nao roda no CI padrao (skipIf);
// exige Supabase local de pe com SUPABASE_TEST_TARGET=local. Escrito para documentar
// e permitir checagem manual, conforme pedido da tarefa (".local.test.ts podem ser
// escritos mas nao precisam rodar").
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { assertNoSupabaseError, getSupabaseAdminClient, requireSupabaseData } from './helpers/supabaseAdmin';
import { getAnonKey, getSupabaseUrl } from './helpers/env';

const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

describeLocal('google_calendar_connections / google_oauth_states — RLS deny-all', () => {
  let runId = '';
  let orgAId = '';
  let userAId = '';
  let userAEmail = '';
  let channelAId = '';
  const password = `Vitest!${randomUUID()}`;

  beforeAll(async () => {
    if (!isLocalSupabase) return;
    const fixtures = await createMinimalFixtures();
    runId = fixtures.runId;
    orgAId = fixtures.orgA.organizationId;

    const admin = getSupabaseAdminClient();
    userAEmail = `google.calendar.${runId}.${randomUUID()}@example.com`;
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
      name: `Google Calendar RLS ${runId}`,
      first_name: 'Aurora',
      organization_id: orgAId,
      role: 'clinic_admin',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' }), 'upsert profile A');

    const channels = requireSupabaseData(await admin.from('channel_connections').insert([
      { organization_id: orgAId, provider: 'evolution', channel_type: 'whatsapp', name: `Canal Google ${runId}` },
    ]).select('id, organization_id'), 'insert channel');
    channelAId = channels[0]?.id || '';
  }, 120_000);

  afterAll(async () => {
    if (!isLocalSupabase) return;
    const admin = getSupabaseAdminClient();
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('authenticated nao le nem escreve em google_calendar_connections', async () => {
    const client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await client.auth.signInWithPassword({ email: userAEmail, password });
    expect(signIn.error).toBeNull();

    const selected = await client.from('google_calendar_connections').select('id');
    expect((selected.data || []).length).toBe(0);

    const inserted = await client.from('google_calendar_connections').insert({
      organization_id: orgAId,
      owner_id: userAId,
      google_account_email: 'ataque@example.com',
      refresh_token_secret_id: null,
      scope: 'x',
    });
    expect(inserted.error).not.toBeNull();
  });

  it('authenticated nao le nem escreve em google_oauth_states', async () => {
    const client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await client.auth.signInWithPassword({ email: userAEmail, password });
    expect(signIn.error).toBeNull();

    const selected = await client.from('google_oauth_states').select('state');
    expect((selected.data || []).length).toBe(0);

    const inserted = await client.from('google_oauth_states').insert({
      organization_id: orgAId,
      channel_connection_id: channelAId,
      owner_id: userAId,
      redirect_origin: 'http://localhost:3000',
    });
    expect(inserted.error).not.toBeNull();
  });

  it('authenticated nao executa as funcoes do Vault', async () => {
    const client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await client.auth.signInWithPassword({ email: userAEmail, password });
    expect(signIn.error).toBeNull();

    const written = await client.rpc('write_google_calendar_refresh_token', {
      p_organization_id: orgAId,
      p_owner_id: userAId,
      p_google_account_email: 'ataque@example.com',
      p_google_calendar_id: 'primary',
      p_refresh_token: 'token-forjado',
      p_scope: 'x',
    });
    expect(written.error).not.toBeNull();

    const read = await client.rpc('read_google_calendar_refresh_token', {
      p_organization_id: orgAId,
      p_owner_id: userAId,
    });
    expect(read.error).not.toBeNull();

    const deleted = await client.rpc('delete_google_calendar_refresh_token', {
      p_organization_id: orgAId,
      p_owner_id: userAId,
    });
    expect(deleted.error).not.toBeNull();
  });

  it('service_role grava, le e apaga o refresh token via Vault (id nunca vaza como texto)', async () => {
    const admin = getSupabaseAdminClient();
    const written = await admin.rpc('write_google_calendar_refresh_token', {
      p_organization_id: orgAId,
      p_owner_id: userAId,
      p_google_account_email: 'responsavel@example.com',
      p_google_calendar_id: 'primary',
      p_refresh_token: 'refresh-token-de-teste',
      p_scope: 'https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events',
    });
    expect(written.error).toBeNull();
    expect(written.data?.status).toBe('connected');

    const read = await admin.rpc('read_google_calendar_refresh_token', {
      p_organization_id: orgAId,
      p_owner_id: userAId,
    });
    expect(read.error).toBeNull();
    expect(read.data).toBe('refresh-token-de-teste');

    const row = await admin
      .from('google_calendar_connections')
      .select('refresh_token_secret_id, status')
      .eq('organization_id', orgAId)
      .eq('owner_id', userAId)
      .maybeSingle();
    expect(row.data?.refresh_token_secret_id).toBeTruthy();

    const deleted = await admin.rpc('delete_google_calendar_refresh_token', {
      p_organization_id: orgAId,
      p_owner_id: userAId,
    });
    expect(deleted.error).toBeNull();
    expect(deleted.data).toBe(true);

    const afterDelete = await admin
      .from('google_calendar_connections')
      .select('refresh_token_secret_id, status')
      .eq('organization_id', orgAId)
      .eq('owner_id', userAId)
      .maybeSingle();
    expect(afterDelete.data?.status).toBe('revoked');
    expect(afterDelete.data?.refresh_token_secret_id).toBeNull();

    const readAfterDelete = await admin.rpc('read_google_calendar_refresh_token', {
      p_organization_id: orgAId,
      p_owner_id: userAId,
    });
    expect(readAfterDelete.error).toBeNull();
    expect(readAfterDelete.data).toBeNull();
  });
});
