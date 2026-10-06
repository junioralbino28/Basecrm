// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { assertNoSupabaseError, getSupabaseAdminClient, requireSupabaseData } from './helpers/supabaseAdmin';
import { getAnonKey, getSupabaseUrl } from './helpers/env';

const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

/**
 * Postgres do `supabase start` (supabase/config.toml, [db] port). Constante de propósito, sem variável de
 * ambiente: o runner repassa o ambiente inteiro, e uma URL remota nele nunca pode fazer este teste abrir
 * sessão fora do local (3ª rodada do Codex, achado 2).
 */
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');
const PROMPT = 'Voce e a Aurora. {{contactName}}\n{{recentMessagesText}}';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
/** Commit da publicação que "respondeu" (VERCEL_GIT_COMMIT_SHA): 40 hex. */
const PUBLICACAO = 'a'.repeat(40);
/** Deployment que "respondeu" (VERCEL_DEPLOYMENT_ID). */
const DEPLOYMENT = 'dpl_ensaio1';

function exigirPostgresLocal() {
  const alvo = new URL(DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(alvo.hostname) || alvo.port !== '54322' || alvo.pathname !== '/postgres') {
    throw new Error('RECUSADO: as corridas so abrem sessao no Postgres local (127.0.0.1:54322).');
  }
}

type Papel = 'agency_admin' | 'agency_staff' | 'admin' | 'clinic_admin';

describeLocal('Central de Agentes, fundação — Supabase local', () => {
  let runId = '';
  let orgA = '';
  let orgB = '';
  let conexaoA = '';
  let agenteA = '';
  let agenteB = '';
  const usuarios: string[] = [];
  const emails: Partial<Record<'agencia' | 'staff' | 'legado' | 'clienteA' | 'clienteB', string>> = {};
  const senha = `Vitest!${randomUUID()}`;

  async function criarUsuario(role: Papel, organizationId: string) {
    const admin = getSupabaseAdminClient();
    const email = `central.${role}.${runId}.${randomUUID()}@example.com`;
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
      name: `Central ${role} ${runId}`,
      first_name: 'Central',
      organization_id: organizationId,
      role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' }), `upsert profile ${role}`);
    return email;
  }

  async function entrar(email: string) {
    const client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await client.auth.signInWithPassword({ email, password: senha });
    expect(login.error).toBeNull();
    return client;
  }

  async function criarAgente(organizationId: string, prompt = PROMPT) {
    return getSupabaseAdminClient().rpc('create_ai_agent_from_legacy_prompt', {
      p_organization_id: organizationId,
      p_name: 'Aurora',
      p_prompt: prompt,
      p_origin: { sha256: sha256(prompt), promptKey: AURORA, promptSource: 'default' },
    });
  }

  async function novaConexao(nome: string, config: Record<string, unknown> = {}, organizationId = orgA) {
    const admin = getSupabaseAdminClient();
    return requireSupabaseData(await admin
      .from('channel_connections')
      .insert({ organization_id: organizationId, provider: 'evolution', channel_type: 'whatsapp', name: `${nome} ${runId}`, config })
      .select('id')
      .single(), `insert conexao ${nome}`).id as string;
  }

  async function novaConversa(conexao: string | null, organizationId = orgA) {
    const admin = getSupabaseAdminClient();
    return requireSupabaseData(await admin
      .from('conversation_threads')
      .insert({ organization_id: organizationId, channel_connection_id: conexao, title: `Conversa ${randomUUID()} ${runId}` })
      .select('id')
      .single(), 'insert conversa').id as string;
  }

  /** Evento de prova como o caminho nativo grava (lib/conversations/aiReplyEvents.ts). */
  function evento(conexao: string, conversa: string, sha: string, deliveredAt: string, extra: Record<string, unknown> = {}) {
    return {
      organization_id: orgA,
      channel_connection_id: conexao,
      thread_id: conversa,
      prompt_sha256: sha,
      prompt_key: AURORA,
      prompt_source: 'default',
      agent_id: null,
      agent_version: null,
      release_commit: PUBLICACAO,
      release_deployment: DEPLOYMENT,
      delivered_at: deliveredAt,
      ...extra,
    };
  }

  /** Número com uma resposta entregue que CONFERE com `texto`, pronto para ligar. */
  async function numeroProvado(nome: string, texto: string) {
    const admin = getSupabaseAdminClient();
    const conexao = await novaConexao(nome, { aiPromptKey: AURORA });
    const conversa = await novaConversa(conexao);
    assertNoSupabaseError(await admin.from('ai_reply_events').insert(evento(conexao, conversa, sha256(texto), '2026-09-29T11:00:00Z')), `evento ${nome}`);
    return { conexao, conversa };
  }

  function ligar(conexao: string, agente: string, sha: string, troca: Record<string, unknown> = {}) {
    return getSupabaseAdminClient().rpc('central_agentes_ligar_conexao', {
      p_connection_id: conexao,
      p_agent_id: agente,
      p_chave_bruta: AURORA,
      p_prompt_key: AURORA,
      p_prompt_source: 'default',
      p_sha256: sha,
      p_publicacao: PUBLICACAO,
      p_deployment: DEPLOYMENT,
      ...troca,
    });
  }

  async function sessaoPg() {
    exigirPostgresLocal();
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    return client;
  }

  /**
   * Espera até outra sessão estar BLOQUEADA por `dona` (pg_blocking_pids) e devolve as travas que ela está
   * pedindo e ainda não ganhou. Prova que a chamada concorrente chegou ao banco e está esperando aquela
   * trava; não basta ela demorar. Roda na própria sessão que segura a transação.
   */
  async function esperarBloqueadoPor(dona: Client) {
    const limite = Date.now() + 5000;
    for (;;) {
      const bloqueadas = await dona.query('select a.pid from pg_stat_activity a where pg_backend_pid() = any(pg_blocking_pids(a.pid))');
      if (bloqueadas.rows.length > 0) {
        const pids = bloqueadas.rows.map((linha) => linha.pid as number);
        const travas = await dona.query(
          "select l.locktype, l.mode, coalesce(l.relation::regclass::text, '') as relacao from pg_locks l where not l.granted and l.pid = any($1::int[])",
          [pids],
        );
        return travas.rows as Array<{ locktype: string; mode: string; relacao: string }>;
      }
      if (Date.now() > limite) throw new Error('nenhuma sessao ficou esperando a trava em 5 s: a chamada concorrente nao travou');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    const fixtures = await createMinimalFixtures();
    runId = fixtures.runId;
    orgA = fixtures.orgA.organizationId;
    orgB = fixtures.orgB.organizationId;
    conexaoA = await novaConexao('Central', { aiEnabled: false });
    emails.agencia = await criarUsuario('agency_admin', orgA);
    emails.staff = await criarUsuario('agency_staff', orgA);
    emails.legado = await criarUsuario('admin', orgA);
    emails.clienteA = await criarUsuario('clinic_admin', orgA);
    emails.clienteB = await criarUsuario('clinic_admin', orgB);
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    for (const id of usuarios) await admin.auth.admin.deleteUser(id);
    // A limpeza apaga as organizações; com agente, número e evento nelas, ela também exercita a cascata.
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('cria o agente com a v1 publicada e é idempotente pelo sha256', async () => {
    const primeira = await criarAgente(orgA);
    expect(primeira.error).toBeNull();
    const [linha] = primeira.data as Array<{ out_agent_id: string; out_version_id: string; out_created: boolean }>;
    expect(linha.out_created).toBe(true);
    agenteA = linha.out_agent_id;

    const segunda = await criarAgente(orgA);
    const [repetida] = segunda.data as Array<{ out_agent_id: string; out_created: boolean }>;
    expect(repetida).toMatchObject({ out_agent_id: agenteA, out_created: false });

    const admin = getSupabaseAdminClient();
    const versao = await admin.from('ai_agent_versions').select('version, prompt, settings, model, source').eq('agent_id', agenteA);
    expect(versao.error).toBeNull();
    expect(versao.data).toEqual([{ version: 1, prompt: PROMPT, settings: {}, model: null, source: 'migration' }]);

    const agente = await admin.from('ai_agents').select('draft_revision, published_version_id').eq('id', agenteA).single();
    expect(agente.data).toEqual({ draft_revision: 0, published_version_id: linha.out_version_id });
  });

  it('recusa origem cujo sha256 não é o do prompt', async () => {
    const resultado = await getSupabaseAdminClient().rpc('create_ai_agent_from_legacy_prompt', {
      p_organization_id: orgA,
      p_name: 'Aurora',
      p_prompt: PROMPT,
      p_origin: { sha256: sha256(`${PROMPT} `) },
    });
    expect(resultado.error?.message).toContain('origin_sha256_mismatch');
  });

  it('criação concorrente do mesmo prompt: a segunda espera a trava da primeira e volta o MESMO agente, sem 23505 (achado 8)', async () => {
    const texto = `${PROMPT}\nConcorrente`;
    const [a, b] = await Promise.all([sessaoPg(), sessaoPg()]);
    try {
      const chamada = (sessao: Client) => sessao.query(
        'select out_agent_id, out_created from public.create_ai_agent_from_legacy_prompt($1, $2, $3, $4::jsonb)',
        [orgA, 'Concorrente', texto, JSON.stringify({ sha256: sha256(texto), promptKey: AURORA, promptSource: 'default' })],
      );
      // A cria dentro de uma transação ABERTA: segura a trava de (organização, sha) e o agente ainda não é
      // visível para ninguém.
      await a.query('begin');
      const primeira = await chamada(a);
      expect(primeira.rows[0].out_created).toBe(true);

      const segunda = chamada(b);
      // B tem que estar parada na trava ADVISORY, antes da busca. Sem ela, B passaria pela busca vazia e
      // pararia no índice único (espera `transactionid`), para depois receber 23505.
      const travas = await esperarBloqueadoPor(a);
      expect(travas.map((t) => t.locktype)).toContain('advisory');

      await a.query('commit');
      const resultado = await segunda;
      expect(resultado.rows[0]).toEqual({ out_agent_id: primeira.rows[0].out_agent_id, out_created: false });
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
    const agentes = await getSupabaseAdminClient().from('ai_agents').select('id').eq('organization_id', orgA).eq('origin->>sha256', sha256(texto));
    expect(agentes.data).toHaveLength(1);
  });

  it('liga o número ao agente publicado da mesma organização e desliga de volta', async () => {
    const admin = getSupabaseAdminClient();
    assertNoSupabaseError(await admin.from('channel_connections').update({ ai_agent_id: agenteA }).eq('id', conexaoA), 'ligar');
    const ligada = await admin.from('channel_connections').select('ai_agent_id, config').eq('id', conexaoA).single();
    expect(ligada.data).toMatchObject({ ai_agent_id: agenteA, config: { aiEnabled: false } });

    assertNoSupabaseError(await admin.from('channel_connections').update({ ai_agent_id: null }).eq('id', conexaoA), 'desligar');
    const desligada = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexaoA).single();
    expect(desligada.data?.ai_agent_id).toBeNull();
  });

  it('a FK composta recusa ligar o número ao agente de outra organização (23503)', async () => {
    const outro = await criarAgente(orgB, `${PROMPT}\nB`);
    agenteB = (outro.data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const tentativa = await getSupabaseAdminClient().from('channel_connections').update({ ai_agent_id: agenteB }).eq('id', conexaoA);
    expect(tentativa.error?.code).toBe('23503');
  });

  it('o gatilho recusa ligar a agente sem versão publicada (P0001)', async () => {
    const admin = getSupabaseAdminClient();
    const vazio = await admin.from('ai_agents').insert({ organization_id: orgA, name: 'Sem versao' }).select('id').single();
    const vazioId = requireSupabaseData(vazio, 'insert agente vazio').id;
    const tentativa = await admin.from('channel_connections').update({ ai_agent_id: vazioId }).eq('id', conexaoA);
    expect(tentativa.error?.code).toBe('P0001');
    expect(tentativa.error?.message).toContain('ai_agent_not_published');
  });

  it('agente com número ligado não se apaga; desligado, apaga junto com as versões', async () => {
    const admin = getSupabaseAdminClient();
    const descartavel = await criarAgente(orgA, `${PROMPT}\nDescartavel`);
    const descartavelId = (descartavel.data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    assertNoSupabaseError(await admin.from('channel_connections').update({ ai_agent_id: descartavelId }).eq('id', conexaoA), 'ligar descartavel');

    const ligado = await admin.from('ai_agents').delete().eq('id', descartavelId);
    expect(ligado.error?.code).toBe('23503');
    const aindaLigada = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexaoA).single();
    expect(aindaLigada.data?.ai_agent_id).toBe(descartavelId);

    assertNoSupabaseError(await admin.from('channel_connections').update({ ai_agent_id: null }).eq('id', conexaoA), 'desligar descartavel');
    assertNoSupabaseError(await admin.from('ai_agents').delete().eq('id', descartavelId), 'apagar agente desligado');
    const versoes = await admin.from('ai_agent_versions').select('id').eq('agent_id', descartavelId);
    expect(versoes.error).toBeNull();
    expect(versoes.data).toEqual([]);
  });

  it('versão não aceita update', async () => {
    const tentativa = await getSupabaseAdminClient().from('ai_agent_versions').update({ note: 'mexi' }).eq('agent_id', agenteA);
    expect(tentativa.error?.message).toContain('ai_agent_version_immutable');
  });

  it('apagar o usuário que publicou uma versão não trava: o autor vira nulo e o resto não muda', async () => {
    const admin = getSupabaseAdminClient();
    await criarUsuario('agency_admin', orgA);
    const autorId = usuarios.at(-1)!;
    const versao = await admin
      .from('ai_agent_versions')
      .insert({ agent_id: agenteA, organization_id: orgA, version: 2, prompt: `${PROMPT}\nv2`, source: 'publish', published_by: autorId })
      .select('id')
      .single();
    const versaoId = requireSupabaseData(versao, 'insert versao com autor').id;

    const apagado = await admin.auth.admin.deleteUser(autorId);
    expect(apagado.error).toBeNull();

    const depois = await admin.from('ai_agent_versions').select('published_by, prompt, version').eq('id', versaoId).single();
    expect(depois.data).toEqual({ published_by: null, prompt: `${PROMPT}\nv2`, version: 2 });
  });

  it('apagar a organização inteira leva agente, versões, número ligado e eventos juntos', async () => {
    const admin = getSupabaseAdminClient();
    const org = await admin.from('organizations').insert({ name: `Vitest Org C ${runId}` }).select('id').single();
    const orgC = requireSupabaseData(org, 'insert org C').id;
    const criado = await criarAgente(orgC, `${PROMPT}\nC`);
    const agenteC = (criado.data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const conexao = await admin
      .from('channel_connections')
      .insert({ organization_id: orgC, provider: 'evolution', channel_type: 'whatsapp', name: `Central C ${runId}`, config: {}, ai_agent_id: agenteC })
      .select('id')
      .single();
    const conexaoC = requireSupabaseData(conexao, 'insert conexao C ligada').id;
    const conversaC = await novaConversa(conexaoC, orgC);
    assertNoSupabaseError(await admin.from('ai_reply_events').insert({
      ...evento(conexaoC, conversaC, sha256(PROMPT), '2026-09-29T10:00:00Z'),
      organization_id: orgC,
    }), 'evento C');

    assertNoSupabaseError(await admin.from('organizations').delete().eq('id', orgC), 'apagar org C');

    const sobras = await Promise.all([
      admin.from('ai_agents').select('id').eq('id', agenteC),
      admin.from('ai_agent_versions').select('id').eq('agent_id', agenteC),
      admin.from('channel_connections').select('id').eq('id', conexaoC),
      admin.from('ai_reply_events').select('id').eq('channel_connection_id', conexaoC),
    ]);
    for (const sobra of sobras) {
      expect(sobra.error).toBeNull();
      expect(sobra.data).toEqual([]);
    }
  });

  it('matriz de acesso (G2): seis identidades, três tabelas, duas organizações e as três funções', async () => {
    const identidades = {
      anonimo: createClient(getSupabaseUrl(), getAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } }),
      agencia: await entrar(emails.agencia!),
      staff: await entrar(emails.staff!),
      legado: await entrar(emails.legado!),
      clienteA: await entrar(emails.clienteA!),
      clienteB: await entrar(emails.clienteB!),
    };
    // Lê tudo (as duas organizações): agency_admin e o legado admin. Lê vazio, sem erro: agency_staff e os
    // clientes. Se a policy passasse a usar is_agency_role() (que inclui staff), o teste do staff cai.
    const leTudo = new Set(['agencia', 'legado']);
    const alvos = [
      { org: orgA, agente: agenteA },
      { org: orgB, agente: agenteB },
    ];
    const escritas = (org: string, agente: string) => ({
      ai_agents: {
        insert: { organization_id: org, name: 'Direto' },
        update: { name: 'Mexido' },
        coluna: 'id',
        chave: agente,
      },
      ai_agent_versions: {
        insert: { agent_id: agente, organization_id: org, version: 99, prompt: 'x', source: 'publish' },
        update: { note: 'mexi' },
        coluna: 'agent_id',
        chave: agente,
      },
    });
    const funcoes: Array<[string, Record<string, unknown>]> = [
      ['create_ai_agent_from_legacy_prompt', { p_organization_id: orgA, p_name: 'X', p_prompt: 'x', p_origin: { sha256: sha256('x') } }],
      ['central_agentes_ultima_resposta_nativa', { p_connection_id: conexaoA }],
      ['central_agentes_ligar_conexao', {
        p_connection_id: conexaoA, p_agent_id: agenteA, p_chave_bruta: null, p_prompt_key: PADRAO, p_prompt_source: 'default', p_sha256: sha256(PROMPT), p_publicacao: PUBLICACAO, p_deployment: DEPLOYMENT,
      }],
    ];

    for (const [nome, cliente] of Object.entries(identidades)) {
      for (const tabela of ['ai_agents', 'ai_agent_versions'] as const) {
        const coluna = tabela === 'ai_agents' ? 'id' : 'agent_id';
        const lidos = await cliente.from(tabela).select(coluna);
        if (nome === 'anonimo') {
          expect(lidos.error?.code, `${nome} lê ${tabela}`).toBe('42501');
        } else if (leTudo.has(nome)) {
          expect(lidos.error, `${nome} lê ${tabela}`).toBeNull();
          const ids = new Set((lidos.data ?? []).map((linha) => (linha as Record<string, string>)[coluna]));
          expect(ids.has(agenteA), `${nome} vê a organização A em ${tabela}`).toBe(true);
          expect(ids.has(agenteB), `${nome} vê a organização B em ${tabela}`).toBe(true);
        } else {
          expect(lidos.error, `${nome} lê ${tabela}`).toBeNull();
          expect(lidos.data, `${nome} lê ${tabela}`).toEqual([]);
        }
        for (const alvo of alvos) {
          const caso = escritas(alvo.org, alvo.agente)[tabela];
          const tentativas = [
            await cliente.from(tabela).insert(caso.insert),
            await cliente.from(tabela).update(caso.update).eq(caso.coluna, caso.chave),
            await cliente.from(tabela).delete().eq(caso.coluna, caso.chave),
          ];
          for (const tentativa of tentativas) expect(tentativa.error?.code, `${nome} escreve em ${tabela} da org ${alvo.org}`).toBe('42501');
        }
      }
      // O evento de prova é só da chave de serviço: nem leitura para quem é agência. CRUD inteiro negado
      // (G2 pede as quatro operações; 3ª rodada do Codex, achado 9).
      const tentativasNoEvento = [
        await cliente.from('ai_reply_events').select('id'),
        await cliente.from('ai_reply_events').insert(evento(conexaoA, conexaoA, sha256(PROMPT), '2026-09-29T10:00:00Z')),
        await cliente.from('ai_reply_events').update({ prompt_key: PADRAO }).eq('channel_connection_id', conexaoA),
        await cliente.from('ai_reply_events').delete().eq('channel_connection_id', conexaoA),
      ];
      for (const tentativa of tentativasNoEvento) expect(tentativa.error?.code, `${nome} em ai_reply_events`).toBe('42501');
      for (const [funcao, args] of funcoes) {
        const chamada = await cliente.rpc(funcao, args);
        expect(chamada.error?.code, `${nome} chama ${funcao}`).toBe('42501');
      }
    }

    const admin = getSupabaseAdminClient();
    const intactos = await admin.from('ai_agents').select('id, name').in('id', [agenteA, agenteB]);
    expect(intactos.data?.map((a) => a.name)).toEqual(['Aurora', 'Aurora']);
    const ligado = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexaoA).single();
    expect(ligado.data?.ai_agent_id).toBeNull();
    const eventosDeA = await admin.from('ai_reply_events').select('id').eq('channel_connection_id', conexaoA);
    expect(eventosDeA.data).toEqual([]);
  });

  it('a prova lê só o evento: última resposta pela hora da ENTREGA, sem agente, e ignora mensagem forjada', async () => {
    const admin = getSupabaseAdminClient();
    const conexao = await novaConexao('Prova');
    const conversa = await novaConversa(conexao);

    // A entrega mais nova é gravada ANTES (id menor): a ordem é pela hora da entrega, não pelo id.
    assertNoSupabaseError(await admin.from('ai_reply_events').insert([
      evento(conexao, conversa, 'b'.repeat(64), '2026-09-29T11:00:00Z'),
      evento(conexao, conversa, 'a'.repeat(64), '2026-09-29T10:00:00Z'),
    ]), 'eventos a e b');
    // Resposta dada por um agente (número ligado e depois desligado) não prova o caminho de hoje.
    assertNoSupabaseError(await admin.from('ai_reply_events').insert(
      evento(conexao, conversa, 'c'.repeat(64), '2026-09-29T12:00:00Z', { prompt_source: 'agent', prompt_key: null, agent_id: agenteA, agent_version: 1 }),
    ), 'evento com agente');
    // Mensagem manual (send_external:false) com o rastro forjado no metadata: entregue, "nativa", com sha
    // escolhido. A prova não lê mensagem nenhuma, então ela não entra (achado 1).
    assertNoSupabaseError(await admin.from('conversation_messages').insert({
      thread_id: conversa,
      organization_id: orgA,
      direction: 'outbound',
      content: 'forjada',
      sent_at: '2026-09-29T13:00:00Z',
      delivery_source: 'manual',
      delivery_status: 'sent',
      metadata: { automation_source: 'native_crm', native_ai: true, delivery_status: 'sent', reply_part_index: 0, prompt_sha256: 'f'.repeat(64) },
    }), 'mensagem forjada');

    const achada = await admin.rpc('central_agentes_ultima_resposta_nativa', { p_connection_id: conexao });
    expect(achada.error).toBeNull();
    expect(achada.data).toEqual([{
      out_sha256: 'b'.repeat(64),
      out_prompt_key: AURORA,
      out_prompt_source: 'default',
      out_release_commit: PUBLICACAO,
      out_release_deployment: DEPLOYMENT,
      out_delivered_at: expect.stringMatching(/^2026-09-29T11:00:00/),
    }]);

    const semEvento = await admin.rpc('central_agentes_ultima_resposta_nativa', { p_connection_id: conexaoA });
    expect(semEvento.data).toEqual([]);
  });

  it('o evento é da organização do número e da conversa (23503) e tem formato conferido (23514)', async () => {
    const admin = getSupabaseAdminClient();
    const conversaDeB = await novaConversa(null, orgB);
    const conversaDeA = await novaConversa(conexaoA);

    const numeroDeOutra = await admin.from('ai_reply_events').insert({ ...evento(conexaoA, conversaDeB, sha256(PROMPT), '2026-09-29T10:00:00Z'), organization_id: orgB });
    expect(numeroDeOutra.error?.code, 'conexão de A num evento de B').toBe('23503');

    const conversaDeOutra = await admin.from('ai_reply_events').insert(evento(conexaoA, conversaDeB, sha256(PROMPT), '2026-09-29T10:00:00Z'));
    expect(conversaDeOutra.error?.code, 'conversa de B num evento de A').toBe('23503');

    const shaTorto = await admin.from('ai_reply_events').insert(evento(conexaoA, conversaDeA, 'nao-e-sha', '2026-09-29T10:00:00Z'));
    expect(shaTorto.error?.code).toBe('23514');
    const deploymentTorto = await admin.from('ai_reply_events').insert(evento(conexaoA, conversaDeA, sha256(PROMPT), '2026-09-29T10:00:00Z', { release_deployment: 'nao-e-deployment' }));
    expect(deploymentTorto.error?.code).toBe('23514');
    const agenteSemVersao = await admin.from('ai_reply_events').insert(evento(conexaoA, conversaDeA, sha256(PROMPT), '2026-09-29T10:00:00Z', { prompt_source: 'agent', agent_id: agenteA }));
    expect(agenteSemVersao.error?.code).toBe('23514');

    const nada = await admin.from('ai_reply_events').select('id').eq('channel_connection_id', conexaoA);
    expect(nada.data).toEqual([]);
  });

  it('ligar confere tudo de novo numa transação só e recusa, com o motivo, se algo diverge', async () => {
    const admin = getSupabaseAdminClient();
    const texto = `${PROMPT}\nLigar`;
    const sha = sha256(texto);
    const agente = ((await criarAgente(orgA, texto)).data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const conexao = await novaConexao('Ligar', { aiPromptKey: AURORA });
    const conversa = await novaConversa(conexao);
    const responder = async (dados: Record<string, unknown>, entregueEm: string) =>
      assertNoSupabaseError(await admin.from('ai_reply_events').insert({ ...evento(conexao, conversa, sha, entregueEm), ...dados }), 'evento');
    const tentar = async (troca: Record<string, unknown> = {}) => {
      const r = await ligar(conexao, agente, sha, troca);
      expect(r.error).toBeNull();
      return r.data as string;
    };

    expect(await tentar({ p_sha256: 'x' })).toBe('sha_invalido');
    expect(await tentar({ p_publicacao: 'abc' })).toBe('publicacao_invalida');
    expect(await tentar({ p_deployment: 'abc' })).toBe('publicacao_invalida');
    expect(await tentar({ p_deployment: null })).toBe('publicacao_invalida');
    expect(await tentar()).toBe('prova_nao_confere');

    await responder({ prompt_sha256: 'f'.repeat(64) }, '2026-09-29T10:00:00Z');
    expect(await tentar()).toBe('prova_nao_confere');

    await responder({ release_commit: 'b'.repeat(40) }, '2026-09-29T10:30:00Z');
    expect(await tentar()).toBe('publicacao_diverge');

    // Mesmo commit, outro deployment (redeploy): é outra publicação (4ª rodada do Codex, achado 12).
    await responder({ release_deployment: 'dpl_redeploy2' }, '2026-09-29T10:40:00Z');
    expect(await tentar()).toBe('publicacao_diverge');

    await responder({ prompt_key: PADRAO }, '2026-09-29T10:45:00Z');
    expect(await tentar()).toBe('prova_nao_confere');

    // Mesmo sha, mesma chave e mesma publicação, mas o texto daquela resposta veio de um override: não
    // prova o padrão (3ª rodada do Codex, achado 5).
    await responder({ prompt_source: 'override' }, '2026-09-29T10:50:00Z');
    expect(await tentar()).toBe('prova_nao_confere');

    await responder({}, '2026-09-29T11:00:00Z');
    expect(await tentar({ p_chave_bruta: null })).toBe('chave_mudou');
    expect(await tentar({ p_prompt_key: PADRAO })).toBe('chave_efetiva_diverge');
    expect(await tentar({ p_prompt_source: 'x' })).toBe('origem_invalida');

    const override = requireSupabaseData(await admin
      .from('ai_prompt_templates')
      .insert({ organization_id: orgA, key: AURORA, content: 'Outro texto', version: 1, is_active: true })
      .select('id')
      .single(), 'insert override').id;
    expect(await tentar()).toBe('override_mudou');
    assertNoSupabaseError(await admin.from('ai_prompt_templates').delete().eq('id', override), 'apagar override');

    expect(await tentar({ p_agent_id: agenteA })).toBe('versao_publicada_diverge');

    expect(await tentar()).toBe('ligado');
    const ligada = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexao).single();
    expect(ligada.data?.ai_agent_id).toBe(agente);
    expect(await tentar()).toBe('ja_ligada');
  });

  it('corrida do override (achado 4): a ligação espera a escrita em andamento e a enxerga', async () => {
    const texto = `${PROMPT}\nCorrida override`;
    const agente = ((await criarAgente(orgA, texto)).data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const { conexao } = await numeroProvado('Corrida override', texto);
    const a = await sessaoPg();
    try {
      await a.query('begin');
      // Publicação de override em andamento (o publicador atual faz UPDATE e INSERT separados, sem transação):
      // a linha ainda não está visível, mas o INSERT já segura ROW EXCLUSIVE na tabela.
      await a.query(
        'insert into public.ai_prompt_templates (organization_id, key, content, version, is_active) values ($1, $2, $3, 1, true)',
        [orgA, AURORA, 'Override em andamento'],
      );
      // `.then` dispara o pedido agora (o construtor do supabase-js só manda quando alguém espera por ele).
      const chamada = ligar(conexao, agente, sha256(texto)).then((r) => r);
      // Sem a trava, a função não acharia a linha (IF EXISTS vazio) e ligaria. Com ela, a chamada fica
      // parada pedindo a ShareRowExclusiveLock da tabela de prompts, segurada pelo INSERT desta sessão.
      const travas = await esperarBloqueadoPor(a);
      expect(travas).toContainEqual(expect.objectContaining({
        locktype: 'relation',
        mode: 'ShareRowExclusiveLock',
        relacao: expect.stringMatching(/ai_prompt_templates$/),
      }));
      await a.query('commit');
      const resultado = await chamada;
      expect(resultado.error).toBeNull();
      expect(resultado.data).toBe('override_mudou');
      await a.query('delete from public.ai_prompt_templates where organization_id = $1 and key = $2', [orgA, AURORA]);
    } finally {
      await a.end();
    }
    const ligada = await getSupabaseAdminClient().from('channel_connections').select('ai_agent_id').eq('id', conexao).single();
    expect(ligada.data?.ai_agent_id).toBeNull();
  });

  it('corrida do ponteiro (achado 4): publicar outra versão durante a ligação é visto antes de ligar', async () => {
    const admin = getSupabaseAdminClient();
    const texto = `${PROMPT}\nCorrida ponteiro`;
    const agente = ((await criarAgente(orgA, texto)).data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const { conexao } = await numeroProvado('Corrida ponteiro', texto);
    const v2 = requireSupabaseData(await admin
      .from('ai_agent_versions')
      .insert({ agent_id: agente, organization_id: orgA, version: 2, prompt: `${texto}\nv2`, source: 'publish' })
      .select('id')
      .single(), 'insert v2').id;
    const a = await sessaoPg();
    try {
      await a.query('begin');
      // Publicação da v2 em andamento: a linha do agente está travada por esta transação.
      await a.query('update public.ai_agents set published_version_id = $1 where id = $2', [v2, agente]);
      const chamada = ligar(conexao, agente, sha256(texto)).then((r) => r);
      // A chamada já passou pela tabela de prompts e pelo número, e para no FOR SHARE do agente: espera a
      // transação desta sessão (trava `transactionid`), que é quem está mudando o ponteiro.
      const travas = await esperarBloqueadoPor(a);
      expect(travas.map((t) => t.locktype)).toContain('transactionid');
      await a.query('commit');
      const resultado = await chamada;
      expect(resultado.error).toBeNull();
      expect(resultado.data).toBe('versao_publicada_diverge');
    } finally {
      await a.end();
    }
    const ligada = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexao).single();
    expect(ligada.data?.ai_agent_id).toBeNull();
  });
});
