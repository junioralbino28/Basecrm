// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { assertNoSupabaseError, getSupabaseAdminClient } from './helpers/supabaseAdmin';
import { ocorrenciasDeLacunas } from '@/lib/agents/verificarPrompt';
import { getAnonKey, getSupabaseUrl } from './helpers/env';

/**
 * Central de Agentes, bloco 2 (SPEC-bloco-2.md; PLAN-bloco-2.md, Task 3): as seis funções de criar agente e de
 * modelo, chamadas de verdade no Supabase local. Cada caso diz o que prova. Sem barra invertida neste arquivo: a
 * quebra de linha entra por String.fromCharCode(10).
 */
const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

/** Postgres do `supabase start`. Constante de propósito: a corrida nunca abre sessão fora do local. */
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const NL = String.fromCharCode(10);
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

function exigirPostgresLocal() {
  const alvo = new URL(DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(alvo.hostname) || alvo.port !== '54322' || alvo.pathname !== '/postgres') {
    throw new Error('RECUSADO: a corrida so abre sessao no Postgres local (127.0.0.1:54322).');
  }
}

type Papel = 'agency_admin' | 'agency_staff' | 'clinic_admin';
type Erro = { message?: string; code?: string } | null;

describeLocal('Central de Agentes, criar agentes e modelos (bloco 2) — Supabase local', () => {
  let runId = '';
  let orgA = '';
  let orgB = '';
  let orgApagavel = '';
  let idAgencia = '';
  let agencia: SupabaseClient;
  let staff: SupabaseClient;
  let cliente: SupabaseClient;
  const usuarios: string[] = [];
  const modelos: string[] = [];
  const senha = `Vitest!${randomUUID()}`;

  async function criarUsuario(role: Papel, organizationId: string) {
    const admin = getSupabaseAdminClient();
    const email = `modelos.${role}.${runId}.${randomUUID()}@example.com`;
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
      name: `Modelos ${role} ${runId}`,
      first_name: 'Modelos',
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

  /** Espera a sessão que roda `consulta` ficar bloqueada pela `dona` (mesmo leitor do teste do editor). */
  async function esperarBloqueadoPor(dona: Client, consulta: string) {
    const limite = Date.now() + 5000;
    for (;;) {
      await dona.query('select pg_stat_clear_snapshot()');
      const bloqueadas = await dona.query(
        'select a.pid from pg_stat_activity a where pg_backend_pid() = any(pg_blocking_pids(a.pid)) and a.query like $1',
        [`%${consulta}%`],
      );
      if (bloqueadas.rows.length > 0) return;
      if (Date.now() > limite) throw new Error(`nenhuma sessao de ${consulta} ficou esperando a trava em 5 s`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Agente com a v1 publicada, como a migração cria (a chave de serviço não confere variável: serve ao caso 9). */
  async function agentePublicado(organizationId: string, prompt: string) {
    const criado = await getSupabaseAdminClient().rpc('create_ai_agent_from_legacy_prompt', {
      p_organization_id: organizationId,
      p_name: 'Origem',
      p_prompt: prompt,
      p_origin: { sha256: sha256(prompt), promptKey: 'task_conversations_whatsapp_auto_reply', promptSource: 'default' },
    });
    expect(criado.error).toBeNull();
    return (criado.data as Array<{ out_agent_id: string }>)[0].out_agent_id;
  }

  async function novoModelo(prompt: string, nome = 'Modelo de teste') {
    const r = await agencia.rpc('save_ai_agent_template', {
      p_template_id: null,
      p_expected_revision: null,
      p_name: nome,
      p_description: 'criado pelo teste local',
      p_prompt: prompt,
    });
    expect(r.error).toBeNull();
    const linha = (r.data as Array<{ out_id: string; out_revision: number }>)[0];
    modelos.push(linha.out_id);
    return linha;
  }

  const blank = (c: SupabaseClient, org: string, prompt: string, nome = 'Novo') =>
    c.rpc('create_ai_agent_blank', { p_organization_id: org, p_name: nome, p_prompt: prompt });
  const doModelo = (c: SupabaseClient, org: string, id: string, revisao: number, respostas: Record<string, unknown>, nome = 'Do modelo') =>
    c.rpc('create_ai_agent_from_template', {
      p_organization_id: org,
      p_name: nome,
      p_template_id: id,
      p_expected_template_revision: revisao,
      p_answers: respostas,
    });
  const daCopia = (c: SupabaseClient, org: string, origemOrg: string, origemAgente: string, versao: number, nome = 'Copia') =>
    c.rpc('create_ai_agent_from_copy', {
      p_organization_id: org,
      p_name: nome,
      p_source_organization_id: origemOrg,
      p_source_agent_id: origemAgente,
      p_expected_source_version: versao,
    });

  async function agente(id: string) {
    const r = await getSupabaseAdminClient()
      .from('ai_agents')
      .select('organization_id, name, draft, draft_revision, draft_updated_by, published_version_id, origin, created_by')
      .eq('id', id)
      .single();
    expect(r.error).toBeNull();
    return r.data as {
      organization_id: string; name: string; draft: { prompt: string }; draft_revision: number; draft_updated_by: string | null;
      published_version_id: string | null; origin: Record<string, unknown>; created_by: string | null;
    };
  }

  /** Só as linhas deste teste (outros arquivos locais rodam em paralelo e escrevem nas mesmas tabelas). */
  async function contar() {
    const admin = getSupabaseAdminClient();
    const orgs = [orgA, orgB, orgApagavel];
    const a = await admin.from('ai_agents').select('id', { count: 'exact', head: true }).in('organization_id', orgs);
    const v = await admin.from('ai_agent_versions').select('id', { count: 'exact', head: true }).in('organization_id', orgs);
    const t = await admin.from('ai_agent_templates').select('id', { count: 'exact', head: true }).eq('created_by', idAgencia);
    return { agentes: a.count, versoes: v.count, modelos: t.count };
  }

  const nomeDoErro = (e: Erro) => e?.message ?? null;

  beforeAll(async () => {
    const fixtures = await createMinimalFixtures();
    runId = fixtures.runId;
    orgA = fixtures.orgA.organizationId;
    orgB = fixtures.orgB.organizationId;
    const org = await getSupabaseAdminClient().from('organizations').insert({ name: `Apagavel ${runId}` }).select('id').single();
    expect(org.error).toBeNull();
    orgApagavel = (org.data as { id: string }).id;
    const criado = await criarUsuario('agency_admin', orgA);
    idAgencia = criado.id;
    agencia = await entrar(criado.email);
    staff = await entrar((await criarUsuario('agency_staff', orgA)).email);
    cliente = await entrar((await criarUsuario('clinic_admin', orgA)).email);
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    if (modelos.length > 0) await admin.from('ai_agent_templates').delete().in('id', modelos);
    if (orgApagavel) await admin.from('organizations').delete().eq('id', orgApagavel);
    for (const id of usuarios) await admin.auth.admin.deleteUser(id);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('1. matriz de acesso: cliente, equipe da agência, anônimo e chave de serviço não usam nenhuma das seis', async () => {
    const { out_id: modelo, out_revision: rev } = await novoModelo('Oi [Nome]');
    const fonte = await agentePublicado(orgA, `Origem da matriz ${randomUUID()}`);
    const anonimo = createClient(getSupabaseUrl(), getAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const servico = getSupabaseAdminClient();
    const chamadas = (c: SupabaseClient) => [
      blank(c, orgA, 'Texto'),
      doModelo(c, orgA, modelo, rev, {}),
      daCopia(c, orgA, orgA, fonte, 1),
      c.rpc('save_ai_agent_template', { p_template_id: null, p_expected_revision: null, p_name: 'X', p_description: null, p_prompt: 'Y' }),
      c.rpc('create_ai_agent_template_from_agent', { p_organization_id: orgA, p_agent_id: fonte, p_expected_version: 1, p_name: 'X', p_description: null }),
      c.rpc('set_ai_agent_template_archived', { p_template_id: modelo, p_archived: true, p_expected_revision: rev }),
    ];
    const antes = await contar();
    for (const [quem, c] of [['cliente', cliente], ['equipe', staff]] as const) {
      for (const r of await Promise.all(chamadas(c))) expect(nomeDoErro(r.error), quem).toBe('sem_permissao');
    }
    for (const [quem, c] of [['anonimo', anonimo], ['servico', servico]] as const) {
      // Sem execute: o Postgres recusa antes de entrar na função. Se a chave de serviço receber sem_permissao, ela
      // herdou execute e o revoke falhou: parar, nunca afrouxar o teste.
      for (const r of await Promise.all(chamadas(c))) expect(nomeDoErro(r.error), quem).toMatch(/permission denied/);
    }
    expect(await contar()).toEqual(antes);
  });

  it('2. branco: cria o rascunho com a origem montada pelo banco; recusa cliente apagado e variável desconhecida', async () => {
    const texto = `Voce atende a loja. {{contactName}} ${randomUUID()}`;
    const r = await blank(agencia, orgA, texto, '  Atendente  ');
    expect(r.error).toBeNull();
    const a = await agente(r.data as string);
    expect(a).toMatchObject({
      organization_id: orgA, name: 'Atendente', draft: { prompt: texto }, draft_revision: 1, draft_updated_by: idAgencia,
      published_version_id: null, created_by: idAgencia, origin: { kind: 'blank', promptSha256: sha256(texto) },
    });
    expect(Object.keys(a.origin).sort()).toEqual(['kind', 'promptSha256']);

    const antes = await contar();
    expect(nomeDoErro((await blank(agencia, orgA, 'Oi {{naoExiste}}')).error)).toBe('variavel_desconhecida');
    expect(nomeDoErro((await blank(agencia, orgA, 'Oi', '   ')).error)).toBe('nome_invalido');
    expect(nomeDoErro((await blank(agencia, randomUUID(), 'Oi')).error)).toBe('cliente_inexistente');
    const admin = getSupabaseAdminClient();
    assertNoSupabaseError(await admin.from('organizations').update({ deleted_at: new Date().toISOString() }).eq('id', orgApagavel), 'apagar');
    expect(nomeDoErro((await blank(agencia, orgApagavel, 'Oi')).error)).toBe('cliente_inexistente');
    assertNoSupabaseError(await admin.from('organizations').update({ deleted_at: null }).eq('id', orgApagavel), 'desapagar');
    expect(await contar()).toEqual(antes);
  });

  it('2b. exclusão concorrente do cliente: a criação espera a trava e termina em cliente_inexistente nos três começos', async () => {
    const { out_id: modelo, out_revision: rev } = await novoModelo('Oi [Nome]');
    const fonte = await agentePublicado(orgA, `Origem da corrida ${randomUUID()}`);
    const casos: Array<[string, () => PromiseLike<{ error: Erro }>]> = [
      ['create_ai_agent_blank', () => blank(agencia, orgApagavel, 'Oi')],
      ['create_ai_agent_from_template', () => doModelo(agencia, orgApagavel, modelo, rev, {})],
      ['create_ai_agent_from_copy', () => daCopia(agencia, orgApagavel, orgA, fonte, 1)],
    ];
    const admin = getSupabaseAdminClient();
    for (const [funcao, criar] of casos) {
      const antes = await contar();
      const dona = await sessaoPg();
      try {
        await dona.query('begin');
        await dona.query('update public.organizations set deleted_at = now() where id = $1', [orgApagavel]);
        // .then dispara o pedido agora (o builder do supabase-js é preguiçoso), como no teste do editor.
        const pendente = criar().then((r) => r);
        await esperarBloqueadoPor(dona, funcao);
        await dona.query('commit');
        expect(nomeDoErro((await pendente).error), funcao).toBe('cliente_inexistente');
      } finally {
        await dona.end();
      }
      expect(await contar(), funcao).toEqual(antes);
      assertNoSupabaseError(await admin.from('organizations').update({ deleted_at: null }).eq('id', orgApagavel), 'desapagar');
    }
  });

  it('3 e 4. modelo: o banco monta o texto, troca todas as ocorrências, e a origem prova a derivação', async () => {
    const molde = 'Oi [Nome da empresa], abrimos [Horário]. Fale com [Nome da empresa]. {{contactName}}';
    const { out_id: modelo, out_revision: rev } = await novoModelo(molde);
    const r = await doModelo(agencia, orgA, modelo, rev, { '[Nome da empresa]': '  Loja Sol ', '[Horário]': '' });
    expect(r.error).toBeNull();
    const a = await agente(r.data as string);
    const esperado = 'Oi Loja Sol, abrimos [Horário]. Fale com Loja Sol. {{contactName}}';
    expect(a.draft.prompt).toBe(esperado);
    expect(a.origin).toEqual({
      kind: 'template', templateId: modelo, templateRevision: rev, templateSha256: sha256(molde),
      answered: ['[Nome da empresa]'], promptSha256: sha256(esperado),
    });
    // Chamada direta com outras respostas: outro texto, e o sha gravado sempre bate com o texto gravado.
    const outro = await doModelo(agencia, orgA, modelo, rev, { '[Nome da empresa]': 'Casa Lua' });
    const b = await agente(outro.data as string);
    expect(b.draft.prompt).toBe('Oi Casa Lua, abrimos [Horário]. Fale com Casa Lua. {{contactName}}');
    expect(b.origin.promptSha256).toBe(sha256(b.draft.prompt));
  });

  it('5. concorrência no modelo: revisão velha recusada ao criar, salvar, arquivar; a trava espera e relê', async () => {
    const { out_id: modelo, out_revision: rev1 } = await novoModelo('Oi [Nome]');
    const salvar = (revisao: number, prompt: string) =>
      agencia.rpc('save_ai_agent_template', { p_template_id: modelo, p_expected_revision: revisao, p_name: 'M', p_description: null, p_prompt: prompt });
    const s1 = await salvar(rev1, 'Oi [Nome], tudo bem?');
    expect(s1.error).toBeNull();
    const rev2 = (s1.data as Array<{ out_revision: number }>)[0].out_revision;
    expect(rev2).toBe(rev1 + 1);
    expect(nomeDoErro((await salvar(rev1, 'outra aba')).error)).toBe('modelo_mudou');
    expect(nomeDoErro((await doModelo(agencia, orgA, modelo, rev1, {})).error)).toBe('modelo_mudou');

    // A trava: outra sessão segura a linha e sobe a revisão; o salvar espera e, ao seguir, relê e recusa.
    const dona = await sessaoPg();
    try {
      await dona.query('begin');
      await dona.query('select 1 from public.ai_agent_templates where id = $1 for update', [modelo]);
      const pendente = salvar(rev2, 'Oi [Nome], de novo').then((r) => r);
      await esperarBloqueadoPor(dona, 'save_ai_agent_template');
      await dona.query('update public.ai_agent_templates set revision = revision + 1 where id = $1', [modelo]);
      await dona.query('commit');
      expect(nomeDoErro((await pendente).error)).toBe('modelo_mudou');
    } finally {
      await dona.end();
    }
    const rev3 = rev2 + 1;
    const arquivar = (arquivo: boolean, revisao: number) =>
      agencia.rpc('set_ai_agent_template_archived', { p_template_id: modelo, p_archived: arquivo, p_expected_revision: revisao });
    expect(nomeDoErro((await arquivar(true, rev2)).error)).toBe('modelo_mudou');
    const arq = await arquivar(true, rev3);
    expect(arq.error).toBeNull();
    expect(arq.data).toBe(rev3 + 1);
    expect(nomeDoErro((await arquivar(true, rev3 + 1)).error)).toBe('sem_mudancas');
    expect(nomeDoErro((await doModelo(agencia, orgA, modelo, rev3 + 1, {})).error)).toBe('modelo_arquivado');
    expect(nomeDoErro((await salvar(rev3 + 1, 'x')).error)).toBe('modelo_arquivado');
    const restaurado = await arquivar(false, rev3 + 1);
    expect(restaurado.data).toBe(rev3 + 2);
  });

  it('6. ordem: modelo mudado entre a leitura e o envio dá modelo_mudou, nunca lacuna_inexistente', async () => {
    const { out_id: modelo, out_revision: rev } = await novoModelo('Oi [Nome antigo]');
    const s = await agencia.rpc('save_ai_agent_template', {
      p_template_id: modelo, p_expected_revision: rev, p_name: 'M', p_description: null, p_prompt: 'Oi [Nome novo]',
    });
    expect(s.error).toBeNull();
    expect(nomeDoErro((await doModelo(agencia, orgA, modelo, rev, { '[Nome antigo]': 'Ana' })).error)).toBe('modelo_mudou');
    expect(nomeDoErro((await doModelo(agencia, orgA, modelo, rev + 1, { '[Nome antigo]': 'Ana' })).error)).toBe('lacuna_inexistente');
  });

  it('7. bordas: o valor não forma marcador nem lacuna nova, e o resultado é conferido com repetição', async () => {
    const antes = await contar();
    const chave = await novoModelo('{[Campo]contactName}}');
    expect(nomeDoErro((await doModelo(agencia, orgA, chave.out_id, chave.out_revision, { '[Campo]': '{' })).error)).toBe('respostas_invalidas');
    // Sem caractere proibido no valor, quem pega é a conferência do RESULTADO: "[[Nome]] e [Cliente]" respondendo
    // "Cliente" viraria "[Cliente] e [Cliente]", duas ocorrências onde o esperado é uma (com lista distinta passaria).
    const colchete = await novoModelo('[[Nome]] e [Cliente]');
    expect(nomeDoErro((await doModelo(agencia, orgA, colchete.out_id, colchete.out_revision, { '[Nome]': 'Cliente' })).error)).toBe('lacuna_invalida');
    expect(nomeDoErro((await doModelo(agencia, orgA, colchete.out_id, colchete.out_revision, { '[Nome]': 'x'.repeat(501) })).error)).toBe('respostas_invalidas');
    expect(nomeDoErro((await doModelo(agencia, orgA, colchete.out_id, colchete.out_revision, { '[Nome]': 7 })).error)).toBe('respostas_invalidas');
    expect(await contar()).toEqual({ ...antes, modelos: (antes.modelos ?? 0) + 2 });

    const literal = await novoModelo('Valor: [Valor] e [Valor].');
    const r = await doModelo(agencia, orgA, literal.out_id, literal.out_revision, { '[Valor]': '$& e $1' });
    expect(r.error).toBeNull();
    expect((await agente(r.data as string)).draft.prompt).toBe('Valor: $& e $1 e $& e $1.');
  });

  it('8. ambiguidade: lacuna respondida que também é rótulo de link (parêntese ou colchete) é recusada', async () => {
    const parentese = await novoModelo('[Nome] e o link [Nome](https://x)');
    expect(nomeDoErro((await doModelo(agencia, orgA, parentese.out_id, parentese.out_revision, { '[Nome]': 'Ana' })).error)).toBe('lacuna_ambigua');
    const intacto = await doModelo(agencia, orgA, parentese.out_id, parentese.out_revision, {});
    expect(intacto.error).toBeNull();
    expect((await agente(intacto.data as string)).draft.prompt).toBe('[Nome] e o link [Nome](https://x)');
    const ref = await novoModelo('[Nome] e o link [Nome][ref]');
    expect(nomeDoErro((await doModelo(agencia, orgA, ref.out_id, ref.out_revision, { '[Nome]': 'Ana' })).error)).toBe('lacuna_ambigua');
  });

  it('9. cópia: texto igual ao da versão publicada de origem, de outro cliente; recusas por organização, versão e variável', async () => {
    const textoOrigem = `Texto publicado no cliente B ${randomUUID()}`;
    const fonte = await agentePublicado(orgB, textoOrigem);
    const r = await daCopia(agencia, orgA, orgB, fonte, 1, 'Copia da B');
    expect(r.error).toBeNull();
    const a = await agente(r.data as string);
    expect(a.organization_id).toBe(orgA);
    expect(a.draft.prompt).toBe(textoOrigem);
    expect(a.origin).toEqual({
      kind: 'copy', organizationId: orgB, agentId: fonte, version: 1, sha256: sha256(textoOrigem), promptSha256: sha256(textoOrigem),
    });
    const antes = await contar();
    expect(nomeDoErro((await daCopia(agencia, orgA, orgA, fonte, 1)).error)).toBe('agente_inexistente');
    expect(nomeDoErro((await daCopia(agencia, orgA, orgB, fonte, 2)).error)).toBe('versao_publicada_mudou');
    const semVersao = await blank(agencia, orgB, 'Sem versao publicada');
    expect(nomeDoErro((await daCopia(agencia, orgA, orgB, semVersao.data as string, 1)).error)).toBe('sem_versao_publicada');
    const antiga = await agentePublicado(orgB, `Oi {{variavelAntiga}} ${randomUUID()}`);
    expect(nomeDoErro((await daCopia(agencia, orgA, orgB, antiga, 1)).error)).toBe('variavel_desconhecida');
    // o agente sem versão e o antigo entram na contagem; nenhuma cópia recusada criou linha
    expect(await contar()).toEqual({ ...antes, agentes: (antes.agentes ?? 0) + 2, versoes: (antes.versoes ?? 0) + 1 });
  });

  it('10. modelo a partir de agente: copia a versão publicada, com as mesmas recusas', async () => {
    const texto = `Agente que vira modelo ${randomUUID()} [Nome da empresa]`;
    const fonte = await agentePublicado(orgB, texto);
    const r = await agencia.rpc('create_ai_agent_template_from_agent', {
      p_organization_id: orgB, p_agent_id: fonte, p_expected_version: 1, p_name: ' Modelo da B ', p_description: '  ',
    });
    expect(r.error).toBeNull();
    modelos.push(r.data as string);
    const t = await getSupabaseAdminClient().from('ai_agent_templates').select('name, description, prompt, origin, revision, created_by').eq('id', r.data as string).single();
    expect(t.data).toEqual({
      name: 'Modelo da B', description: null, prompt: texto, revision: 1, created_by: idAgencia,
      origin: { kind: 'agent', organizationId: orgB, agentId: fonte, version: 1, sha256: sha256(texto) },
    });
    const daAgencia = (org: string, agenteId: string, versao: number) =>
      agencia.rpc('create_ai_agent_template_from_agent', { p_organization_id: org, p_agent_id: agenteId, p_expected_version: versao, p_name: 'X', p_description: null });
    expect(nomeDoErro((await daAgencia(orgA, fonte, 1)).error)).toBe('agente_inexistente');
    expect(nomeDoErro((await daAgencia(orgB, fonte, 2)).error)).toBe('versao_publicada_mudou');
    const antiga = await agentePublicado(orgB, `Oi {{variavelAntiga}} ${randomUUID()}`);
    expect(nomeDoErro((await daAgencia(orgB, antiga, 1)).error)).toBe('variavel_desconhecida');
  });

  it('11. paridade: as ocorrências de lacuna do banco são as do TypeScript, com repetição e ordem', async () => {
    const exemplos = [
      'Oi, [Nome da empresa]. Atendemos [Horário] e [Nome da empresa].',
      '[Guia](https://x) [Guia][ref] [minuscula] [] [X]',
      'Ligue para [Telefone] e fale com [Ana].',
      '[Nome] e o link [Nome](https://x)',
      '[Nome] e o link [Nome][ref]',
      '[Tres] [Tres] [Tres]',
      '[Á vista] e [Ébano]',
      `[Nome${NL}]`,
      '[Nome][x]',
      '[A]',
      '[[Nome]] e [Cliente]',
      `[A${'b'.repeat(80)}]`,
      `[A${'b'.repeat(81)}]`,
    ];
    const pg = await sessaoPg();
    try {
      let comLacuna = 0;
      let comRepeticao = 0;
      for (const texto of exemplos) {
        const r = await pg.query('select public.central_agentes_lacunas($1) as l', [texto]);
        const ts = ocorrenciasDeLacunas(texto);
        expect(r.rows[0].l, texto).toEqual(ts);
        if (ts.length > 0) comLacuna += 1;
        if (new Set(ts).size < ts.length) comRepeticao += 1;
      }
      // Caso positivo: a paridade não pode passar com as duas listas vazias.
      expect(comLacuna).toBeGreaterThanOrEqual(3);
      expect(comRepeticao).toBeGreaterThanOrEqual(1);
    } finally {
      await pg.end();
    }
  });

  it('12. salvar modelo: cria com origem blank, valida nome, descrição, texto e variável, e sobe a revisão', async () => {
    const antes = await contar();
    const salvar = (p: Record<string, unknown>) =>
      agencia.rpc('save_ai_agent_template', { p_template_id: null, p_expected_revision: null, p_name: 'M', p_description: null, p_prompt: 'Oi', ...p });
    expect(nomeDoErro((await salvar({ p_name: '' })).error)).toBe('nome_invalido');
    expect(nomeDoErro((await salvar({ p_description: 'd'.repeat(281) })).error)).toBe('descricao_invalida');
    expect(nomeDoErro((await salvar({ p_prompt: '' })).error)).toBe('prompt_invalido');
    expect(nomeDoErro((await salvar({ p_prompt: 'Oi {{naoExiste}}' })).error)).toBe('variavel_desconhecida');
    expect(nomeDoErro((await agencia.rpc('save_ai_agent_template', {
      p_template_id: randomUUID(), p_expected_revision: 1, p_name: 'M', p_description: null, p_prompt: 'Oi',
    })).error)).toBe('modelo_inexistente');
    expect(await contar()).toEqual(antes);
    const novo = await novoModelo('Oi [Nome]', 'Com origem');
    const t = await getSupabaseAdminClient().from('ai_agent_templates').select('origin, revision').eq('id', novo.out_id).single();
    expect(t.data).toEqual({ origin: { kind: 'blank' }, revision: 1 });
  });
});
