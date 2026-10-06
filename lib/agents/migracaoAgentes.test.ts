// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';
import type { PublicacaoNoAr } from './publicacaoVercel';
import {
  criarAgentes,
  desligarConexao,
  lerAgenteDaConexao,
  ligarComConferencia,
  ligarConexao,
  planejarMigracao,
  sha256Hex,
  ultimaRespostaNativa,
} from './migracaoAgentes';

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA = '99999999-9999-4999-8999-999999999999';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
const TEXTO_AURORA = getPromptCatalogMap()[AURORA].defaultTemplate;
const SHA_AURORA = sha256Hex(TEXTO_AURORA);
const PUBLICACAO = 'a'.repeat(40);
const DEPLOYMENT = 'dpl_ativo1';
/** O que os domínios servem, como `lerPublicacaoNoAr` devolve (commit e deployment). */
const NO_AR_ID = { commit: PUBLICACAO, deploymentId: DEPLOYMENT };
const ENTREGUE_EM = '2026-09-30T11:00:00+00:00';

function conexao(id: string, org: string, config: Record<string, unknown>, aiAgentId: string | null = null) {
  return { id, organization_id: org, name: `Numero ${id}`, provider: 'evolution', channel_type: 'whatsapp', config, ai_agent_id: aiAgentId };
}

type Evento = { sha: string; chave?: string; origem?: string; publicacao?: string | null; deployment?: string | null };

/** O último evento de prova de cada número, como a função do banco devolveria. */
function comEventos(admin: FakeSupabaseAdmin, porNumero: Record<string, Evento>) {
  admin.rpcResults.central_agentes_ultima_resposta_nativa = (args: Record<string, unknown>) => {
    const e = porNumero[String(args.p_connection_id)];
    return e
      ? [{
        out_sha256: e.sha,
        out_prompt_key: e.chave ?? AURORA,
        out_prompt_source: e.origem ?? 'default',
        out_release_commit: e.publicacao === undefined ? PUBLICACAO : e.publicacao,
        out_release_deployment: e.deployment === undefined ? DEPLOYMENT : e.deployment,
        out_delivered_at: ENTREGUE_EM,
      }]
      : [];
  };
  return admin;
}

describe('prova contra a produção', () => {
  it('lê sha, chave, origem, publicação e hora da entrega pela função do banco', async () => {
    const admin = comEventos(createFakeSupabaseAdmin(), { c1: { sha: 'b'.repeat(64) } });
    expect(await ultimaRespostaNativa(admin as never, { id: 'c1' })).toEqual({
      sha256: 'b'.repeat(64), promptKey: AURORA, promptSource: 'default', releaseCommit: PUBLICACAO, releaseDeployment: DEPLOYMENT, deliveredAt: ENTREGUE_EM,
    });
    expect(admin.rpcCalls).toEqual([{ name: 'central_agentes_ultima_resposta_nativa', args: { p_connection_id: 'c1' } }]);
  });

  it('sem evento devolve null', async () => {
    expect(await ultimaRespostaNativa(comEventos(createFakeSupabaseAdmin(), {}) as never, { id: 'c1' })).toBeNull();
  });

  it('erro da função aborta em vez de devolver vazio', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.rpcErrors.central_agentes_ultima_resposta_nativa = 'boom';
    await expect(ultimaRespostaNativa(admin as never, { id: 'c1' })).rejects.toThrow('boom');
  });
});

describe('migração do prompt de hoje para agentes', () => {
  it('agrupa por organização e prompt, e marca cada número com a situação na produção', async () => {
    const admin = comEventos(createFakeSupabaseAdmin({
      channel_connections: [
        conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA, aiAgentName: 'Aurora' }),
        conexao('c2', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c3', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c4', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c5', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c6', OUTRA, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c7', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c8', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
      ],
    }), {
      c1: { sha: SHA_AURORA },
      c2: { sha: 'f'.repeat(64) },
      c3: { sha: SHA_AURORA, chave: PADRAO },
      c4: { sha: SHA_AURORA, publicacao: 'b'.repeat(40) },
      c5: { sha: SHA_AURORA, publicacao: null },
      // Mesmo sha, mas aquela resposta saiu de um override: não prova o texto padrão de hoje.
      c7: { sha: SHA_AURORA, origem: 'override' },
      // Mesmo commit, outro deployment (redeploy, que pode ter outras variáveis): outra publicação.
      c8: { sha: SHA_AURORA, deployment: 'dpl_redeploy2' },
    });
    const plano = await planejarMigracao(admin as never, { publicacao: NO_AR_ID });
    expect(plano.grupos).toHaveLength(2);
    const doOrg = plano.grupos.find((g) => g.organizationId === ORG)!;
    expect(doOrg).toMatchObject({ promptKey: AURORA, promptSource: 'default', sha256: SHA_AURORA, nome: 'Aurora', pronto: false });
    expect(doOrg.conexoes).toEqual([
      { id: 'c1', name: 'Numero c1', situacao: 'CONFERE', respostaEm: ENTREGUE_EM },
      { id: 'c2', name: 'Numero c2', situacao: 'DIVERGE', respostaEm: ENTREGUE_EM },
      { id: 'c3', name: 'Numero c3', situacao: 'CHAVE_DIVERGE', respostaEm: ENTREGUE_EM },
      { id: 'c4', name: 'Numero c4', situacao: 'PUBLICACAO_DIVERGE', respostaEm: ENTREGUE_EM },
      { id: 'c5', name: 'Numero c5', situacao: 'PUBLICACAO_DIVERGE', respostaEm: ENTREGUE_EM },
      { id: 'c7', name: 'Numero c7', situacao: 'DIVERGE', respostaEm: ENTREGUE_EM },
      { id: 'c8', name: 'Numero c8', situacao: 'PUBLICACAO_DIVERGE', respostaEm: ENTREGUE_EM },
    ]);
    const daOutra = plano.grupos.find((g) => g.organizationId === OUTRA)!;
    expect(daOutra.conexoes[0]).toMatchObject({ situacao: 'SEM_RESPOSTA_AINDA', respostaEm: null });
  });

  it('com todos os números em CONFERE o grupo fica pronto', async () => {
    const admin = comEventos(createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
    }), { c1: { sha: SHA_AURORA } });
    const plano = await planejarMigracao(admin as never, { publicacao: NO_AR_ID });
    expect(plano.grupos[0]).toMatchObject({ pronto: true });
  });

  it('ignora número já ligado, sem IA e com chave inválida; --incluir força o sem IA', async () => {
    const admin = createFakeSupabaseAdmin({
      channel_connections: [
        conexao('ligada', ORG, { aiEnabled: true, aiPromptKey: AURORA }, 'agente-x'),
        conexao('sem-ia', ORG, { aiEnabled: false }),
        conexao('invalida', ORG, { aiEnabled: true, aiPromptKey: 'chave_invalida' }),
      ],
    });
    const plano = await planejarMigracao(admin as never, { publicacao: NO_AR_ID });
    expect(plano.grupos).toHaveLength(0);
    expect(plano.ignoradas.map((i) => [i.id, i.motivo])).toEqual([
      ['invalida', 'chave_invalida'],
      ['ligada', 'ja_ligada'],
      ['sem-ia', 'sem_ia'],
    ]);
    const forcado = await planejarMigracao(admin as never, { incluir: ['sem-ia'], publicacao: NO_AR_ID });
    expect(forcado.grupos.map((g) => g.conexoes[0].id)).toEqual(['sem-ia']);
  });

  it('erro ao ler o override aborta o plano (nunca cai no catálogo)', async () => {
    const admin = createFakeSupabaseAdmin({ channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })] });
    admin.failOn('ai_prompt_templates', 'select', 'boom');
    await expect(planejarMigracao(admin as never, { publicacao: NO_AR_ID })).rejects.toThrow('boom');
  });

  it('lê todas as conexões, em páginas, acima do limite de linhas do PostgREST', async () => {
    const conexoes = Array.from({ length: 1001 }, (_, i) => conexao(`c${String(i).padStart(4, '0')}`, ORG, { aiEnabled: false }));
    const admin = createFakeSupabaseAdmin({ channel_connections: conexoes }, { maxLinhas: 1000 });
    const plano = await planejarMigracao(admin as never, { publicacao: NO_AR_ID });
    expect(plano.ignoradas).toHaveLength(1001);
  });

  it('criarAgentes só cria grupo pronto, só da organização pedida, com o sha do próprio conteúdo', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.rpcResults.create_ai_agent_from_legacy_prompt = [{ out_agent_id: 'a1', out_version_id: 'v1', out_created: true }];
    const pronto = {
      organizationId: ORG, promptKey: AURORA, promptSource: 'default' as const, conteudo: 'X', sha256: sha256Hex('X'), nome: 'Aurora', pronto: true,
      conexoes: [{ id: 'c1', name: 'n', situacao: 'CONFERE' as const, respostaEm: ENTREGUE_EM }],
    };
    const naoPronto = {
      ...pronto, conteudo: 'Y', sha256: sha256Hex('Y'), pronto: false,
      conexoes: [{ id: 'c2', name: 'm', situacao: 'DIVERGE' as const, respostaEm: ENTREGUE_EM }],
    };

    const r = await criarAgentes(admin as never, { organizationId: ORG, grupos: [pronto, naoPronto], catalogCommit: 'abc1234' });
    expect(r.criados).toEqual([{ organizationId: ORG, agentId: 'a1', criado: true }]);
    expect(r.pulados).toEqual([{ sha256: sha256Hex('Y'), conexoes: ['c2:DIVERGE'] }]);
    expect(admin.rpcCalls).toEqual([{
      name: 'create_ai_agent_from_legacy_prompt',
      args: {
        p_organization_id: ORG,
        p_name: 'Aurora',
        p_prompt: 'X',
        p_origin: { sha256: sha256Hex('X'), promptKey: AURORA, promptSource: 'default', conexoes: ['c1'], catalogCommit: 'abc1234' },
      },
    }]);

    await expect(criarAgentes(admin as never, { organizationId: OUTRA, grupos: [pronto], catalogCommit: null }))
      .rejects.toThrow('outra organizacao');
  });

  it('ligarConexao acha o agente no banco e manda para a função a chave bruta, a efetiva, a origem, o sha e a publicação', async () => {
    const semear = () => createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
      ai_agents: [
        { id: 'a1', organization_id: ORG, published_version_id: 'v1', origin: { kind: 'migration', sha256: SHA_AURORA } },
        { id: 'a2', organization_id: ORG, published_version_id: 'v2', origin: { kind: 'migration', sha256: 'f'.repeat(64) } },
      ],
    });

    const certo = semear();
    certo.rpcResults.central_agentes_ligar_conexao = 'ligado';
    expect(await ligarConexao(certo as never, 'c1', { publicacao: NO_AR_ID })).toEqual({ ok: true, agentId: 'a1' });
    expect(certo.rpcCalls).toEqual([{
      name: 'central_agentes_ligar_conexao',
      args: { p_connection_id: 'c1', p_agent_id: 'a1', p_chave_bruta: AURORA, p_prompt_key: AURORA, p_prompt_source: 'default', p_sha256: SHA_AURORA, p_publicacao: PUBLICACAO, p_deployment: DEPLOYMENT },
    }]);

    const recusado = semear();
    recusado.rpcResults.central_agentes_ligar_conexao = 'publicacao_diverge';
    expect(await ligarConexao(recusado as never, 'c1', { publicacao: NO_AR_ID })).toEqual({ ok: false, motivo: 'publicacao_diverge' });

    // A chamada falhou sem resposta do banco: o resultado diz qual agente estava sendo ligado, para quem
    // chamou conferir a linha (a transação pode ter sido gravada antes de a resposta se perder).
    const semResposta = semear();
    semResposta.rpcErrors.central_agentes_ligar_conexao = 'fetch failed';
    expect(await ligarConexao(semResposta as never, 'c1', { publicacao: NO_AR_ID }))
      .toEqual({ ok: false, motivo: 'chamada_falhou', agentId: 'a1', detalhe: 'fetch failed' });
    // Resposta sem o resultado da função também não prova nada.
    const vazia = semear();
    expect(await ligarConexao(vazia as never, 'c1', { publicacao: NO_AR_ID }))
      .toMatchObject({ ok: false, motivo: 'chamada_falhou', agentId: 'a1' });
  });

  it('ligarConexao sem agente criado para aquele sha não chama a função', async () => {
    const admin = createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
      ai_agents: [{ id: 'a2', organization_id: ORG, published_version_id: 'v2', origin: { kind: 'migration', sha256: 'f'.repeat(64) } }],
    });
    expect(await ligarConexao(admin as never, 'c1', { publicacao: NO_AR_ID })).toEqual({ ok: false, motivo: 'agente_nao_criado' });
    expect(admin.rpcCalls).toEqual([]);
  });

  it('desligarConexao confirma a linha desligada e distingue número inexistente', async () => {
    const admin = createFakeSupabaseAdmin({ channel_connections: [conexao('c1', ORG, { aiEnabled: true }, 'a1')] });
    expect(await desligarConexao(admin as never, 'c1')).toEqual({ ok: true });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
    expect(await desligarConexao(admin as never, 'nao-existe')).toEqual({ ok: false, detalhe: 'conexao_inexistente' });
  });

  it('desligarConexao condicionado só desliga se o número ainda está com AQUELE agente', async () => {
    const admin = createFakeSupabaseAdmin({ channel_connections: [conexao('c1', ORG, { aiEnabled: true }, 'outro-agente')] });
    expect(await desligarConexao(admin as never, 'c1', { seAgente: 'a1' })).toEqual({ ok: false, detalhe: 'nao_estava_com_esse_agente' });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBe('outro-agente');
    expect(await lerAgenteDaConexao(admin as never, 'c1')).toEqual({ existe: true, agentId: 'outro-agente' });
    expect(await lerAgenteDaConexao(admin as never, 'nao-existe')).toEqual({ existe: false, agentId: null });
  });
});

describe('ligar com conferência da publicação antes e depois (3ª rodada do Codex, achado 3; 4ª rodada, achados 10 e 12)', () => {
  const NO_AR: PublicacaoNoAr = { ok: true, commit: PUBLICACAO, deploymentId: 'dpl_1', criadoEm: 1 };

  /** Número pronto para ligar; a função do banco falsa liga de verdade a linha, como a real. */
  function pronto() {
    const admin = createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
      ai_agents: [{ id: 'a1', organization_id: ORG, published_version_id: 'v1', origin: { kind: 'migration', sha256: SHA_AURORA } }],
    });
    admin.rpcResults.central_agentes_ligar_conexao = (args: Record<string, unknown>) => {
      admin.tables.channel_connections[0].ai_agent_id = args.p_agent_id;
      return 'ligado';
    };
    return admin;
  }

  /** Leituras da publicação em sequência; uma função na fila é chamada (para lançar, ou mexer na linha antes). */
  function publicacoes(...fila: Array<PublicacaoNoAr | (() => PublicacaoNoAr)>) {
    let i = 0;
    return async () => {
      const proxima = fila[Math.min(i++, fila.length - 1)];
      return typeof proxima === 'function' ? proxima() : proxima;
    };
  }

  it('publicação igual antes e depois: fica ligado', async () => {
    const admin = pronto();
    expect(await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR, NO_AR), PUBLICACAO))
      .toEqual({ estado: 'ligado', agentId: 'a1', publicacao: { commit: PUBLICACAO, deploymentId: 'dpl_1' } });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBe('a1');
  });

  it('publicação que não confere ANTES: nem chama o banco', async () => {
    const admin = pronto();
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes({ ok: false, motivo: 'em_transicao', detalhe: 'dpl_2 BUILDING' }), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'nao_ligou' });
    const outra = await ligarComConferencia(admin as never, 'c1', publicacoes({ ...NO_AR, commit: 'b'.repeat(40) }), PUBLICACAO);
    expect(outra).toMatchObject({ estado: 'nao_ligou' });
    expect(admin.rpcCalls).toEqual([]);
  });

  it('a leitura depois de ligar LANÇA (rede, 500): a ligação é desfeita e a linha conferida', async () => {
    const admin = pronto();
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR, () => { throw new Error('Vercel /v4/aliases respondeu 500'); }), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'desfeito', agentId: 'a1' });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
  });

  it('a publicação mudou (commit ou deployment), ou ficou inconclusiva, depois de ligar: desfaz', async () => {
    const mudancas: PublicacaoNoAr[] = [
      { ...NO_AR, commit: 'b'.repeat(40) },
      // Mesmo commit, outro deployment: um redeploy pode ter outras variáveis (4ª rodada, achado 12).
      { ...NO_AR, deploymentId: 'dpl_2' },
      { ok: false, motivo: 'mais_novo_nao_servido', detalhe: 'dpl_2' },
    ];
    for (const depois of mudancas) {
      const admin = pronto();
      const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR, depois), PUBLICACAO);
      expect(r).toMatchObject({ estado: 'desfeito', agentId: 'a1' });
      expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
    }
  });

  it('não deu para desfazer: devolve INCERTO, nunca "desfeito"', async () => {
    const admin = pronto();
    const leitura = publicacoes(NO_AR, () => { throw new Error('rede'); });
    const original = admin.rpcResults.central_agentes_ligar_conexao as (a: Record<string, unknown>) => unknown;
    admin.rpcResults.central_agentes_ligar_conexao = (args: Record<string, unknown>) => {
      const saida = original(args);
      admin.failOn('channel_connections', 'update', 'boom');
      return saida;
    };
    const r = await ligarComConferencia(admin as never, 'c1', leitura, PUBLICACAO);
    expect(r).toMatchObject({ estado: 'incerto', agentId: 'a1' });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBe('a1');
  });

  it('alguém ligou o número a OUTRO agente antes da conferência: LIGADO A OUTRO, com o agente atual, e a ligação dele fica', async () => {
    const admin = pronto();
    const leitura = publicacoes(NO_AR, () => {
      // Entre a nossa ligação e a conferência, alguém ligou o número a OUTRO agente.
      admin.tables.channel_connections[0].ai_agent_id = 'agente-de-outra-pessoa';
      throw new Error('rede');
    });
    const r = await ligarComConferencia(admin as never, 'c1', leitura, PUBLICACAO);
    // Não é "desfeito": o número continua respondendo, com o agente de outra pessoa (4ª rodada, achado 10).
    expect(r).toMatchObject({ estado: 'ligado_a_outro', agentId: 'a1', agenteAtual: 'agente-de-outra-pessoa' });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBe('agente-de-outra-pessoa');
  });

  it('a chamada de ligação falha DEPOIS de o banco gravar (resposta perdida): desfaz e confere a linha', async () => {
    const admin = pronto();
    admin.rpcResults.central_agentes_ligar_conexao = (args: Record<string, unknown>) => {
      admin.tables.channel_connections[0].ai_agent_id = args.p_agent_id;
      throw new Error('fetch failed');
    };
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'desfeito', agentId: 'a1' });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
  });

  it('a chamada de ligação devolve erro SEM gravar (deadlock, por exemplo): não ligou, com a linha conferida', async () => {
    const admin = pronto();
    admin.rpcErrors.central_agentes_ligar_conexao = 'deadlock detected';
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'nao_ligou', motivo: expect.stringContaining('deadlock detected') });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
  });

  it('a chamada de ligação falha e a linha não pode ser lida: INCERTO', async () => {
    const admin = pronto();
    admin.rpcResults.central_agentes_ligar_conexao = () => {
      admin.failOn('channel_connections', 'select', 'sem rede');
      throw new Error('fetch failed');
    };
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'incerto', agentId: 'a1' });
  });

  it('a chamada de ligação falha e a linha mostra OUTRO agente: LIGADO A OUTRO, sem mexer na ligação dele', async () => {
    const admin = pronto();
    admin.rpcResults.central_agentes_ligar_conexao = () => {
      admin.tables.channel_connections[0].ai_agent_id = 'agente-de-outra-pessoa';
      throw new Error('fetch failed');
    };
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR), PUBLICACAO);
    expect(r).toEqual({
      estado: 'ligado_a_outro',
      agentId: 'a1',
      agenteAtual: 'agente-de-outra-pessoa',
      motivo: expect.stringContaining('fetch failed'),
    });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBe('agente-de-outra-pessoa');
  });

  it('publicação confirmada, mas a linha mostra OUTRO agente no fim: LIGADO A OUTRO, nunca "ligado"', async () => {
    const admin = pronto();
    const leitura = publicacoes(NO_AR, () => {
      admin.tables.channel_connections[0].ai_agent_id = 'agente-de-outra-pessoa';
      return NO_AR;
    });
    const r = await ligarComConferencia(admin as never, 'c1', leitura, PUBLICACAO);
    expect(r).toMatchObject({ estado: 'ligado_a_outro', agentId: 'a1', agenteAtual: 'agente-de-outra-pessoa' });
  });

  it('publicação confirmada, mas a linha não pode ser relida: INCERTO, nunca "ligado"', async () => {
    const admin = pronto();
    const leitura = publicacoes(NO_AR, () => {
      admin.failOn('channel_connections', 'select', 'sem rede');
      return NO_AR;
    });
    const r = await ligarComConferencia(admin as never, 'c1', leitura, PUBLICACAO);
    expect(r).toMatchObject({ estado: 'incerto', agentId: 'a1' });
  });

  it('publicação confirmada, mas o número foi APAGADO durante a conferência: conexao_inexistente, não "desfeito"', async () => {
    // 5ª rodada do Codex, achado 6: linha ausente não é "linha sem agente".
    const admin = pronto();
    const leitura = publicacoes(NO_AR, () => {
      admin.tables.channel_connections.length = 0;
      return NO_AR;
    });
    const r = await ligarComConferencia(admin as never, 'c1', leitura, PUBLICACAO);
    expect(r).toEqual({ estado: 'conexao_inexistente', agentId: 'a1', motivo: 'o numero foi apagado durante a conferencia' });
  });

  it('a chamada de ligação falha e o número já não existe: conexao_inexistente, não "não ligou"', async () => {
    const admin = pronto();
    admin.rpcResults.central_agentes_ligar_conexao = () => {
      admin.tables.channel_connections.length = 0;
      throw new Error('fetch failed');
    };
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'conexao_inexistente', agentId: 'a1', motivo: expect.stringContaining('o numero nao existe mais') });
  });
});
