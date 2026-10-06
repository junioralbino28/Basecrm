// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { criarClienteVercel, lerPublicacaoNoAr, type AmbientePublicado, type ClienteVercel } from './publicacaoVercel';

const ATIVO = 'dpl_ativo';
const COMMIT = 'a'.repeat(40);
const PROJETO = 'prj_crm';
const DE_TESTE = ['teste.crm.exemplo.com'];
const DE_PRODUCAO = ['crm.exemplo.com', 'crm.outro.com.br'];
const TESTE: AmbientePublicado = { dominios: DE_TESTE, outrosDominiosDoProjeto: DE_PRODUCAO, ramo: 'feat/ensaio', projectId: PROJETO, producao: false };
const PRODUCAO: AmbientePublicado = { dominios: DE_PRODUCAO, outrosDominiosDoProjeto: DE_TESTE, ramo: 'main', projectId: PROJETO, producao: true };

type Deploy = {
  uid?: string; id?: string; projectId?: string; readyState: string; readySubstate?: string;
  target?: string | null; createdAt: number; meta?: Record<string, string>;
};

/** API falsa: domínios do projeto → alias (por domínio) → deployment ativo → lista do ramo. */
function api(opcoes: {
  ambiente?: AmbientePublicado;
  doProjeto?: Record<string, unknown>;
  alias?: Record<string, Record<string, unknown>>;
  ativo?: Partial<Deploy>;
  lista?: Deploy[];
} = {}): ClienteVercel {
  const ambiente = opcoes.ambiente ?? TESTE;
  const ativo: Deploy = {
    id: ATIVO,
    projectId: PROJETO,
    readyState: 'READY',
    readySubstate: ambiente.producao ? 'PROMOTED' : 'STAGED',
    target: ambiente.producao ? 'production' : null,
    createdAt: 1000,
    meta: { githubCommitSha: COMMIT, githubCommitRef: ambiente.ramo },
    ...opcoes.ativo,
  };
  return async (caminho) => {
    if (caminho === `/v9/projects/${PROJETO}/domains`) {
      return opcoes.doProjeto ?? { domains: [...DE_TESTE, ...DE_PRODUCAO].map((name) => ({ name, redirect: null })), pagination: { next: null } };
    }
    if (caminho.startsWith('/v4/aliases/')) {
      const dominio = decodeURIComponent(caminho.slice('/v4/aliases/'.length));
      return opcoes.alias?.[dominio] ?? { deploymentId: ATIVO, projectId: PROJETO, redirect: null };
    }
    if (caminho.startsWith(`/v13/deployments/${ATIVO}`)) return ativo;
    if (caminho.startsWith('/v7/deployments?')) return { deployments: opcoes.lista ?? [{ uid: ATIVO, readyState: 'READY', createdAt: 1000 }] };
    throw new Error(`caminho inesperado ${caminho}`);
  };
}

describe('qual commit os domínios do ambiente servem', () => {
  it('teste: alias → prévia pronta do ramo → commit', async () => {
    expect(await lerPublicacaoNoAr(api(), TESTE)).toEqual({ ok: true, commit: COMMIT, deploymentId: ATIVO, criadoEm: 1000 });
  });

  it('produção: os dois domínios servem o mesmo deployment de produção, promovido', async () => {
    expect(await lerPublicacaoNoAr(api({ ambiente: PRODUCAO }), PRODUCAO)).toMatchObject({ ok: true, commit: COMMIT });
  });

  it('aceita o id em deployment.id e ignora deployments mais antigos ou com erro', async () => {
    const r = await lerPublicacaoNoAr(api({
      alias: { 'teste.crm.exemplo.com': { deployment: { id: ATIVO }, projectId: PROJETO } },
      lista: [
        { uid: 'dpl_velho', readyState: 'READY', createdAt: 900 },
        { uid: 'dpl_quebrado', readyState: 'ERROR', createdAt: 1100 },
        { uid: ATIVO, readyState: 'READY', createdAt: 1000 },
      ],
    }), TESTE);
    expect(r).toMatchObject({ ok: true, commit: COMMIT });
  });

  it('alias sem deployment, de outro projeto, ou que só redireciona', async () => {
    const com = (alias: Record<string, unknown>) => lerPublicacaoNoAr(api({ alias: { 'teste.crm.exemplo.com': alias } }), TESTE);
    expect(await com({ deploymentId: null, projectId: PROJETO })).toMatchObject({ ok: false, motivo: 'alias_sem_deployment' });
    expect(await com({ deploymentId: ATIVO, projectId: 'prj_outro' })).toMatchObject({ ok: false, motivo: 'projeto_diverge' });
    expect(await com({ deploymentId: ATIVO, projectId: PROJETO, redirect: 'outro.com' })).toMatchObject({ ok: false, motivo: 'alias_redireciona' });
  });

  it('domínios do mesmo ambiente servindo deployments diferentes', async () => {
    const r = await lerPublicacaoNoAr(api({
      ambiente: PRODUCAO,
      alias: { 'crm.outro.com.br': { deploymentId: 'dpl_outro', projectId: PROJETO } },
    }), PRODUCAO);
    expect(r).toMatchObject({ ok: false, motivo: 'dominios_divergem' });
  });

  it('a lista fechada tem que ser a do projeto: domínio novo na Vercel, domínio que saiu, ou lista incompleta', async () => {
    const com = (doProjeto: Record<string, unknown>) => lerPublicacaoNoAr(api({ doProjeto }), TESTE);
    const todos = [...DE_TESTE, ...DE_PRODUCAO].map((name) => ({ name, redirect: null as string | null }));
    // Domínio novo no projeto, fora da lista: serviria tráfego sem ser conferido.
    expect(await com({ domains: [...todos, { name: 'novo.exemplo.com', redirect: null }], pagination: { next: null } }))
      .toMatchObject({ ok: false, motivo: 'dominios_do_projeto_divergem', detalhe: expect.stringContaining('novo.exemplo.com') });
    // Domínio da lista que saiu do projeto, ou que passou a só redirecionar.
    expect(await com({ domains: todos.slice(1), pagination: { next: null } }))
      .toMatchObject({ ok: false, motivo: 'dominios_do_projeto_divergem', detalhe: expect.stringContaining(DE_TESTE[0]) });
    expect(await com({ domains: [{ name: DE_TESTE[0], redirect: 'outro.com' }, ...todos.slice(1)], pagination: { next: null } }))
      .toMatchObject({ ok: false, motivo: 'dominios_do_projeto_divergem' });
    // Lista incompleta (paginada): recusa em vez de conferir pela metade.
    expect(await com({ domains: todos, pagination: { next: 123 } })).toMatchObject({ ok: false, motivo: 'dominios_do_projeto_divergem' });
    // Domínio fora da lista que só redireciona não serve conteúdo: não impede.
    expect(await com({ domains: [...todos, { name: 'www.exemplo.com', redirect: 'crm.exemplo.com' }], pagination: { next: null } }))
      .toMatchObject({ ok: true, commit: COMMIT });
  });

  it('deployment de outro projeto, sem commit de 40 hex, de outro ramo, ou ainda não pronto', async () => {
    const com = (ativo: Partial<Deploy>) => lerPublicacaoNoAr(api({ ativo }), TESTE);
    expect(await com({ projectId: 'prj_outro' })).toMatchObject({ ok: false, motivo: 'projeto_diverge' });
    expect(await com({ meta: { githubCommitRef: TESTE.ramo } })).toMatchObject({ ok: false, motivo: 'deployment_sem_commit' });
    expect(await com({ meta: { githubCommitSha: COMMIT, githubCommitRef: 'main' } })).toMatchObject({ ok: false, motivo: 'ramo_diverge' });
    expect(await com({ readyState: 'BUILDING' })).toMatchObject({ ok: false, motivo: 'nao_pronta' });
  });

  it('alvo errado: domínio de teste servido pelo deployment de PRODUÇÃO; produção não promovida ou de prévia', async () => {
    // Toda publicação de produção leva o domínio de teste junto: o "teste" passa a ser a produção.
    expect(await lerPublicacaoNoAr(api({ ativo: { target: 'production', readySubstate: 'PROMOTED' } }), TESTE))
      .toMatchObject({ ok: false, motivo: 'alvo_diverge' });
    expect(await lerPublicacaoNoAr(api({ ambiente: PRODUCAO, ativo: { target: null, readySubstate: 'STAGED' } }), PRODUCAO))
      .toMatchObject({ ok: false, motivo: 'alvo_diverge' });
    expect(await lerPublicacaoNoAr(api({ ambiente: PRODUCAO, ativo: { readySubstate: 'STAGED' } }), PRODUCAO))
      .toMatchObject({ ok: false, motivo: 'alvo_diverge' });
  });

  it('transição: deployment mais novo do ramo construindo, ou qualquer rollout em andamento', async () => {
    const novo = (d: Partial<Deploy>) => lerPublicacaoNoAr(api({
      lista: [{ uid: 'dpl_novo', readyState: 'READY', createdAt: 2000, ...d }, { uid: ATIVO, readyState: 'READY', createdAt: 1000 }],
    }), TESTE);
    expect(await novo({ readyState: 'BUILDING' })).toMatchObject({ ok: false, motivo: 'em_transicao' });
    expect(await novo({ readySubstate: 'ROLLING' })).toMatchObject({ ok: false, motivo: 'em_transicao' });
    expect(await lerPublicacaoNoAr(api({ ativo: { readySubstate: 'ROLLING' } }), TESTE)).toMatchObject({ ok: false, motivo: 'em_transicao' });
  });

  it('deployment mais novo do ramo pronto e não servido (rollback, ou promoção que ainda não aconteceu)', async () => {
    const r = await lerPublicacaoNoAr(api({
      lista: [{ uid: 'dpl_novo', readyState: 'READY', createdAt: 2000 }, { uid: ATIVO, readyState: 'READY', createdAt: 1000 }],
    }), TESTE);
    expect(r).toMatchObject({ ok: false, motivo: 'mais_novo_nao_servido' });
  });
});

describe('cliente da API', () => {
  it('manda o token, acrescenta o teamId e falha em resposta fora de 2xx', async () => {
    const fetchFn = vi.fn(async (url: string) => (url.includes('/v4/aliases/')
      ? new Response(JSON.stringify({ deploymentId: ATIVO }), { status: 200 })
      : new Response('nope', { status: 403 })));
    const cliente = criarClienteVercel({ token: 'tok', teamId: 'team_1', fetchFn: fetchFn as never });
    expect(await cliente('/v4/aliases/x.com')).toEqual({ deploymentId: ATIVO });
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.vercel.com/v4/aliases/x.com?teamId=team_1');
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toEqual({ authorization: 'Bearer tok' });
    await expect(cliente('/v7/deployments?projectId=p')).rejects.toThrow('403');
  });
});
