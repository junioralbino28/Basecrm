// Sem 'server-only': usado pelo script scripts/central-agentes/migrar-agentes.ts, fora do Next.
// Lê, pela API da Vercel, qual commit um ambiente está servindo AGORA (2ª rodada do Codex, achado 2;
// 3ª rodada, achado 4): `HEAD == origin/<ramo>` diz o que FOI publicado, não o que está no ar. Um
// rollback, um deploy ainda construindo ou um domínio apontando para outro deployment deixam o tráfego
// num commit diferente do ramo sem mexer no git.

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const EM_ANDAMENTO = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);

/** Um ambiente publicado: TODOS os domínios que atendem aquele banco, e de onde ele é publicado. */
export type AmbientePublicado = {
  dominios: readonly string[];
  /** Domínios do MESMO projeto que atendem o outro ambiente. Com `dominios`, formam a lista fechada do projeto. */
  outrosDominiosDoProjeto: readonly string[];
  ramo: string;
  projectId: string;
  /** Produção exige o deployment de produção, promovido. Teste exige que NÃO seja o de produção. */
  producao: boolean;
};

export type MotivoDaPublicacao =
  | 'dominios_do_projeto_divergem'
  | 'alias_sem_deployment'
  | 'alias_redireciona'
  | 'projeto_diverge'
  | 'dominios_divergem'
  | 'deployment_sem_commit'
  | 'ramo_diverge'
  | 'alvo_diverge'
  | 'nao_pronta'
  | 'em_transicao'
  | 'mais_novo_nao_servido';

export type PublicacaoNoAr =
  | { ok: true; commit: string; deploymentId: string; criadoEm: number }
  | { ok: false; motivo: MotivoDaPublicacao; detalhe: string };

/** GET autenticado na API da Vercel; devolve o JSON. Lança em resposta fora de 2xx. */
export type ClienteVercel = (caminho: string) => Promise<unknown>;

export function criarClienteVercel(opcoes: { token: string; teamId: string; fetchFn?: typeof fetch }): ClienteVercel {
  const fetchFn = opcoes.fetchFn ?? fetch;
  return async (caminho) => {
    const url = `https://api.vercel.com${caminho}${caminho.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(opcoes.teamId)}`;
    const resposta = await fetchFn(url, { headers: { authorization: `Bearer ${opcoes.token}` } });
    if (!resposta.ok) throw new Error(`Vercel ${caminho.split('?')[0]} respondeu ${resposta.status}`);
    return resposta.json();
  };
}

type DominiosDoProjeto = {
  domains?: Array<{ name?: string; redirect?: string | null }>;
  pagination?: { next?: number | null } | null;
};

type Alias = {
  deploymentId?: string | null;
  deployment?: { id?: string } | null;
  projectId?: string | null;
  redirect?: string | null;
};

type Deployment = {
  uid?: string;
  id?: string;
  projectId?: string;
  readyState?: string;
  state?: string;
  readySubstate?: string;
  target?: string | null;
  createdAt?: number;
  created?: number;
  meta?: Record<string, string>;
};

const recusa = (motivo: MotivoDaPublicacao, detalhe: string): PublicacaoNoAr => ({ ok: false, motivo, detalhe });

/**
 * Domínios do projeto → cada domínio do ambiente → alias → deployment. Só devolve `ok` se:
 *  - a lista fechada (este ambiente + o outro) é exatamente a dos domínios do projeto que servem conteúdo:
 *    um domínio novo na Vercel que ainda não entrou na lista serviria tráfego sem ser conferido;
 *  - todos os domínios servem o MESMO deployment, do projeto certo, sem redirecionar;
 *  - o deployment é do ramo, está READY, tem commit, e é do alvo certo (produção promovida, ou prévia);
 *  - não há rollout em andamento, nem deployment mais novo do ramo construindo (transição) ou pronto sem
 *    ser o servido (rollback, ou promoção que ainda não aconteceu: recusa conservadora).
 * Deployment mais novo com ERROR/CANCELED nunca foi para o ar e é ignorado.
 */
export async function lerPublicacaoNoAr(api: ClienteVercel, ambiente: AmbientePublicado): Promise<PublicacaoNoAr> {
  const doProjeto = (await api(`/v9/projects/${encodeURIComponent(ambiente.projectId)}/domains`)) as DominiosDoProjeto;
  if (doProjeto.pagination?.next) {
    return recusa('dominios_do_projeto_divergem', 'a lista de dominios do projeto veio incompleta (paginada)');
  }
  // Domínio que só redireciona não serve conteúdo; os demais têm que estar na lista fechada, e vice-versa.
  const servem = (doProjeto.domains ?? []).filter((d) => d.name && !d.redirect).map((d) => d.name as string);
  const conhecidos = [...ambiente.dominios, ...ambiente.outrosDominiosDoProjeto];
  const foraDaLista = servem.filter((d) => !conhecidos.includes(d));
  const faltando = conhecidos.filter((d) => !servem.includes(d));
  if (foraDaLista.length > 0 || faltando.length > 0) {
    return recusa(
      'dominios_do_projeto_divergem',
      `fora da lista: ${foraDaLista.join(', ') || '-'}; faltando no projeto: ${faltando.join(', ') || '-'}`,
    );
  }

  let deploymentId: string | null = null;
  for (const dominio of ambiente.dominios) {
    const alias = (await api(`/v4/aliases/${encodeURIComponent(dominio)}`)) as Alias;
    if (alias.redirect) return recusa('alias_redireciona', `${dominio} redireciona para ${alias.redirect}`);
    if (alias.projectId !== ambiente.projectId) return recusa('projeto_diverge', `${dominio} e do projeto ${alias.projectId ?? '?'}`);
    const id = alias.deploymentId ?? alias.deployment?.id ?? null;
    if (!id) return recusa('alias_sem_deployment', dominio);
    if (deploymentId && id !== deploymentId) return recusa('dominios_divergem', `${dominio} serve ${id}; outro dominio serve ${deploymentId}`);
    deploymentId = id;
  }
  if (!deploymentId) return recusa('alias_sem_deployment', 'ambiente sem dominio');

  const ativo = (await api(`/v13/deployments/${encodeURIComponent(deploymentId)}`)) as Deployment;
  const commit = (ativo.meta?.githubCommitSha ?? '').toLowerCase();
  const ramo = ativo.meta?.githubCommitRef ?? '';
  const estado = ativo.readyState ?? ativo.state ?? '';
  const criadoEm = ativo.createdAt ?? ativo.created ?? 0;
  if (ativo.projectId !== ambiente.projectId) return recusa('projeto_diverge', `${deploymentId} e do projeto ${ativo.projectId ?? '?'}`);
  if (!COMMIT_SHA.test(commit)) return recusa('deployment_sem_commit', deploymentId);
  if (ramo !== ambiente.ramo) return recusa('ramo_diverge', `${deploymentId} veio de ${ramo || '?'}, nao de ${ambiente.ramo}`);
  if (estado !== 'READY') return recusa('nao_pronta', `${deploymentId} ${estado}`);
  if (ativo.readySubstate === 'ROLLING') return recusa('em_transicao', `${deploymentId} em rollout`);
  const deProducao = ativo.target === 'production';
  if (ambiente.producao && !(deProducao && ativo.readySubstate === 'PROMOTED')) {
    return recusa('alvo_diverge', `${deploymentId} nao e o deployment de producao promovido (target=${ativo.target ?? 'previa'}, ${ativo.readySubstate ?? '?'})`);
  }
  if (!ambiente.producao && deProducao) {
    return recusa('alvo_diverge', `${deploymentId} e o deployment de PRODUCAO: o dominio de teste nao esta na previa`);
  }

  const lista = (await api(
    `/v7/deployments?projectId=${encodeURIComponent(ambiente.projectId)}&branch=${encodeURIComponent(ambiente.ramo)}&limit=20`,
  )) as { deployments?: Deployment[] };
  for (const d of lista.deployments ?? []) {
    const id = d.uid ?? d.id ?? '';
    const quando = d.createdAt ?? d.created ?? 0;
    const estadoDele = d.readyState ?? d.state ?? '';
    if (id === deploymentId || quando <= criadoEm) continue;
    if (EM_ANDAMENTO.has(estadoDele) || d.readySubstate === 'ROLLING') return recusa('em_transicao', `${id} ${d.readySubstate === 'ROLLING' ? 'em rollout' : estadoDele}`);
    if (estadoDele === 'READY') return recusa('mais_novo_nao_servido', `${id} esta pronto e e mais novo que o que os dominios servem`);
  }
  return { ok: true, commit, deploymentId, criadoEm };
}
