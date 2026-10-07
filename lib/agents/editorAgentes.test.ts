// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { lerAgente, listarVersoes, publicarComVerificacao, restaurarVersao, salvarRascunho, traduzirErroDoBanco } from './editorAgentes';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE = '22222222-2222-4222-8222-222222222222';
const V1 = '33333333-3333-4333-8333-333333333333';
const PUBLICADO = 'Voce e a Aurora. {{contactName}}\n{{conversationStageContext}}\n- replyText: resposta curta';

type Linha = Record<string, unknown>;

/** Compara número com número e o resto como texto (ids e datas ISO), como o Postgres ordena uuid e timestamptz. */
const comparar = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
/** O PostgREST corta toda resposta em 1000 linhas, sem erro. O banco falso corta igual: sem isso, um teste de
 * paginação passa até com leitura única e não prova nada. */
const CORTE_DO_POSTGREST = 1000;

/** Banco em memória com o pedaço da API do supabase-js que a camada usa: select, eq, lt, gt, in, order, limit, maybeSingle, await. */
function fakeCliente(tabelas: Record<string, Linha[]>, rpc = vi.fn()) {
  return {
    rpc,
    from(tabela: string) {
      let linhas = [...(tabelas[tabela] ?? [])];
      const consulta = {
        select: () => consulta,
        eq: (coluna: string, valor: unknown) => {
          linhas = linhas.filter((l) => l[coluna] === valor);
          return consulta;
        },
        lt: (coluna: string, valor: unknown) => {
          linhas = linhas.filter((l) => comparar(l[coluna], valor) < 0);
          return consulta;
        },
        gt: (coluna: string, valor: unknown) => {
          linhas = linhas.filter((l) => comparar(l[coluna], valor) > 0);
          return consulta;
        },
        in: (coluna: string, valores: unknown[]) => {
          linhas = linhas.filter((l) => valores.includes(l[coluna]));
          return consulta;
        },
        order: (coluna: string, opcoes?: { ascending?: boolean }) => {
          const sinal = opcoes?.ascending === false ? -1 : 1;
          linhas.sort((a, b) => comparar(a[coluna], b[coluna]) * sinal);
          return consulta;
        },
        limit: (n: number) => {
          linhas = linhas.slice(0, n);
          return consulta;
        },
        maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
        then: (ok: (r: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
          Promise.resolve({ data: linhas.slice(0, CORTE_DO_POSTGREST), error: null }).then(ok, falhou),
      };
      return consulta;
    },
  } as unknown as SupabaseClient;
}

function cenario(rascunho: string | null, revisao = 1) {
  const rpc = vi.fn().mockResolvedValue({ data: [{ out_version: 2, out_version_id: 'v2' }], error: null });
  const usuario = fakeCliente({
    ai_agents: [{
      id: AGENTE, organization_id: TENANT, name: 'Aurora', published_version_id: V1,
      draft: rascunho === null ? {} : { prompt: rascunho }, draft_revision: revisao, draft_updated_at: null, draft_updated_by: null,
    }],
    ai_agent_versions: [{
      id: V1, agent_id: AGENTE, organization_id: TENANT, version: 1, prompt: PUBLICADO, settings: {}, model: null,
      source: 'migration', restored_from: null, note: null, published_at: '2026-10-07T04:51:00Z', published_by: null,
    }],
  }, rpc);
  const admin = fakeCliente({
    organizations: [{ id: TENANT, name: 'Cenno Hub' }],
    channel_connections: [{ id: 'n1', organization_id: TENANT, ai_agent_id: AGENTE, name: 'Comercial', config: { apiKey: 'NAO-PODE-SAIR' } }],
    profiles: [],
  });
  return { clientes: { usuario, admin }, rpc };
}

const pedido = (extra: Partial<Parameters<typeof publicarComVerificacao>[1]> = {}) => ({
  tenantId: TENANT, agentId: AGENTE, versaoEsperada: 1, revisao: 1, nota: null, confirmarAvisos: [], ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('traduzirErroDoBanco', () => {
  it.each([
    ['rascunho_mudou', 409, 'RASCUNHO_MUDOU'],
    ['versao_publicada_mudou', 409, 'VERSAO_PUBLICADA_MUDOU'],
    ['agente_inexistente', 404, 'AGENTE_INEXISTENTE'],
    ['versao_inexistente', 404, 'VERSAO_INEXISTENTE'],
    ['rascunho_vazio', 422, 'RASCUNHO_VAZIO'],
    ['sem_mudancas', 422, 'SEM_MUDANCAS'],
    ['versao_ja_publicada', 422, 'VERSAO_JA_PUBLICADA'],
    ['variavel_desconhecida', 422, 'VARIAVEL_DESCONHECIDA'],
    ['prompt_invalido', 400, 'PROMPT_INVALIDO'],
    ['nota_invalida', 400, 'NOTA_INVALIDA'],
    ['sem_permissao', 403, 'SEM_PERMISSAO'],
  ])('%s vira %i', (mensagem, status, codigo) => {
    expect(traduzirErroDoBanco({ code: 'P0001', message: mensagem }, 'teste')).toMatchObject({ ok: false, status, codigo });
  });

  it('42501 de privilégio do Postgres vira 403', () => {
    expect(traduzirErroDoBanco({ code: '42501', message: 'permission denied for function save_ai_agent_draft' }, 'teste'))
      .toMatchObject({ status: 403, codigo: 'SEM_PERMISSAO' });
  });

  it('erro sem nome vira 500 sem o detalhe para o navegador; o detalhe vai para o log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = traduzirErroDoBanco({ code: 'XX000', message: 'relation "x" does not exist' }, 'ler agente');
    expect(r).toMatchObject({ status: 500, codigo: 'ERRO_INTERNO' });
    expect(r.erro).not.toContain('relation');
    expect(log).toHaveBeenCalledWith('[central-agentes]', 'ler agente', { code: 'XX000', message: 'relation "x" does not exist' });
  });
});

describe('listarVersoes', () => {
  it('pagina da mais nova para a mais antiga: a primeira página diz que há mais, e antesDe traz o resto', async () => {
    const versoes = Array.from({ length: 55 }, (_, i) => ({
      id: `v${i + 1}`, agent_id: AGENTE, organization_id: TENANT, version: i + 1, prompt: PUBLICADO, settings: {}, model: null,
      source: i === 0 ? 'migration' : 'publish', restored_from: null, note: null, published_at: '2026-10-07T04:51:00Z', published_by: null,
    }));
    const clientes = {
      usuario: fakeCliente({ ai_agents: [{ id: AGENTE, organization_id: TENANT }], ai_agent_versions: versoes }),
      admin: fakeCliente({ profiles: [] }),
    };

    const primeira = await listarVersoes(clientes, TENANT, AGENTE);
    if (!primeira.ok) throw new Error(primeira.erro);
    expect(primeira.dados.versoes.map((v) => v.versao)).toEqual(Array.from({ length: 50 }, (_, i) => 55 - i));
    expect(primeira.dados.temMais).toBe(true);

    const segunda = await listarVersoes(clientes, TENANT, AGENTE, { antesDe: 6 });
    if (!segunda.ok) throw new Error(segunda.erro);
    expect(segunda.dados.versoes.map((v) => v.versao)).toEqual([5, 4, 3, 2, 1]);
    expect(segunda.dados.temMais).toBe(false);
  });
});

describe('lerAgente', () => {
  it('devolve o número sem a config dele', async () => {
    const { clientes } = cenario(null);
    const r = await lerAgente(clientes, TENANT, AGENTE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.numeros).toEqual([{ id: 'n1', nome: 'Comercial', temAgenda: false }]);
    expect(JSON.stringify(r)).not.toContain('NAO-PODE-SAIR');
    expect(r.dados.publicada).toMatchObject({ versao: 1, origem: 'migration', publicadaPor: null, prompt: PUBLICADO });
  });

  it('lê os números do agente em páginas: acima do corte de mil linhas do PostgREST, nenhum fica de fora', async () => {
    // Revisão do Codex, rodada 2: com leitura única, o editor mostraria 1000 números e calcularia o aviso de agenda
    // com a lista cortada. O banco falso corta em 1000 como o PostgREST, então este teste falha sem a paginação.
    const { clientes } = cenario(null);
    const muitos = Array.from({ length: 1203 }, (_, i) => ({
      id: `n${String(i).padStart(5, '0')}`, organization_id: TENANT, ai_agent_id: AGENTE, name: `N${i}`, config: {},
      created_at: `2026-10-0${1 + (i % 7)}T00:00:00Z`,
    }));
    const admin = fakeCliente({ organizations: [{ id: TENANT, name: 'Cenno Hub' }], channel_connections: muitos, profiles: [] });
    const r = await lerAgente({ ...clientes, admin }, TENANT, AGENTE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.numeros).toHaveLength(1203);
  });

  it('agente de outra organização é 404', async () => {
    const { clientes } = cenario(null);
    const outro = '44444444-4444-4444-8444-444444444444';
    expect(await lerAgente(clientes, TENANT, outro)).toMatchObject({ ok: false, status: 404, codigo: 'AGENTE_INEXISTENTE' });
  });
});

describe('publicarComVerificacao', () => {
  it('erro na verificação bloqueia: 422 com a verificação, sem chamar o banco', async () => {
    const { clientes, rpc } = cenario(`${PUBLICADO} {{nomeDoLead}}`);
    const r = await publicarComVerificacao(clientes, pedido());
    expect(r).toMatchObject({ ok: false, status: 422, codigo: 'VERIFICACAO_BLOQUEIA' });
    if (r.ok) return;
    expect(r.verificacao?.erros.map((e) => e.codigo)).toEqual(['variavel_desconhecida:nomeDoLead']);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('aviso só passa confirmado; confirmado, publica exatamente a versão e a revisão verificadas', async () => {
    const semNome = 'Voce e a Aurora.\n{{conversationStageContext}}\n- replyText: resposta curta';
    const { clientes, rpc } = cenario(semNome);

    const semConfirmar = await publicarComVerificacao(clientes, pedido());
    expect(semConfirmar).toMatchObject({ ok: false, status: 422, codigo: 'AVISOS_NAO_CONFIRMADOS' });
    if (semConfirmar.ok) return;
    expect(semConfirmar.verificacao?.avisos.map((a) => a.codigo)).toEqual(['perdeu:contactName']);
    expect(rpc).not.toHaveBeenCalled();

    const confirmado = await publicarComVerificacao(clientes, pedido({ nota: 'tirei o nome', confirmarAvisos: ['perdeu:contactName'] }));
    expect(confirmado).toEqual({ ok: true, dados: { versao: 2, versaoId: 'v2' } });
    expect(rpc).toHaveBeenCalledWith('publish_ai_agent_version', {
      p_organization_id: TENANT,
      p_agent_id: AGENTE,
      p_expected_version: 1,
      p_expected_revision: 1,
      p_note: 'tirei o nome',
    });
  });

  it('revisão ou versão diferente da que a tela mostrou: 409 antes de verificar', async () => {
    const { clientes, rpc } = cenario(`${PUBLICADO}\nmais`, 2);
    expect(await publicarComVerificacao(clientes, pedido({ revisao: 1 }))).toMatchObject({ status: 409, codigo: 'RASCUNHO_MUDOU' });
    expect(await publicarComVerificacao(clientes, pedido({ revisao: 2, versaoEsperada: 2 }))).toMatchObject({ status: 409, codigo: 'VERSAO_PUBLICADA_MUDOU' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sem rascunho: 422 RASCUNHO_VAZIO, sem chamar o banco', async () => {
    const { clientes, rpc } = cenario(null, 0);
    expect(await publicarComVerificacao(clientes, pedido({ revisao: 0 }))).toMatchObject({ status: 422, codigo: 'RASCUNHO_VAZIO' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('o banco recusou na hora (corrida): o erro com nome vira 409', async () => {
    const { clientes, rpc } = cenario(`${PUBLICADO}\nmais`);
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'versao_publicada_mudou' } });
    expect(await publicarComVerificacao(clientes, pedido())).toMatchObject({ status: 409, codigo: 'VERSAO_PUBLICADA_MUDOU' });
  });
});

describe('salvarRascunho e restaurarVersao', () => {
  it('salvar devolve a revisão nova; resposta sem número vira 500', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: 2, error: null }).mockResolvedValueOnce({ data: null, error: null });
    const usuario = fakeCliente({}, rpc);
    const clientes = { usuario, admin: fakeCliente({}) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await salvarRascunho(clientes, { tenantId: TENANT, agentId: AGENTE, revisao: 1, prompt: 'x' })).toEqual({ ok: true, dados: { revisao: 2 } });
    expect(rpc).toHaveBeenCalledWith('save_ai_agent_draft', { p_organization_id: TENANT, p_agent_id: AGENTE, p_expected_revision: 1, p_prompt: 'x' });
    expect(await salvarRascunho(clientes, { tenantId: TENANT, agentId: AGENTE, revisao: 1, prompt: 'x' })).toMatchObject({ status: 500 });
  });

  it('restaurar devolve versão, id e revisão novos', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ out_version: 3, out_version_id: 'v3', out_draft_revision: 2 }], error: null });
    const clientes = { usuario: fakeCliente({}, rpc), admin: fakeCliente({}) };
    expect(await restaurarVersao(clientes, { tenantId: TENANT, agentId: AGENTE, versao: 1, versaoEsperada: 2, revisao: 1, nota: null }))
      .toEqual({ ok: true, dados: { versao: 3, versaoId: 'v3', revisao: 2 } });
    expect(rpc).toHaveBeenCalledWith('restore_ai_agent_version', {
      p_organization_id: TENANT, p_agent_id: AGENTE, p_version: 1, p_expected_version: 2, p_expected_revision: 1, p_note: null,
    });
  });
});
