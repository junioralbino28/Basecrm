import { randomUUID } from 'node:crypto';
import { getRunId } from './runId';
import { assertNoSupabaseError, getSupabaseAdminClient, requireSupabaseData } from './supabaseAdmin';

export type TestOrg = {
  organizationId: string;
  name: string;
};

export type TestBoard = {
  boardId: string;
};

export type TestContact = {
  contactId: string;
  email: string;
  name: string;
};

export type TestDeal = {
  dealId: string;
};

export type TestFixtureBundle = {
  runId: string;
  orgA: TestOrg;
  orgB: TestOrg;
  boardA: TestBoard;
  boardB: TestBoard;
  contactA: TestContact;
  contactB: TestContact;
  dealA: TestDeal;
  dealB: TestDeal;
};

async function ensureOrganization(name: string): Promise<TestOrg> {
  const supabase = getSupabaseAdminClient();

  const insert = await supabase
    .from('organizations')
    .insert({ name })
    .select('id, name')
    .single();

  const row = requireSupabaseData(insert, 'insert organizations');
  return { organizationId: row.id, name: row.name };
}

async function createBoard(params: {
  organizationId: string;
  name: string;
}): Promise<TestBoard> {
  const supabase = getSupabaseAdminClient();

  const res = await supabase
    .from('boards')
    .insert({
      organization_id: params.organizationId,
      name: params.name,
      is_default: false,
    })
    .select('id')
    .single();

  const row = requireSupabaseData(res, 'insert boards');
  return { boardId: row.id };
}

async function createBoardStages(params: {
  organizationId: string;
  boardId: string;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();

  // minimal stages so tools that expect stages don't break
  const res = await supabase.from('board_stages').insert([
    {
      organization_id: params.organizationId,
      board_id: params.boardId,
      name: 'Novo',
      color: '#3b82f6',
      order: 0,
    },
    {
      organization_id: params.organizationId,
      board_id: params.boardId,
      name: 'Proposta',
      color: '#a855f7',
      order: 1,
    },
    {
      organization_id: params.organizationId,
      board_id: params.boardId,
      name: 'Ganho',
      color: '#22c55e',
      order: 2,
    },
    {
      organization_id: params.organizationId,
      board_id: params.boardId,
      name: 'Perdido',
      color: '#ef4444',
      order: 3,
    },
  ]);

  assertNoSupabaseError(res, 'insert board_stages');
}

async function createContact(params: {
  organizationId: string;
  name: string;
  email: string;
}): Promise<TestContact> {
  const supabase = getSupabaseAdminClient();

  const res = await supabase
    .from('contacts')
    .insert({
      organization_id: params.organizationId,
      name: params.name,
      email: params.email,
    })
    .select('id, name, email')
    .single();

  const row = requireSupabaseData(res, 'insert contacts');
  return { contactId: row.id, name: row.name, email: row.email };
}

async function createDeal(params: {
  organizationId: string;
  boardId: string;
  contactId: string;
  title: string;
}): Promise<TestDeal> {
  const supabase = getSupabaseAdminClient();

  // pick first stage
  const stageRes = await supabase
    .from('board_stages')
    .select('id')
    .eq('organization_id', params.organizationId)
    .eq('board_id', params.boardId)
    .order('order', { ascending: true })
    .limit(1)
    .maybeSingle();

  const stage = requireSupabaseData(stageRes, 'select board_stages');
  if (!stage?.id) throw new Error('Fixture error: no stage found for board');

  const res = await supabase
    .from('deals')
    .insert({
      organization_id: params.organizationId,
      board_id: params.boardId,
      stage_id: stage.id,
      contact_id: params.contactId,
      title: params.title,
      value: 1000,
      status: 'open',
    })
    .select('id')
    .single();

  const row = requireSupabaseData(res, 'insert deals');
  return { dealId: row.id };
}

/**
 * Função pública `createMinimalFixtures` do projeto.
 * @returns {Promise<TestFixtureBundle>} Retorna um valor do tipo `Promise<TestFixtureBundle>`.
 */
export async function createMinimalFixtures(): Promise<TestFixtureBundle> {
  const runId = getRunId('next-ai');

  const orgA = await ensureOrganization(`Vitest Org A ${runId}`);
  const orgB = await ensureOrganization(`Vitest Org B ${runId}`);

  const boardA = await createBoard({
    organizationId: orgA.organizationId,
    name: `Board A ${runId}`,
  });
  const boardB = await createBoard({
    organizationId: orgB.organizationId,
    name: `Board B ${runId}`,
  });

  await createBoardStages({ organizationId: orgA.organizationId, boardId: boardA.boardId });
  await createBoardStages({ organizationId: orgB.organizationId, boardId: boardB.boardId });

  const contactA = await createContact({
    organizationId: orgA.organizationId,
    name: `Contato A ${runId}`,
    email: `a.${runId}.${randomUUID()}@example.com`,
  });
  const contactB = await createContact({
    organizationId: orgB.organizationId,
    name: `Contato B ${runId}`,
    email: `b.${runId}.${randomUUID()}@example.com`,
  });

  const dealA = await createDeal({
    organizationId: orgA.organizationId,
    boardId: boardA.boardId,
    contactId: contactA.contactId,
    title: `Deal A ${runId}`,
  });
  const dealB = await createDeal({
    organizationId: orgB.organizationId,
    boardId: boardB.boardId,
    contactId: contactB.contactId,
    title: `Deal B ${runId}`,
  });

  return {
    runId,
    orgA,
    orgB,
    boardA,
    boardB,
    contactA,
    contactB,
    dealA,
    dealB,
  };
}

/**
 * Função pública `cleanupFixtures` do projeto.
 *
 * @param {string} runId - Identificador do recurso.
 * @returns {Promise<void>} Retorna uma Promise resolvida sem valor.
 */
export async function cleanupFixtures(runId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();

  // We created org names with runId; easiest deterministic cleanup is:
  // - find org ids by name match, then delete dependent records by org id.
  const orgsRes = await supabase
    .from('organizations')
    .select('id, name')
    .ilike('name', `%${runId}%`);
  const orgs = requireSupabaseData(orgsRes, 'select organizations for cleanup');

  for (const org of orgs) {
    const organizationId = org.id;

    // Order matters due to FK constraints.
    assertNoSupabaseError(
      await supabase.from('conversation_calendar_blocks').delete().eq('organization_id', organizationId),
      'delete conversation calendar blocks',
    );
    assertNoSupabaseError(
      await supabase.from('activities').delete().eq('organization_id', organizationId),
      'delete activities',
    );
    assertNoSupabaseError(
      await supabase.from('deal_items').delete().eq('organization_id', organizationId),
      'delete deal_items',
    );
    assertNoSupabaseError(
      await supabase.from('deals').delete().eq('organization_id', organizationId),
      'delete deals',
    );
    assertNoSupabaseError(
      await supabase.from('contacts').delete().eq('organization_id', organizationId),
      'delete contacts',
    );
    assertNoSupabaseError(
      await supabase.from('board_stages').delete().eq('organization_id', organizationId),
      'delete board_stages',
    );
    assertNoSupabaseError(
      await supabase.from('boards').delete().eq('organization_id', organizationId),
      'delete boards',
    );

    // Settings + profiles might exist depending on triggers/tests.
    assertNoSupabaseError(
      await supabase.from('organization_settings').delete().eq('organization_id', organizationId),
      'delete organization_settings',
    );
    assertNoSupabaseError(
      await supabase.from('profiles').delete().eq('organization_id', organizationId),
      'delete profiles',
    );

    assertNoSupabaseError(
      await supabase.from('organizations').delete().eq('id', organizationId),
      'delete organizations',
    );
  }
}
