import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buscarPromptResolvidoEstrito } from '@/lib/ai/prompts/resolve';
import { resolveConversationAIAgentConfig } from '@/lib/conversations/aiAgentConfig';
import type { PublicacaoNoAr } from '@/lib/agents/publicacaoVercel';

// Sem 'server-only': usado pelo script scripts/central-agentes/migrar-agentes.ts, fora do Next.
// Toda leitura aqui é ESTRITA: erro de banco lança e aborta o script. Nunca cair no catálogo por erro.

export function sha256Hex(texto: string) {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/** Página da leitura de conexões: abaixo do `max_rows` do PostgREST (1.000 no local). */
const PAGINA = 500;

export type ConexaoLida = {
  id: string;
  organization_id: string;
  name: string;
  config: Record<string, unknown> | null;
  ai_agent_id: string | null;
};

export type SituacaoNaProducao = 'CONFERE' | 'DIVERGE' | 'CHAVE_DIVERGE' | 'PUBLICACAO_DIVERGE' | 'SEM_RESPOSTA_AINDA';

export type ConexaoDoGrupo = {
  id: string;
  name: string;
  situacao: SituacaoNaProducao;
  /** Hora da entrega da resposta usada na prova (`delivered_at` do evento). */
  respostaEm: string | null;
};

export type GrupoPlanejado = {
  organizationId: string;
  promptKey: string;
  promptSource: 'override' | 'default';
  conteudo: string;
  sha256: string;
  nome: string;
  conexoes: ConexaoDoGrupo[];
  /** Só com todos os números em CONFERE o grupo pode virar agente. */
  pronto: boolean;
};

export type ConexaoIgnorada = {
  id: string;
  name: string;
  organizationId: string;
  motivo: 'ja_ligada' | 'sem_ia' | 'chave_invalida' | 'prompt_inexistente';
};

/** O que os domínios servem: o commit E o deployment. Um redeploy do mesmo commit é outra publicação. */
export type IdentidadeDaPublicacao = { commit: string; deploymentId: string };

export type RespostaDaProducao = {
  sha256: string;
  promptKey: string | null;
  /** De onde veio o texto daquela resposta: 'default' (catálogo) ou 'override'. */
  promptSource: string;
  /** Commit da publicação que respondeu (VERCEL_GIT_COMMIT_SHA); nulo fora da Vercel. */
  releaseCommit: string | null;
  /** Deployment que respondeu (VERCEL_DEPLOYMENT_ID); nulo fora da Vercel. */
  releaseDeployment: string | null;
  deliveredAt: string;
};

/**
 * O ÚLTIMO EVENTO de prova deste número pelo caminho de hoje (ai_reply_events), escolhido pela função do
 * banco central_agentes_ultima_resposta_nativa, pela hora da entrega. Não é "a última resposta entregue":
 * uma resposta cujo registro falhou não tem evento. A prova do texto não depende disso: o evento é a
 * testemunha de que a publicação R (commit e deployment), com a chave K e a origem O (padrão ou override),
 * chega ao texto de sha S, gravada NESTE banco por esse deployment; o script confere que a cópia é R e que os
 * domínios servem R, e a função de ligar confere de novo, na hora, a chave e o override.
 */
export async function ultimaRespostaNativa(
  admin: SupabaseClient,
  conexao: { id: string },
): Promise<RespostaDaProducao | null> {
  const { data, error } = await admin.rpc('central_agentes_ultima_resposta_nativa', { p_connection_id: conexao.id });
  if (error) throw new Error(`Falha ao ler a ultima resposta do numero ${conexao.id}: ${error.message}`);
  const [linha] = (data ?? []) as Array<{
    out_sha256: string;
    out_prompt_key: string | null;
    out_prompt_source: string;
    out_release_commit: string | null;
    out_release_deployment: string | null;
    out_delivered_at: string;
  }>;
  if (!linha) return null;
  return {
    sha256: linha.out_sha256,
    promptKey: linha.out_prompt_key,
    promptSource: linha.out_prompt_source,
    releaseCommit: linha.out_release_commit,
    releaseDeployment: linha.out_release_deployment,
    deliveredAt: linha.out_delivered_at,
  };
}

function situacaoNaProducao(
  calculado: { sha256: string; promptKey: string; promptSource: 'override' | 'default'; publicacao: IdentidadeDaPublicacao },
  producao: RespostaDaProducao | null,
): SituacaoNaProducao {
  if (!producao) return 'SEM_RESPOSTA_AINDA';
  // Commit E deployment: um redeploy do mesmo commit pode ter outras variáveis de ambiente (4ª rodada, achado 12).
  if (producao.releaseCommit !== calculado.publicacao.commit || producao.releaseDeployment !== calculado.publicacao.deploymentId) {
    return 'PUBLICACAO_DIVERGE';
  }
  if (producao.promptKey !== calculado.promptKey) return 'CHAVE_DIVERGE';
  // O evento tem que ser do MESMO caso: mesmo sha E mesma origem. Um evento de override com o mesmo sha
  // não prova o texto padrão (3ª rodada do Codex, achado 5).
  return producao.sha256 === calculado.sha256 && producao.promptSource === calculado.promptSource ? 'CONFERE' : 'DIVERGE';
}

/** Todas as conexões de WhatsApp, em páginas por id: o PostgREST corta leitura grande sem erro. */
export async function lerConexoes(admin: SupabaseClient, organizationId?: string): Promise<ConexaoLida[]> {
  const todas: ConexaoLida[] = [];
  let depoisDe: string | null = null;
  for (;;) {
    let consulta = admin
      .from('channel_connections')
      .select('id, organization_id, name, config, ai_agent_id')
      .eq('provider', 'evolution')
      .eq('channel_type', 'whatsapp');
    if (organizationId) consulta = consulta.eq('organization_id', organizationId);
    if (depoisDe) consulta = consulta.gt('id', depoisDe);
    const { data, error } = await consulta.order('id', { ascending: true }).limit(PAGINA);
    if (error) throw new Error(`Falha ao ler conexoes: ${error.message}`);
    const pagina = (data ?? []) as ConexaoLida[];
    todas.push(...pagina);
    if (pagina.length < PAGINA) return todas;
    depoisDe = pagina[pagina.length - 1].id;
  }
}

/**
 * Só leitura. Um grupo por (organização, sha256 do prompt efetivo de hoje), com a situação de cada número.
 * `publicacao` é o commit e o deployment que os domínios servem, lidos pelo script na Vercel: o evento tem que ter vindo deles.
 */
export async function planejarMigracao(
  admin: SupabaseClient,
  filtro: { organizationId?: string; incluir?: string[]; publicacao: IdentidadeDaPublicacao },
): Promise<{ grupos: GrupoPlanejado[]; ignoradas: ConexaoIgnorada[] }> {
  const incluir = new Set(filtro.incluir ?? []);
  const grupos = new Map<string, GrupoPlanejado>();
  const ignoradas: ConexaoIgnorada[] = [];

  for (const conexao of await lerConexoes(admin, filtro.organizationId)) {
    const base = { id: conexao.id, name: conexao.name, organizationId: conexao.organization_id };
    const config = conexao.config ?? {};
    if (conexao.ai_agent_id) {
      ignoradas.push({ ...base, motivo: 'ja_ligada' });
      continue;
    }
    if (!incluir.has(conexao.id) && config.aiEnabled !== true && typeof config.aiPromptKey !== 'string') {
      ignoradas.push({ ...base, motivo: 'sem_ia' });
      continue;
    }
    const { agentName, promptKey } = resolveConversationAIAgentConfig(config);
    if (!promptKey) {
      // Hoje este número responde missing_prompt; virar agente faria ele passar a responder.
      ignoradas.push({ ...base, motivo: 'chave_invalida' });
      continue;
    }
    const resolvido = await buscarPromptResolvidoEstrito(admin, conexao.organization_id, promptKey);
    if (!resolvido) {
      ignoradas.push({ ...base, motivo: 'prompt_inexistente' });
      continue;
    }
    const sha256 = sha256Hex(resolvido.content);
    const producao = await ultimaRespostaNativa(admin, conexao);
    const item: ConexaoDoGrupo = {
      id: conexao.id,
      name: conexao.name,
      situacao: situacaoNaProducao({ sha256, promptKey, promptSource: resolvido.source, publicacao: filtro.publicacao }, producao),
      respostaEm: producao?.deliveredAt ?? null,
    };

    const chave = `${conexao.organization_id}:${sha256}`;
    const existente = grupos.get(chave);
    if (existente) {
      existente.conexoes.push(item);
      continue;
    }
    grupos.set(chave, {
      organizationId: conexao.organization_id,
      promptKey,
      promptSource: resolvido.source,
      conteudo: resolvido.content,
      sha256,
      nome: agentName,
      conexoes: [item],
      pronto: false,
    });
  }

  const lista = [...grupos.values()];
  for (const grupo of lista) grupo.pronto = grupo.conexoes.every((c) => c.situacao === 'CONFERE');
  return { grupos: lista, ignoradas };
}

/**
 * Cria (ou reencontra, pela idempotência do banco) o agente com a v1 de cada grupo PRONTO da organização
 * pedida. Grupo com algum número fora de CONFERE volta em `pulados`. Não liga número.
 */
export async function criarAgentes(
  admin: SupabaseClient,
  entrada: { organizationId: string; grupos: GrupoPlanejado[]; catalogCommit: string | null },
) {
  const deOutra = entrada.grupos.find((g) => g.organizationId !== entrada.organizationId);
  if (deOutra) {
    throw new Error(`Grupo de outra organizacao (${deOutra.organizationId}) na criacao de ${entrada.organizationId}.`);
  }

  const criados: Array<{ organizationId: string; agentId: string; criado: boolean }> = [];
  const pulados: Array<{ sha256: string; conexoes: string[] }> = [];
  for (const grupo of entrada.grupos) {
    if (!grupo.pronto) {
      pulados.push({ sha256: grupo.sha256, conexoes: grupo.conexoes.map((c) => `${c.id}:${c.situacao}`) });
      continue;
    }
    const { data, error } = await admin.rpc('create_ai_agent_from_legacy_prompt', {
      p_organization_id: grupo.organizationId,
      p_name: grupo.nome,
      p_prompt: grupo.conteudo,
      p_origin: {
        sha256: grupo.sha256,
        promptKey: grupo.promptKey,
        promptSource: grupo.promptSource,
        conexoes: grupo.conexoes.map((c) => c.id),
        catalogCommit: entrada.catalogCommit,
      },
    });
    if (error) throw new Error(`Falha ao criar agente (${grupo.organizationId}): ${error.message}`);
    const [linha] = (data ?? []) as Array<{ out_agent_id: string; out_created: boolean }>;
    if (!linha) throw new Error(`Funcao nao devolveu o agente (${grupo.organizationId})`);
    criados.push({ organizationId: grupo.organizationId, agentId: linha.out_agent_id, criado: linha.out_created });
  }
  return { criados, pulados };
}

/** Motivos com que a função do banco central_agentes_ligar_conexao recusa. */
export type MotivoDoBanco =
  | 'sha_invalido'
  | 'publicacao_invalida'
  | 'conexao_inexistente'
  | 'ja_ligada'
  | 'chave_mudou'
  | 'chave_efetiva_diverge'
  | 'override_mudou'
  | 'origem_invalida'
  | 'versao_publicada_diverge'
  | 'prova_nao_confere'
  | 'publicacao_diverge';

export type ResultadoLigar =
  | { ok: true; agentId: string }
  | { ok: false; motivo: MotivoDoBanco | 'chave_invalida' | 'prompt_inexistente' | 'agente_nao_criado' }
  /**
   * A chamada da função falhou sem dizer o que o banco fez (rede, tempo esgotado, deadlock). A transação
   * pode ter sido gravada antes de a resposta se perder: quem chamou tem que conferir a linha.
   */
  | { ok: false; motivo: 'chamada_falhou'; agentId: string; detalhe: string };

/**
 * Calcula o prompt de hoje, acha o agente de migração com o mesmo sha e pede ao banco para ligar. A função
 * do banco confere tudo de novo numa transação só (chave bruta e efetiva, override, versão publicada e o
 * último evento de prova, com a publicação que o script conferiu nos domínios), com a tabela de prompts,
 * o número e o agente travados, e devolve o motivo quando recusa.
 */
export async function ligarConexao(
  admin: SupabaseClient,
  connectionId: string,
  opcoes: { publicacao: IdentidadeDaPublicacao },
): Promise<ResultadoLigar> {
  const lida = await admin
    .from('channel_connections')
    .select('id, organization_id, name, config, ai_agent_id')
    .eq('id', connectionId)
    .maybeSingle();
  if (lida.error) throw new Error(`Falha ao ler o numero ${connectionId}: ${lida.error.message}`);
  const conexao = lida.data as ConexaoLida | null;
  if (!conexao) return { ok: false, motivo: 'conexao_inexistente' };
  if (conexao.ai_agent_id) return { ok: false, motivo: 'ja_ligada' };

  const config = conexao.config ?? {};
  const { promptKey } = resolveConversationAIAgentConfig(config);
  if (!promptKey) return { ok: false, motivo: 'chave_invalida' };
  const resolvido = await buscarPromptResolvidoEstrito(admin, conexao.organization_id, promptKey);
  if (!resolvido) return { ok: false, motivo: 'prompt_inexistente' };
  const sha256 = sha256Hex(resolvido.content);

  const candidato = await admin
    .from('ai_agents')
    .select('id')
    .eq('organization_id', conexao.organization_id)
    .eq('origin->>kind', 'migration')
    .eq('origin->>sha256', sha256)
    .maybeSingle();
  if (candidato.error) throw new Error(`Falha ao ler o agente candidato: ${candidato.error.message}`);
  const agentId = (candidato.data as { id: string } | null)?.id;
  if (!agentId) return { ok: false, motivo: 'agente_nao_criado' };

  // Daqui para baixo o banco pode ter gravado. Erro devolvido ou lançado pela chamada NÃO prova que a
  // transação não aconteceu (a resposta pode ter se perdido depois do commit): devolve `chamada_falhou`
  // com o agente, em vez de lançar, para quem chamou conferir a linha.
  let resposta: { data: unknown; error: { message: string } | null };
  try {
    resposta = await admin.rpc('central_agentes_ligar_conexao', {
      p_connection_id: connectionId,
      p_agent_id: agentId,
      p_chave_bruta: typeof config.aiPromptKey === 'string' ? config.aiPromptKey : null,
      p_prompt_key: promptKey,
      p_prompt_source: resolvido.source,
      p_sha256: sha256,
      p_publicacao: opcoes.publicacao.commit,
      p_deployment: opcoes.publicacao.deploymentId,
    });
  } catch (erro) {
    return { ok: false, motivo: 'chamada_falhou', agentId, detalhe: erro instanceof Error ? erro.message : String(erro) };
  }
  if (resposta.error) return { ok: false, motivo: 'chamada_falhou', agentId, detalhe: resposta.error.message };
  if (typeof resposta.data !== 'string') {
    return { ok: false, motivo: 'chamada_falhou', agentId, detalhe: 'a funcao nao devolveu o resultado' };
  }
  if (resposta.data === 'ligado') return { ok: true, agentId };
  return { ok: false, motivo: resposta.data as MotivoDoBanco };
}

/**
 * Volta o número ao caminho de hoje, confirmando a linha. O config da conexão nunca foi tocado.
 * Com `seAgente`, só desliga se o número ainda está com AQUELE agente: é o desfazer de uma ligação
 * recém-feita, que não pode derrubar uma ligação diferente feita por outra pessoa nesse meio-tempo.
 */
export async function desligarConexao(
  admin: SupabaseClient,
  connectionId: string,
  opcoes: { seAgente?: string } = {},
): Promise<{ ok: true } | { ok: false; detalhe: string }> {
  let consulta = admin.from('channel_connections').update({ ai_agent_id: null }).eq('id', connectionId);
  if (opcoes.seAgente) consulta = consulta.eq('ai_agent_id', opcoes.seAgente);
  const { data, error } = await consulta.select('id');
  if (error) return { ok: false, detalhe: error.message };
  if (data && data.length > 0) return { ok: true };
  return { ok: false, detalhe: opcoes.seAgente ? 'nao_estava_com_esse_agente' : 'conexao_inexistente' };
}

/** A qual agente o número está ligado agora (nulo = caminho de hoje). Erro de leitura lança. */
export async function lerAgenteDaConexao(
  admin: SupabaseClient,
  connectionId: string,
): Promise<{ existe: boolean; agentId: string | null }> {
  const { data, error } = await admin.from('channel_connections').select('id, ai_agent_id').eq('id', connectionId).maybeSingle();
  if (error) throw new Error(`Falha ao ler o numero ${connectionId}: ${error.message}`);
  const linha = data as { ai_agent_id: string | null } | null;
  return { existe: Boolean(linha), agentId: linha?.ai_agent_id ?? null };
}

export type ResultadoLigarConferido =
  /** Publicação confirmada antes e depois (mesmo deployment) E a linha relida no fim está com este agente. */
  | { estado: 'ligado'; agentId: string; publicacao: IdentidadeDaPublicacao }
  /** Nada ficou ligado por esta chamada: recusa, ou chamada que falhou com a linha conferida sem agente. */
  | { estado: 'nao_ligou'; motivo: string }
  /** Ligou (ou pode ter ligado), não deu para confirmar, e a linha conferida está sem agente. */
  | { estado: 'desfeito'; agentId: string; motivo: string }
  /**
   * A linha conferida está com OUTRO agente: alguém ligou o número durante a operação (4ª rodada do Codex,
   * achado 10). Não é "desfeito" nem "não ligou": o número responde com `agenteAtual`.
   */
  | { estado: 'ligado_a_outro'; agentId: string; agenteAtual: string; motivo: string }
  /** O número não existe mais: foi apagado durante a operação (5ª rodada do Codex, achado 6). Não é "linha sem
   * agente": não há linha. */
  | { estado: 'conexao_inexistente'; agentId: string; motivo: string }
  /** A linha continua com este agente depois de um desfazer, ou não pôde ser lida: o número pode estar ligado. */
  | { estado: 'incerto'; agentId: string; motivo: string; detalhe: string };

type LinhaConferida =
  | { tipo: 'este' }
  | { tipo: 'outro'; agenteAtual: string }
  | { tipo: 'nenhum' }
  | { tipo: 'inexistente' }
  | { tipo: 'ilegivel'; detalhe: string };

/** O que a linha do número mostra agora, comparado ao agente que esta chamada tentou ligar. Nunca lança. */
async function conferirLinha(admin: SupabaseClient, connectionId: string, agentId: string): Promise<LinhaConferida> {
  try {
    const agora = await lerAgenteDaConexao(admin, connectionId);
    if (!agora.existe) return { tipo: 'inexistente' };
    if (!agora.agentId) return { tipo: 'nenhum' };
    return agora.agentId === agentId ? { tipo: 'este' } : { tipo: 'outro', agenteAtual: agora.agentId };
  } catch (erro) {
    return { tipo: 'ilegivel', detalhe: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * Desfaz a ligação daquele agente e diz o que a linha mostra depois (4ª rodada do Codex, achado 10).
 * `ligouComCerteza` é falso quando a chamada de ligar falhou sem resposta: o número pode nunca ter ficado
 * com o agente.
 *  - a linha continua com este agente, ou não pôde ser lida → `incerto`;
 *  - a linha está com OUTRO agente → `ligado_a_outro`, com o agente atual (o desfazer é condicionado ao
 *    agente, então a ligação de outra pessoa fica);
 *  - o número não existe mais → `conexao_inexistente` (5ª rodada, achado 6: não é "linha sem agente");
 *  - a linha está sem agente → `desfeito` se havia ligação, `nao_ligou` se não.
 */
async function desfazerEConferir(
  admin: SupabaseClient,
  connectionId: string,
  agentId: string,
  motivo: string,
  ligouComCerteza: boolean,
): Promise<ResultadoLigarConferido> {
  let desfez = false;
  try {
    desfez = (await desligarConexao(admin, connectionId, { seAgente: agentId })).ok;
  } catch {
    // Quem diz o estado é a linha, lida logo abaixo.
  }
  const linha = await conferirLinha(admin, connectionId, agentId);
  if (linha.tipo === 'ilegivel') return { estado: 'incerto', agentId, motivo, detalhe: linha.detalhe };
  if (linha.tipo === 'este') return { estado: 'incerto', agentId, motivo, detalhe: 'o numero continua ligado a esse agente' };
  if (linha.tipo === 'outro') return { estado: 'ligado_a_outro', agentId, agenteAtual: linha.agenteAtual, motivo };
  if (linha.tipo === 'inexistente') return { estado: 'conexao_inexistente', agentId, motivo: `${motivo}; o numero nao existe mais` };
  return ligouComCerteza || desfez ? { estado: 'desfeito', agentId, motivo } : { estado: 'nao_ligou', motivo };
}

/**
 * Liga com a publicação conferida antes e depois (2ª rodada do Codex, achado 2; 3ª rodada, achado 3; 4ª
 * rodada, achados 10 e 12). Antes de chamar o banco, um erro de leitura lança: nada foi ligado. Da chamada em
 * diante o número PODE estar ligado, então qualquer coisa que impeça confirmar desfaz a ligação, só daquele
 * agente, e a linha é lida de novo:
 *  - a chamada de ligar falhou sem resposta do banco (a transação pode ter sido gravada);
 *  - a publicação mudou (commit OU deployment), ficou inconclusiva, ou a leitura dela lançou (rede, 500).
 * Mesmo com tudo confirmado, o resultado só é `ligado` se a linha relida no fim estiver com este agente.
 * Se o processo morrer entre a ligação e a conferência, o número fica ligado com uma prova que valia
 * segundos antes; o `--prova` seguinte mostra o número como `ja_ligada` e o operador decide.
 */
export async function ligarComConferencia(
  admin: SupabaseClient,
  connectionId: string,
  lerPublicacao: () => Promise<PublicacaoNoAr>,
  commit: string,
): Promise<ResultadoLigarConferido> {
  const antes = await lerPublicacao();
  if (!antes.ok) return { estado: 'nao_ligou', motivo: `publicacao ${antes.motivo} (${antes.detalhe})` };
  if (antes.commit !== commit) {
    return { estado: 'nao_ligou', motivo: `os dominios servem ${antes.commit.slice(0, 7)} e esta copia esta em ${commit.slice(0, 7)}` };
  }
  const publicacao: IdentidadeDaPublicacao = { commit: antes.commit, deploymentId: antes.deploymentId };

  const ligada = await ligarConexao(admin, connectionId, { publicacao });
  if (!ligada.ok) {
    if (ligada.motivo !== 'chamada_falhou') return { estado: 'nao_ligou', motivo: ligada.motivo };
    return desfazerEConferir(
      admin,
      connectionId,
      ligada.agentId,
      `a chamada de ligacao falhou sem resposta do banco (${ligada.detalhe})`,
      false,
    );
  }

  let motivo: string;
  try {
    const depois = await lerPublicacao();
    if (depois.ok && depois.commit === publicacao.commit && depois.deploymentId === publicacao.deploymentId) {
      // Publicação confirmada. O resultado diz o que a LINHA mostra agora (4ª rodada, achado 10).
      const linha = await conferirLinha(admin, connectionId, ligada.agentId);
      if (linha.tipo === 'este') return { estado: 'ligado', agentId: ligada.agentId, publicacao };
      if (linha.tipo === 'outro') {
        return { estado: 'ligado_a_outro', agentId: ligada.agentId, agenteAtual: linha.agenteAtual, motivo: 'outra pessoa ligou o numero a outro agente durante a conferencia' };
      }
      if (linha.tipo === 'nenhum') {
        return { estado: 'desfeito', agentId: ligada.agentId, motivo: 'outra pessoa desligou o numero durante a conferencia' };
      }
      if (linha.tipo === 'inexistente') {
        return { estado: 'conexao_inexistente', agentId: ligada.agentId, motivo: 'o numero foi apagado durante a conferencia' };
      }
      return { estado: 'incerto', agentId: ligada.agentId, motivo: 'ligado com a publicacao confirmada, mas a linha nao pode ser relida', detalhe: linha.detalhe };
    }
    motivo = depois.ok
      ? `a publicacao mudou para ${depois.commit.slice(0, 7)} (${depois.deploymentId}) durante a ligacao`
      : `publicacao ${depois.motivo} depois de ligar (${depois.detalhe})`;
  } catch (erro) {
    motivo = `nao foi possivel ler a publicacao depois de ligar (${erro instanceof Error ? erro.message : String(erro)})`;
  }
  return desfazerEConferir(admin, connectionId, ligada.agentId, motivo, true);
}
