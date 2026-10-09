// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { assertNoSupabaseError, getSupabaseAdminClient, requireSupabaseData } from './helpers/supabaseAdmin';
import { getAnonKey, getSupabaseUrl } from './helpers/env';

/**
 * Renomear e excluir agente (SPEC-renomear-excluir.md, v2.1): as duas funções chamadas de verdade no Supabase local,
 * com o JWT da agência (sem a rota). Cada caso diz o que prova.
 */
const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

/** Postgres do `supabase start`. Constante de propósito: o teste nunca abre sessão fora do local. */
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

function exigirPostgresLocal() {
  const alvo = new URL(DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(alvo.hostname) || alvo.port !== '54322' || alvo.pathname !== '/postgres') {
    throw new Error('RECUSADO: o teste so abre sessao no Postgres local (127.0.0.1:54322).');
  }
}

type Papel = 'agency_admin' | 'agency_staff' | 'clinic_admin';
type Erro = { message?: string; code?: string } | null;
type Estado = { name: string; draft_revision: number; published_version_id: string | null };

describeLocal('Central de Agentes, renomear e excluir agente — Supabase local', () => {
  let runId = '';
  let orgA = '';
  let orgB = '';
  let orgApagada = '';
  let idAgencia = '';
  let agencia: SupabaseClient;
  let staff: SupabaseClient;
  let cliente: SupabaseClient;
  const usuarios: string[] = [];
  const modelos: string[] = [];
  const senha = `Vitest!${randomUUID()}`;

  async function criarUsuario(role: Papel, organizationId: string) {
    const admin = getSupabaseAdminClient();
    const email = `renomear.${role}.${runId}.${randomUUID()}@example.com`;
    const criado = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { role, organization_id: organizationId },
    });
    if (criado.error || !criado.data.user?.id) throw new Error(`Falha ao criar ${role}: ${criado.error?.message}`);
    usuarios.push(criado.data.user.id);
    assertNoSupabaseError(await admin.from('profiles').upsert({
      id: criado.data.user.id,
      email,
      name: `Renomear ${role} ${runId}`,
      first_name: 'Renomear',
      organization_id: organizationId,
      role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' }), `upsert profile ${role}`);
    return { email, id: criado.data.user.id };
  }

  async function entrar(email: string) {
    const c = createClient(getSupabaseUrl(), getAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await c.auth.signInWithPassword({ email, password: senha });
    expect(login.error).toBeNull();
    return c;
  }

  async function sessaoPg() {
    exigirPostgresLocal();
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    return c;
  }

  /** Dentro de uma transação aberta: dali em diante a sessão é a agência (papel authenticated e o JWT dela). */
  async function virarAgencia(c: Client) {
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: idAgencia, role: 'authenticated' })]);
  }

  /**
   * Espera alguma sessão cuja consulta contém `trecho` ficar bloqueada pela sessão `pidDaDona`. Quem observa é uma
   * sessão com o papel do banco: o papel authenticated não enxerga a consulta das outras sessões.
   */
  async function esperarBloqueadoPor(observador: Client, pidDaDona: number, trecho: string) {
    const limite = Date.now() + 5000;
    for (;;) {
      await observador.query('select pg_stat_clear_snapshot()');
      const bloqueadas = await observador.query(
        // pg_blocking_pids lê as travas ao vivo; wait_event_type vem da foto de pg_stat_activity. Sem exigir os dois, a
        // sessão aparece bloqueada com a foto ainda sem a espera: era a falha rara do 6a (achada no 10/10, com a
        // mensagem que a asserção passou a guardar), uma corrida da observação, não da exclusão.
        "select a.pid, a.wait_event_type from pg_stat_activity a where $2 = any(pg_blocking_pids(a.pid)) and a.wait_event_type = 'Lock' and a.query like $1",
        [`%${trecho}%`, pidDaDona],
      );
      if (bloqueadas.rows.length > 0) return bloqueadas.rows[0] as { pid: number; wait_event_type: string };
      if (Date.now() > limite) throw new Error(`nenhuma sessao com ${trecho} ficou esperando a trava em 5 s`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Agente com a v1 publicada, como a migração cria. */
  async function agentePublicado(organizationId: string, nome = 'Para excluir') {
    const prompt = `Texto do agente ${randomUUID()}`;
    const criado = await getSupabaseAdminClient().rpc('create_ai_agent_from_legacy_prompt', {
      p_organization_id: organizationId,
      p_name: nome,
      p_prompt: prompt,
      p_origin: { sha256: sha256(prompt), promptKey: 'task_conversations_whatsapp_auto_reply', promptSource: 'default' },
    });
    expect(criado.error).toBeNull();
    return (criado.data as Array<{ out_agent_id: string }>)[0].out_agent_id;
  }

  async function estado(id: string): Promise<Estado> {
    const r = await getSupabaseAdminClient().from('ai_agents').select('name, draft_revision, published_version_id').eq('id', id).single();
    expect(r.error).toBeNull();
    return r.data as Estado;
  }

  async function existe(id: string) {
    const r = await getSupabaseAdminClient().from('ai_agents').select('id', { count: 'exact', head: true }).eq('id', id);
    return r.count;
  }

  async function registros(id: string) {
    const r = await getSupabaseAdminClient().from('ai_agent_deletions').select('*').eq('agent_id', id);
    expect(r.error).toBeNull();
    return r.data as Array<Record<string, unknown>>;
  }

  async function salvarRascunho(org: string, agente: string, revisao: number, prompt: string) {
    const r = await agencia.rpc('save_ai_agent_draft', { p_organization_id: org, p_agent_id: agente, p_expected_revision: revisao, p_prompt: prompt });
    expect(r.error).toBeNull();
    return r.data as number;
  }

  async function publicar(org: string, agente: string, versaoAtual: number, revisao: number) {
    const r = await agencia.rpc('publish_ai_agent_version', {
      p_organization_id: org, p_agent_id: agente, p_expected_version: versaoAtual, p_expected_revision: revisao, p_note: null,
    });
    expect(r.error).toBeNull();
  }

  async function novaConexao(organizationId: string) {
    return requireSupabaseData(await getSupabaseAdminClient()
      .from('channel_connections')
      .insert({ organization_id: organizationId, provider: 'evolution', channel_type: 'whatsapp', name: `Numero ${randomUUID()} ${runId}`, config: {} })
      .select('id')
      .single(), 'insert conexao').id as string;
  }

  const excluir = (c: SupabaseClient, org: string, agente: string, e: Estado) =>
    c.rpc('delete_ai_agent', {
      p_organization_id: org,
      p_agent_id: agente,
      p_expected_name: e.name,
      p_expected_draft_revision: e.draft_revision,
      p_expected_published_version_id: e.published_version_id,
    });
  const renomear = (c: SupabaseClient, org: string, agente: string, nome: string) =>
    c.rpc('rename_ai_agent', { p_organization_id: org, p_agent_id: agente, p_name: nome });
  const nomeDoErro = (e: Erro) => e?.message ?? null;

  beforeAll(async () => {
    const fixtures = await createMinimalFixtures();
    runId = fixtures.runId;
    orgA = fixtures.orgA.organizationId;
    orgB = fixtures.orgB.organizationId;
    const admin = getSupabaseAdminClient();
    const org = await admin.from('organizations').insert({ name: `Apagada ${runId}`, deleted_at: new Date().toISOString() }).select('id').single();
    expect(org.error).toBeNull();
    orgApagada = (org.data as { id: string }).id;
    const criado = await criarUsuario('agency_admin', orgA);
    idAgencia = criado.id;
    agencia = await entrar(criado.email);
    staff = await entrar((await criarUsuario('agency_staff', orgA)).email);
    cliente = await entrar((await criarUsuario('clinic_admin', orgA)).email);
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    if (modelos.length > 0) await admin.from('ai_agent_templates').delete().in('id', modelos);
    if (orgApagada) await admin.from('organizations').delete().eq('id', orgApagada);
    for (const id of usuarios) await admin.auth.admin.deleteUser(id);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('1. renomear: apara, recusa nome inválido, agente de outro cliente, cliente apagado e quem não é agência', async () => {
    const agente = await agentePublicado(orgA, 'Nome antigo');
    const r = await renomear(agencia, orgA, agente, '  Nome novo  ');
    expect(r.error).toBeNull();
    expect(r.data).toBe('Nome novo');
    expect((await estado(agente)).name).toBe('Nome novo');
    expect(nomeDoErro((await renomear(agencia, orgA, agente, '   ')).error)).toBe('nome_invalido');
    expect(nomeDoErro((await renomear(agencia, orgA, agente, 'x'.repeat(81))).error)).toBe('nome_invalido');
    expect(nomeDoErro((await renomear(agencia, orgB, agente, 'Outro')).error)).toBe('agente_inexistente');
    expect(nomeDoErro((await renomear(agencia, orgApagada, agente, 'Outro')).error)).toBe('cliente_inexistente');
    for (const c of [staff, cliente]) {
      const negado = await renomear(c, orgA, agente, 'Invasor');
      expect(nomeDoErro(negado.error)).toBe('sem_permissao');
      expect(negado.error?.code).toBe('42501');
    }
    expect((await estado(agente)).name).toBe('Nome novo');
  });

  it('2. excluir pela RPC direta: o agente e as versões somem, o registro fica, e o modelo e a mensagem continuam', async () => {
    const admin = getSupabaseAdminClient();
    const agente = await agentePublicado(orgA, 'Vai sair');
    // Segunda versão publicada pela agência.
    const e1 = await estado(agente);
    const rev = await salvarRascunho(orgA, agente, e1.draft_revision, `Texto novo ${randomUUID()}`);
    await publicar(orgA, agente, 1, rev);
    // Um modelo salvo dele e uma mensagem com o rastro do agente.
    const modelo = await agencia.rpc('create_ai_agent_template_from_agent', {
      p_organization_id: orgA, p_agent_id: agente, p_expected_version: 2, p_name: `Modelo ${runId}`, p_description: null,
    });
    expect(modelo.error).toBeNull();
    const idModelo = modelo.data as string;
    expect(idModelo).toMatch(/^[0-9a-f-]{36}$/);
    modelos.push(idModelo);
    const conversa = requireSupabaseData(await admin.from('conversation_threads')
      .insert({ organization_id: orgA, channel_connection_id: null, title: `Conversa ${randomUUID()} ${runId}` })
      .select('id').single(), 'insert conversa').id as string;
    const mensagem = requireSupabaseData(await admin.from('conversation_messages').insert({
      thread_id: conversa, organization_id: orgA, direction: 'outbound', content: 'resposta do agente',
      sent_at: new Date().toISOString(), delivery_status: 'sent', metadata: { agent_id: agente, agent_version: 2 },
    }).select('id').single(), 'insert mensagem').id as string;

    const antes = await estado(agente);
    const r = await excluir(agencia, orgA, agente, antes);
    expect(r.error).toBeNull();
    expect(r.data).toBe(2);
    expect(await existe(agente)).toBe(0);
    const versoes = await admin.from('ai_agent_versions').select('id', { count: 'exact', head: true }).eq('agent_id', agente);
    expect(versoes.count).toBe(0);
    const reg = await registros(agente);
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({
      organization_id: orgA, agent_name: 'Vai sair', draft_revision: antes.draft_revision,
      published_version_id: antes.published_version_id, versions_deleted: 2, deleted_by: idAgencia,
    });
    const m = await admin.from('ai_agent_templates').select('origin').eq('id', idModelo).single();
    expect((m.data as { origin: { agentId: string } }).origin.agentId).toBe(agente);
    const msg = await admin.from('conversation_messages').select('metadata').eq('id', mensagem).single();
    expect((msg.data as { metadata: { agent_id: string } }).metadata.agent_id).toBe(agente);
  });

  it('3. estado desatualizado: rascunho salvo, versão publicada ou nome trocado depois da leitura = agente_mudou, nada apagado', async () => {
    const casos: Array<[string, (agente: string, e: Estado) => Promise<void>]> = [
      ['rascunho salvo', async (agente, e) => { await salvarRascunho(orgA, agente, e.draft_revision, `Outro ${randomUUID()}`); }],
      ['versao publicada', async (agente, e) => {
        const rev = await salvarRascunho(orgA, agente, e.draft_revision, `Outro ${randomUUID()}`);
        await publicar(orgA, agente, 1, rev);
      }],
      ['nome trocado', async (agente) => { expect((await renomear(agencia, orgA, agente, 'Renomeado no meio')).error).toBeNull(); }],
    ];
    for (const [caso, mudar] of casos) {
      const agente = await agentePublicado(orgA, 'Desatualizado');
      const lido = await estado(agente);
      await mudar(agente, lido);
      const r = await excluir(agencia, orgA, agente, lido);
      expect(nomeDoErro(r.error), caso).toBe('agente_mudou');
      expect(await existe(agente), caso).toBe(1);
      expect(await registros(agente), caso).toHaveLength(0);
      // Com o estado novo, a exclusão passa.
      expect((await excluir(agencia, orgA, agente, await estado(agente))).error, caso).toBeNull();
    }
  });

  it('4. com número ligado: agente_com_numero, o agente continua e não há registro', async () => {
    const agente = await agentePublicado(orgA, 'Com numero');
    const conexao = await novaConexao(orgA);
    assertNoSupabaseError(await getSupabaseAdminClient().from('channel_connections').update({ ai_agent_id: agente }).eq('id', conexao), 'ligar');
    const r = await excluir(agencia, orgA, agente, await estado(agente));
    expect(nomeDoErro(r.error)).toBe('agente_com_numero');
    expect(await existe(agente)).toBe(1);
    expect(await registros(agente)).toHaveLength(0);
    assertNoSupabaseError(await getSupabaseAdminClient().from('channel_connections').update({ ai_agent_id: null }).eq('id', conexao), 'desligar');
  });

  it('5. registro que falha: a exclusão falha junto e o agente continua (os dois são uma coisa só)', async () => {
    const agente = await agentePublicado(orgA, 'Registro recusado');
    const e = await estado(agente);
    const sufixo = randomUUID().replace(/-/g, '').slice(0, 12);
    const c = await sessaoPg();
    try {
      await c.query('begin');
      await c.query(`create function public.teste_recusa_registro_${sufixo}() returns trigger language plpgsql as $f$ begin raise exception 'registro recusado pelo teste'; end; $f$`);
      await c.query(`create trigger teste_recusa_${sufixo} before insert on public.ai_agent_deletions for each row execute function public.teste_recusa_registro_${sufixo}()`);
      await c.query('savepoint antes');
      await virarAgencia(c);
      let erro: Error | null = null;
      try {
        await c.query('select public.delete_ai_agent($1, $2, $3, $4, $5)', [orgA, agente, e.name, e.draft_revision, e.published_version_id]);
      } catch (x) {
        erro = x as Error;
      }
      expect(erro?.message).toBe('registro recusado pelo teste');
      await c.query('rollback to savepoint antes');
      const dentro = await c.query('select count(*)::int as n from public.ai_agents where id = $1', [agente]);
      expect(dentro.rows[0].n).toBe(1);
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.end();
    }
    expect(await existe(agente)).toBe(1);
    expect(await registros(agente)).toHaveLength(0);
  });

  it('6a. ligar primeiro: a exclusão espera no FOR UPDATE e, com o commit da ligação, recusa pela contagem', async () => {
    const agente = await agentePublicado(orgA, 'Corrida ligar primeiro');
    const e = await estado(agente);
    const conexao = await novaConexao(orgA);
    const t1 = await sessaoPg();
    try {
      const pidT1 = (await t1.query('select pg_backend_pid() as pid')).rows[0].pid as number;
      await t1.query('begin');
      await t1.query('update public.channel_connections set ai_agent_id = $1 where id = $2', [agente, conexao]);
      const pedido = excluir(agencia, orgA, agente, e).then((r) => r);
      const espera = await esperarBloqueadoPor(t1, pidT1, 'delete_ai_agent');
      expect(espera.wait_event_type).toBe('Lock');
      await t1.query('commit');
      const r = await pedido;
      // Se a recusa vier diferente, o erro inteiro vai junto na mensagem.
      expect(nomeDoErro(r.error), JSON.stringify(r.error)).toBe('agente_com_numero');
    } finally {
      await t1.query('rollback').catch(() => undefined);
      await t1.end();
    }
    expect(await existe(agente)).toBe(1);
    expect(await registros(agente)).toHaveLength(0);
    assertNoSupabaseError(await getSupabaseAdminClient().from('channel_connections').update({ ai_agent_id: null }).eq('id', conexao), 'desligar');
  });

  it('6b. excluir primeiro: a ligação espera e, com o commit da exclusão, falha do lado dela', async () => {
    const agente = await agentePublicado(orgA, 'Corrida excluir primeiro');
    const e = await estado(agente);
    const conexao = await novaConexao(orgA);
    const t2 = await sessaoPg();
    const t1 = await sessaoPg();
    const observador = await sessaoPg();
    try {
      const pidT2 = (await t2.query('select pg_backend_pid() as pid')).rows[0].pid as number;
      await t2.query('begin');
      await virarAgencia(t2);
      const r = await t2.query('select public.delete_ai_agent($1, $2, $3, $4, $5) as versoes', [orgA, agente, e.name, e.draft_revision, e.published_version_id]);
      expect(r.rows[0].versoes).toBe(1);
      const ligacao = t1.query('update public.channel_connections set ai_agent_id = $1 where id = $2', [agente, conexao]).then(
        () => null,
        (x: { code?: string }) => x,
      );
      const espera = await esperarBloqueadoPor(observador, pidT2, 'update public.channel_connections');
      expect(espera.wait_event_type).toBe('Lock');
      await t2.query('commit');
      const falha = await ligacao;
      expect(falha?.code).toBe('23503');
    } finally {
      await t2.query('rollback').catch(() => undefined);
      await t2.end();
      await t1.end();
      await observador.end();
    }
    expect(await existe(agente)).toBe(0);
    const c = await getSupabaseAdminClient().from('channel_connections').select('ai_agent_id').eq('id', conexao).single();
    expect((c.data as { ai_agent_id: string | null }).ai_agent_id).toBeNull();
    expect(await registros(agente)).toHaveLength(1);
  });

  it('7. excluir: agente de outro cliente, cliente apagado e quem não é agência', async () => {
    const agente = await agentePublicado(orgA, 'Protegido');
    const e = await estado(agente);
    expect(nomeDoErro((await excluir(agencia, orgB, agente, e)).error)).toBe('agente_inexistente');
    expect(nomeDoErro((await excluir(agencia, orgApagada, agente, e)).error)).toBe('cliente_inexistente');
    for (const c of [staff, cliente]) {
      const negado = await excluir(c, orgA, agente, e);
      expect(nomeDoErro(negado.error)).toBe('sem_permissao');
      expect(negado.error?.code).toBe('42501');
    }
    expect(await existe(agente)).toBe(1);
  });

  it('9. agente só em rascunho (sem versão publicada): sai com zero versões e um registro com a publicada nula', async () => {
    const criado = await agencia.rpc('create_ai_agent_blank', { p_organization_id: orgA, p_name: 'So rascunho', p_prompt: `Texto ${randomUUID()}` });
    expect(criado.error).toBeNull();
    const agente = criado.data as string;
    const e = await estado(agente);
    expect(e.published_version_id).toBeNull();
    const r = await excluir(agencia, orgA, agente, e);
    expect(r.error).toBeNull();
    expect(r.data).toBe(0);
    expect(await existe(agente)).toBe(0);
    const reg = await registros(agente);
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ agent_name: 'So rascunho', published_version_id: null, versions_deleted: 0, deleted_by: idAgencia });
  });

  it('9b. lido sem versão publicada e publicado pela primeira vez antes de confirmar: agente_mudou (o nulo conta)', async () => {
    const criado = await agencia.rpc('create_ai_agent_blank', { p_organization_id: orgA, p_name: 'Primeira publicacao', p_prompt: `Texto ${randomUUID()}` });
    expect(criado.error).toBeNull();
    const agente = criado.data as string;
    const lido = await estado(agente);
    expect(lido.published_version_id).toBeNull();
    await publicar(orgA, agente, 0, lido.draft_revision);
    expect((await estado(agente)).published_version_id).not.toBeNull();
    const r = await excluir(agencia, orgA, agente, lido);
    expect(nomeDoErro(r.error)).toBe('agente_mudou');
    expect(await existe(agente)).toBe(1);
    expect(await registros(agente)).toHaveLength(0);
  });

  it('8. catálogo: só as versões e o número apontam para ai_agents por FK (histórico e mensagens ficam)', async () => {
    const c = await sessaoPg();
    try {
      const r = await c.query("select conrelid::regclass::text as tabela from pg_constraint where contype = 'f' and confrelid = 'public.ai_agents'::regclass order by 1");
      expect(r.rows.map((l: { tabela: string }) => l.tabela)).toEqual(['ai_agent_versions', 'channel_connections']);
    } finally {
      await c.end();
    }
  });
});
