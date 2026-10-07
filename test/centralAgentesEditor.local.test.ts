// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { assertNoSupabaseError, getSupabaseAdminClient } from './helpers/supabaseAdmin';
import { getAnonKey, getSupabaseUrl } from './helpers/env';

const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

/** Postgres do `supabase start`. Constante de propósito: a corrida nunca abre sessão fora do local. */
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');
const BASE = 'Voce e a Aurora. {{contactName}}\n{{recentMessagesText}}';

function exigirPostgresLocal() {
  const alvo = new URL(DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(alvo.hostname) || alvo.port !== '54322' || alvo.pathname !== '/postgres') {
    throw new Error('RECUSADO: a corrida so abre sessao no Postgres local (127.0.0.1:54322).');
  }
}

type Papel = 'agency_admin' | 'agency_staff' | 'admin' | 'clinic_admin';
type LinhaPublicada = { out_version: number; out_version_id: string };
type LinhaRestaurada = LinhaPublicada & { out_draft_revision: number };

describeLocal('Central de Agentes, editor (fatia 2) — Supabase local', () => {
  let runId = '';
  let orgA = '';
  let orgB = '';
  let idAgencia = '';
  let agencia: SupabaseClient;
  const usuarios: string[] = [];
  const emails: Partial<Record<'agencia' | 'staff' | 'legado' | 'clienteA' | 'clienteB', string>> = {};
  const senha = `Vitest!${randomUUID()}`;

  async function criarUsuario(role: Papel, organizationId: string) {
    const admin = getSupabaseAdminClient();
    const email = `editor.${role}.${runId}.${randomUUID()}@example.com`;
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
      name: `Editor ${role} ${runId}`,
      first_name: 'Editor',
      organization_id: organizationId,
      role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' }), `upsert profile ${role}`);
    return { email, id: criado.data.user.id };
  }

  async function entrar(email: string) {
    const client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await client.auth.signInWithPassword({ email, password: senha });
    expect(login.error).toBeNull();
    return client;
  }

  /** Agente com a v1 como a migração cria. O texto leva um sufixo único: a criação é idempotente por (cliente, sha). */
  async function novoAgente(organizationId: string, sufixo: string) {
    const prompt = `${BASE}\n${sufixo} ${randomUUID()}`;
    const criado = await getSupabaseAdminClient().rpc('create_ai_agent_from_legacy_prompt', {
      p_organization_id: organizationId,
      p_name: 'Aurora',
      p_prompt: prompt,
      p_origin: { sha256: sha256(prompt), promptKey: 'task_conversations_whatsapp_cenno_aurora', promptSource: 'default' },
    });
    expect(criado.error).toBeNull();
    return { agente: (criado.data as Array<{ out_agent_id: string }>)[0].out_agent_id, v1: prompt };
  }

  async function estado(agente: string) {
    const admin = getSupabaseAdminClient();
    const a = await admin
      .from('ai_agents')
      .select('draft, draft_revision, draft_updated_by, published_version_id')
      .eq('id', agente)
      .single();
    const v = await admin
      .from('ai_agent_versions')
      .select('id, version, prompt, settings, model, source, restored_from, note, published_by')
      .eq('agent_id', agente)
      .order('version');
    expect(a.error).toBeNull();
    expect(v.error).toBeNull();
    return { agente: a.data!, versoes: v.data! };
  }

  const salvar = (cliente: SupabaseClient, org: string, agente: string, revisao: number, prompt: string) =>
    cliente.rpc('save_ai_agent_draft', {
      p_organization_id: org,
      p_agent_id: agente,
      p_expected_revision: revisao,
      p_prompt: prompt,
    });
  const publicar = (cliente: SupabaseClient, org: string, agente: string, versao: number, revisao: number, nota: string | null = null) =>
    cliente.rpc('publish_ai_agent_version', {
      p_organization_id: org,
      p_agent_id: agente,
      p_expected_version: versao,
      p_expected_revision: revisao,
      p_note: nota,
    });
  const restaurar = (cliente: SupabaseClient, org: string, agente: string, alvo: number, versao: number, revisao: number, nota: string | null = null) =>
    cliente.rpc('restore_ai_agent_version', {
      p_organization_id: org,
      p_agent_id: agente,
      p_version: alvo,
      p_expected_version: versao,
      p_expected_revision: revisao,
      p_note: nota,
    });

  async function sessaoPg() {
    exigirPostgresLocal();
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    return client;
  }

  /**
   * Espera a sessão que roda `consulta` ficar BLOQUEADA por `dona` e devolve as travas que ela pede e não ganhou.
   * Só conta a sessão daquela consulta (revisão do Codex, rodada 2): sem o filtro, uma espera alheia pela mesma
   * trava seria atribuída à segunda publicação.
   */
  async function esperarBloqueadoPor(dona: Client, consulta: string) {
    const limite = Date.now() + 5000;
    for (;;) {
      // A `dona` está com a transação aberta, e dentro dela o Postgres congela o pg_stat_activity no primeiro acesso:
      // sem limpar a foto, o filtro lê o texto ANTERIOR da conexão do PostgREST e erra nos dois sentidos (medido em
      // 07/10: falhava sempre que a conexão que atendeu tinha rodado outra função por último).
      await dona.query('select pg_stat_clear_snapshot()');
      const bloqueadas = await dona.query(
        'select a.pid from pg_stat_activity a where pg_backend_pid() = any(pg_blocking_pids(a.pid)) and a.query like $1',
        [`%${consulta}%`],
      );
      if (bloqueadas.rows.length > 0) {
        const pids = bloqueadas.rows.map((linha) => linha.pid as number);
        const travas = await dona.query(
          "select l.locktype, l.mode, coalesce(l.relation::regclass::text, '') as relacao from pg_locks l where not l.granted and l.pid = any($1::int[])",
          [pids],
        );
        return travas.rows as Array<{ locktype: string; mode: string; relacao: string }>;
      }
      if (Date.now() > limite) throw new Error(`nenhuma sessao de ${consulta} ficou esperando a trava em 5 s: a chamada concorrente nao travou`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    const fixtures = await createMinimalFixtures();
    runId = fixtures.runId;
    orgA = fixtures.orgA.organizationId;
    orgB = fixtures.orgB.organizationId;
    const criado = await criarUsuario('agency_admin', orgA);
    emails.agencia = criado.email;
    idAgencia = criado.id;
    emails.staff = (await criarUsuario('agency_staff', orgA)).email;
    emails.legado = (await criarUsuario('admin', orgA)).email;
    emails.clienteA = (await criarUsuario('clinic_admin', orgA)).email;
    emails.clienteB = (await criarUsuario('clinic_admin', orgB)).email;
    agencia = await entrar(emails.agencia);
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    for (const id of usuarios) await admin.auth.admin.deleteUser(id);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('salvar rascunho sobe a revisão, grava o autor e recusa a revisão que outra aba já passou', async () => {
    const { agente } = await novoAgente(orgA, 'salvar');
    const primeira = await salvar(agencia, orgA, agente, 0, `${BASE}\nrascunho 1`);
    expect(primeira.error).toBeNull();
    expect(primeira.data).toBe(1);

    const depois = await estado(agente);
    expect(depois.agente.draft).toEqual({ prompt: `${BASE}\nrascunho 1` });
    expect(depois.agente.draft_revision).toBe(1);
    expect(depois.agente.draft_updated_by).toBe(idAgencia);

    const daOutraAba = await salvar(agencia, orgA, agente, 0, `${BASE}\nrascunho da outra aba`);
    expect(daOutraAba.error?.code).toBe('P0001');
    expect(daOutraAba.error?.message).toBe('rascunho_mudou');
    expect((await estado(agente)).agente.draft).toEqual({ prompt: `${BASE}\nrascunho 1` });
  });

  it('publicar cria N+1, move o ponteiro, copia ajustes e modelo da publicada e grava nota e autor', async () => {
    const { agente } = await novoAgente(orgA, 'publicar');
    // A v1 da migração tem {} e nulo, os mesmos valores de uma inserção que omitisse os dois campos. Para provar a
    // CÓPIA, a publicada passa a ser uma v2 com valores diferentes do padrão, gravada direto no Postgres local.
    const pg = await sessaoPg();
    try {
      const v2 = await pg.query(
        "insert into public.ai_agent_versions (agent_id, organization_id, version, prompt, settings, model, source) values ($1, $2, 2, $3, $4::jsonb, 'modelo-de-teste', 'publish') returning id",
        [agente, orgA, `${BASE}\nv2 direta`, JSON.stringify({ origemDoTeste: true })],
      );
      await pg.query('update public.ai_agents set published_version_id = $1 where id = $2', [v2.rows[0].id, agente]);
    } finally {
      await pg.end();
    }
    expect((await salvar(agencia, orgA, agente, 0, `${BASE}\nv3`)).error).toBeNull();

    const publicada = await publicar(agencia, orgA, agente, 2, 1, '  abertura nova  ');
    expect(publicada.error).toBeNull();
    const linha = (publicada.data as LinhaPublicada[])[0];
    expect(linha.out_version).toBe(3);

    const { agente: depois, versoes } = await estado(agente);
    expect(depois.published_version_id).toBe(linha.out_version_id);
    expect(depois.draft_revision).toBe(1);
    expect(versoes.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versoes[2]).toMatchObject({
      id: linha.out_version_id,
      prompt: `${BASE}\nv3`,
      settings: { origemDoTeste: true },
      model: 'modelo-de-teste',
      source: 'publish',
      restored_from: null,
      note: 'abertura nova',
      published_by: idAgencia,
    });
  });

  it('publicar recusa versão esperada velha, revisão velha, rascunho igual ao publicado e rascunho vazio', async () => {
    const { agente } = await novoAgente(orgA, 'recusas');
    const vazio = await publicar(agencia, orgA, agente, 1, 0);
    expect(vazio.error?.message).toBe('rascunho_vazio');

    expect((await salvar(agencia, orgA, agente, 0, `${BASE}\nv2`)).error).toBeNull();
    expect((await publicar(agencia, orgA, agente, 1, 1)).error).toBeNull();

    // A tela mostrava a v1: outra pessoa publicou a v2 no meio.
    const versaoVelha = await publicar(agencia, orgA, agente, 1, 1);
    expect(versaoVelha.error?.code).toBe('P0001');
    expect(versaoVelha.error?.message).toBe('versao_publicada_mudou');

    // O rascunho que está no banco é o texto da v2: publicar de novo não muda nada.
    const igual = await publicar(agencia, orgA, agente, 2, 1);
    expect(igual.error?.message).toBe('sem_mudancas');

    expect((await salvar(agencia, orgA, agente, 1, `${BASE}\nv3`)).error).toBeNull();
    // A tela verificou a revisão 1; o banco está na 2.
    const revisaoVelha = await publicar(agencia, orgA, agente, 2, 1);
    expect(revisaoVelha.error?.code).toBe('P0001');
    expect(revisaoVelha.error?.message).toBe('rascunho_mudou');

    expect((await estado(agente)).versoes.map((v) => v.version)).toEqual([1, 2]);
  });

  it('restaurar publica a versão escolhida como nova, com restored_from, e traz o texto para o rascunho', async () => {
    const { agente, v1 } = await novoAgente(orgA, 'restaurar');
    expect((await salvar(agencia, orgA, agente, 0, `${BASE}\nv2`)).error).toBeNull();
    expect((await publicar(agencia, orgA, agente, 1, 1)).error).toBeNull();

    const restaurada = await restaurar(agencia, orgA, agente, 1, 2, 1, 'voltar a abertura');
    expect(restaurada.error).toBeNull();
    const linha = (restaurada.data as LinhaRestaurada[])[0];
    expect(linha.out_version).toBe(3);
    expect(linha.out_draft_revision).toBe(2);

    const { agente: depois, versoes } = await estado(agente);
    expect(depois.published_version_id).toBe(linha.out_version_id);
    expect(depois.draft).toEqual({ prompt: v1 });
    expect(depois.draft_revision).toBe(2);
    expect(versoes[2]).toMatchObject({
      version: 3,
      prompt: v1,
      source: 'restore',
      restored_from: 1,
      note: 'voltar a abertura',
      published_by: idAgencia,
    });

    const aPropria = await restaurar(agencia, orgA, agente, 3, 3, 2);
    expect(aPropria.error?.message).toBe('versao_ja_publicada');
    const repetida = await restaurar(agencia, orgA, agente, 1, 3, 2);
    expect(repetida.error?.message).toBe('sem_mudancas');
    const inexistente = await restaurar(agencia, orgA, agente, 9, 3, 2);
    expect(inexistente.error?.code).toBe('P0002');
    expect(inexistente.error?.message).toBe('versao_inexistente');
    const revisaoVelha = await restaurar(agencia, orgA, agente, 2, 3, 1);
    expect(revisaoVelha.error?.message).toBe('rascunho_mudou');

    expect((await estado(agente)).versoes.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('variável fora das 12 é recusada pela própria função, ao publicar e ao restaurar, mesmo chamando direto', async () => {
    const { agente } = await novoAgente(orgA, 'variavel');
    // Chamada direta pelo JWT de quem é da agência, sem passar pela rota que roda a verificação ao vivo.
    expect((await salvar(agencia, orgA, agente, 0, `${BASE}\n{{ nomeDoLead }}`)).error).toBeNull();
    const publicada = await publicar(agencia, orgA, agente, 1, 1);
    expect(publicada.error?.code).toBe('P0001');
    expect(publicada.error?.message).toBe('variavel_desconhecida');
    expect(publicada.error?.details).toBe('nomeDoLead');

    // Espaços nas pontas não contam, como no runtime e na tela.
    expect((await salvar(agencia, orgA, agente, 1, `${BASE}\n{{ contactName }}`)).error).toBeNull();
    expect((await publicar(agencia, orgA, agente, 1, 2)).error).toBeNull();

    // Uma versão antiga com uma variável que saiu do runtime: restaurar também recusa.
    const pg = await sessaoPg();
    try {
      await pg.query(
        "insert into public.ai_agent_versions (agent_id, organization_id, version, prompt, source) values ($1, $2, 99, $3, 'publish')",
        [agente, orgA, `${BASE}\n{{variavelQueSaiu}}`],
      );
    } finally {
      await pg.end();
    }
    const restaurada = await restaurar(agencia, orgA, agente, 99, 2, 2);
    expect(restaurada.error?.message).toBe('variavel_desconhecida');
    expect(restaurada.error?.details).toBe('variavelQueSaiu');

    const { agente: depois } = await estado(agente);
    expect(depois.draft_revision).toBe(2);
  });

  it('o agente tem que ser da organização informada (G4)', async () => {
    const { agente: deB } = await novoAgente(orgB, 'outra organizacao');
    const chamadas = [
      await salvar(agencia, orgA, deB, 0, 'x'),
      await publicar(agencia, orgA, deB, 1, 0),
      await restaurar(agencia, orgA, deB, 1, 1, 0),
    ];
    for (const chamada of chamadas) {
      expect(chamada.error?.code).toBe('P0002');
      expect(chamada.error?.message).toBe('agente_inexistente');
    }
    const { agente } = await estado(deB);
    expect(agente.draft_revision).toBe(0);
  });

  it('limites: prompt vazio ou acima de 50 mil caracteres e nota acima de 200', async () => {
    const { agente } = await novoAgente(orgA, 'limites');
    for (const prompt of ['', 'x'.repeat(50_001)]) {
      const r = await salvar(agencia, orgA, agente, 0, prompt);
      expect(r.error?.code).toBe('22023');
      expect(r.error?.message).toBe('prompt_invalido');
    }
    expect((await salvar(agencia, orgA, agente, 0, 'x'.repeat(50_000))).error).toBeNull();
    const nota = await publicar(agencia, orgA, agente, 1, 1, 'n'.repeat(201));
    expect(nota.error?.code).toBe('22023');
    expect(nota.error?.message).toBe('nota_invalida');
  });

  it('matriz de acesso (G2): execute só de authenticated, lido no catálogo; dentro, só agency_admin e o legado admin passam do papel', async () => {
    // O 42501 do Postgres (sem execute) e o da função (sem_permissao) têm o mesmo código: a chamada sozinha não prova
    // o revoke. O catálogo mostra o privilégio efetivo, com herança de papel (revisão do Codex, 07/10).
    const pg = await sessaoPg();
    try {
      const privilegio = (funcao: string) =>
        pg.query(
          "select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as autenticado, has_function_privilege('service_role', $1, 'execute') as servico",
          [funcao],
        );
      for (const funcao of [
        'public.save_ai_agent_draft(uuid, uuid, integer, text)',
        'public.publish_ai_agent_version(uuid, uuid, integer, integer, text)',
        'public.restore_ai_agent_version(uuid, uuid, integer, integer, integer, text)',
      ]) {
        expect((await privilegio(funcao)).rows[0], funcao).toEqual({ anon: false, autenticado: true, servico: false });
      }
      expect((await privilegio('public.central_agentes_variavel_desconhecida(text)')).rows[0]).toEqual({
        anon: false,
        autenticado: false,
        servico: false,
      });
    } finally {
      await pg.end();
    }

    const { agente } = await novoAgente(orgA, 'matriz');
    const antes = await estado(agente);
    const identidades: Record<string, SupabaseClient> = {
      anonimo: createClient(getSupabaseUrl(), getAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } }),
      agencia,
      staff: await entrar(emails.staff!),
      legado: await entrar(emails.legado!),
      clienteA: await entrar(emails.clienteA!),
      clienteB: await entrar(emails.clienteB!),
      servico: getSupabaseAdminClient(),
    };
    // Quem passa do papel para na versão/revisão esperada (999), sem escrever nada.
    const passaDoPapel = new Set(['agencia', 'legado']);
    // Sem execute: o Postgres recusa antes de entrar na função.
    const semExecute = new Set(['anonimo', 'servico']);
    for (const [nome, cliente] of Object.entries(identidades)) {
      const chamadas = [
        await salvar(cliente, orgA, agente, 999, 'x'),
        await publicar(cliente, orgA, agente, 999, 999),
        await restaurar(cliente, orgA, agente, 1, 999, 999),
      ];
      for (const chamada of chamadas) {
        if (passaDoPapel.has(nome)) {
          expect(chamada.error?.code, nome).toBe('P0001');
        } else if (semExecute.has(nome)) {
          expect(chamada.error?.code, nome).toBe('42501');
          expect(chamada.error?.message, nome).toMatch(/permission denied for function/);
        } else {
          expect(chamada.error?.code, nome).toBe('42501');
          expect(chamada.error?.message, nome).toBe('sem_permissao');
        }
      }
    }
    expect(await estado(agente)).toEqual(antes);
  });

  it('corrida: com uma publicação aberta em outra sessão, a segunda espera a trava da linha e recebe versao_publicada_mudou', async () => {
    const { agente } = await novoAgente(orgA, 'corrida');
    expect((await salvar(agencia, orgA, agente, 0, `${BASE}\nv2`)).error).toBeNull();
    const a = await sessaoPg();
    try {
      await a.query('begin');
      // Esta sessão age como o mesmo agency_admin, do jeito que o PostgREST chama: papel authenticated e as claims do JWT.
      await a.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: idAgencia, role: 'authenticated' })]);
      await a.query('set local role authenticated');
      const primeira = await a.query('select * from public.publish_ai_agent_version($1, $2, 1, 1, $3)', [orgA, agente, 'primeira']);
      expect(primeira.rows[0].out_version).toBe(2);
      // Volta ao papel da sessão para ler pg_stat_activity e pg_locks; a trava da linha continua com a transação.
      await a.query('reset role');

      const segunda = publicar(agencia, orgA, agente, 1, 1, 'segunda').then((r) => r);
      const travas = await esperarBloqueadoPor(a, 'publish_ai_agent_version');
      expect(travas.map((t) => t.locktype)).toContain('transactionid');
      await a.query('commit');

      const resultado = await segunda;
      expect(resultado.error?.code).toBe('P0001');
      expect(resultado.error?.message).toBe('versao_publicada_mudou');
    } finally {
      await a.end();
    }
    const { versoes } = await estado(agente);
    expect(versoes.map((v) => [v.version, v.note, v.published_by])).toEqual([[1, null, null], [2, 'primeira', idAgencia]]);
  });
});
