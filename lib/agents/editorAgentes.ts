import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveConversationCalendarConfig } from '@/lib/conversations/meetingAvailability';
import { avisosNaoConfirmados, verificarPrompt, type ResultadoDaVerificacao } from './verificarPrompt';
import type {
  AgenteNaLista,
  AgenteNoEditor,
  NumeroDoAgente,
  OrigemDaVersao,
  PaginaDeVersoes,
  VersaoCompleta,
  VersaoResumo,
} from './tiposDoEditor';

/**
 * Leitura e escrita da Central de Agentes (fatia 2). Quem chama são as rotas de
 * app/api/platform/tenants/[tenantId]/agents/**, depois de requireTenantAccess(..., { adminOnly: true }).
 *  - `usuario` (JWT de quem pediu): lê ai_agents e ai_agent_versions pela RLS (só agência) e chama as três funções
 *    de escrita, que conferem o papel por dentro e tiram o autor de auth.uid().
 *  - `admin` (chave de serviço): só o que a RLS não abre ao usuário, e nunca escreve: os números (channel_connections
 *    não tem policy para authenticated), os nomes de quem publicou e o nome do cliente.
 * Toda leitura filtra pela organização da rota (G4): a policy das tabelas do agente não filtra por organização.
 * A config do número nunca sai daqui (G22: guarda a chave da Evolution).
 */
export type Clientes = { usuario: SupabaseClient; admin: SupabaseClient };
export type Falha = { ok: false; status: number; codigo: string; erro: string; verificacao?: ResultadoDaVerificacao };
export type Resultado<T> = { ok: true; dados: T } | Falha;

export const falha = (status: number, codigo: string, erro: string, extra: Partial<Falha> = {}): Falha => ({
  ok: false,
  status,
  codigo,
  erro,
  ...extra,
});

/** Erros com nome das funções da migration 20261007120000 (o nome vem na mensagem). */
const ERROS_DO_BANCO: Record<string, { status: number; codigo: string; erro: string }> = {
  sem_permissao: { status: 403, codigo: 'SEM_PERMISSAO', erro: 'Só a agência edita agentes.' },
  agente_inexistente: { status: 404, codigo: 'AGENTE_INEXISTENTE', erro: 'Agente não encontrado neste cliente.' },
  versao_inexistente: { status: 404, codigo: 'VERSAO_INEXISTENTE', erro: 'Essa versão não existe neste agente.' },
  rascunho_mudou: {
    status: 409,
    codigo: 'RASCUNHO_MUDOU',
    erro: 'O rascunho foi alterado em outra aba ou por outra pessoa enquanto você editava.',
  },
  versao_publicada_mudou: {
    status: 409,
    codigo: 'VERSAO_PUBLICADA_MUDOU',
    erro: 'Outra versão foi publicada enquanto você editava. A tela foi atualizada com a versão atual.',
  },
  rascunho_vazio: { status: 422, codigo: 'RASCUNHO_VAZIO', erro: 'Não há rascunho para publicar.' },
  sem_mudancas: { status: 422, codigo: 'SEM_MUDANCAS', erro: 'Não há mudança em relação à versão publicada.' },
  versao_ja_publicada: { status: 422, codigo: 'VERSAO_JA_PUBLICADA', erro: 'Essa já é a versão publicada.' },
  variavel_desconhecida: {
    status: 422,
    codigo: 'VARIAVEL_DESCONHECIDA',
    erro: 'O texto usa uma variável {{...}} que o sistema não conhece. Corrija antes de publicar.',
  },
  prompt_invalido: { status: 400, codigo: 'PROMPT_INVALIDO', erro: 'O prompt precisa ter de 1 a 50 mil caracteres.' },
  nota_invalida: { status: 400, codigo: 'NOTA_INVALIDA', erro: 'A nota pode ter no máximo 200 caracteres.' },
};

const MENSAGEM_ERRO_INTERNO = 'Não foi possível concluir agora. Tente de novo em instantes; se continuar, avise o suporte.';

/** Traduz o erro do banco. Sem nome conhecido: 500 com mensagem genérica, e o detalhe só no log do servidor (G10). */
export function traduzirErroDoBanco(
  erro: { code?: string | null; message?: string | null } | null,
  contexto: string,
): Falha {
  const conhecido = erro?.message ? ERROS_DO_BANCO[erro.message] : undefined;
  if (conhecido) return falha(conhecido.status, conhecido.codigo, conhecido.erro);
  if (erro?.code === '42501') return falha(403, 'SEM_PERMISSAO', ERROS_DO_BANCO.sem_permissao.erro);
  console.error('[central-agentes]', contexto, { code: erro?.code ?? null, message: erro?.message ?? null });
  return falha(500, 'ERRO_INTERNO', MENSAGEM_ERRO_INTERNO);
}

type LinhaDoAgente = {
  id: string;
  name: string;
  published_version_id: string | null;
  draft: Record<string, unknown> | null;
  draft_revision: number;
  draft_updated_at: string | null;
  draft_updated_by: string | null;
};
type LinhaDaVersao = {
  id: string;
  version: number;
  source: OrigemDaVersao;
  restored_from: number | null;
  note: string | null;
  published_at: string;
  published_by: string | null;
  prompt?: string;
  settings?: Record<string, unknown>;
  model?: string | null;
};

const CAMPOS_DO_AGENTE = 'id, name, published_version_id, draft, draft_revision, draft_updated_at, draft_updated_by';
const CAMPOS_DA_VERSAO = 'id, version, source, restored_from, note, published_at, published_by';
const CAMPOS_DA_VERSAO_COMPLETA = `${CAMPOS_DA_VERSAO}, prompt, settings, model`;
const ALGUEM = 'Alguém da equipe';

function promptDoRascunho(draft: unknown): string | null {
  const prompt = (draft as Record<string, unknown> | null)?.prompt;
  return typeof prompt === 'string' ? prompt : null;
}

function nomeDaPessoa(p: { nickname?: string | null; first_name?: string | null; last_name?: string | null; name?: string | null }) {
  const apelido = p.nickname?.trim();
  if (apelido) return apelido;
  const completo = [p.first_name, p.last_name].map((s) => s?.trim()).filter(Boolean).join(' ');
  return completo || p.name?.trim() || ALGUEM;
}

async function nomesDasPessoas(admin: SupabaseClient, ids: Array<string | null>) {
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unicos.length === 0) return new Map<string, string>();
  const { data, error } = await admin.from('profiles').select('id, nickname, first_name, last_name, name').in('id', unicos);
  if (error) throw new Error(`profiles: ${error.message}`);
  return new Map((data ?? []).map((p) => [p.id as string, nomeDaPessoa(p)]));
}

/** Páginas de 500 por id, como o `lerConexoes` da fatia 1: o PostgREST corta leitura grande sem erro. */
const PAGINA_DE_NUMEROS = 500;

async function numerosDosAgentes(admin: SupabaseClient, tenantId: string, agentIds: string[]) {
  const porAgente = new Map<string, NumeroDoAgente[]>();
  if (agentIds.length === 0) return porAgente;
  // Revisão do Codex, rodada 2: a leitura única cortaria em 1000 números, e o editor mostraria a lista parcial e
  // calcularia o aviso de agenda com ela. Aqui não dá para reusar o lerConexoes, que só lê WhatsApp da Evolution.
  const linhas: Array<{ id: string; name: string | null; config: Record<string, unknown> | null; ai_agent_id: string; created_at: string }> = [];
  let depoisDe: string | null = null;
  for (;;) {
    let consulta = admin
      .from('channel_connections')
      .select('id, name, config, ai_agent_id, created_at')
      .eq('organization_id', tenantId)
      .in('ai_agent_id', agentIds);
    if (depoisDe) consulta = consulta.gt('id', depoisDe);
    const { data, error } = await consulta.order('id', { ascending: true }).limit(PAGINA_DE_NUMEROS);
    if (error) throw new Error(`channel_connections: ${error.message}`);
    const pagina = (data ?? []) as typeof linhas;
    linhas.push(...pagina);
    if (pagina.length < PAGINA_DE_NUMEROS) break;
    depoisDe = pagina[pagina.length - 1].id;
  }
  linhas.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  for (const c of linhas) {
    const agente = c.ai_agent_id as string;
    const lista = porAgente.get(agente) ?? [];
    lista.push({
      id: c.id as string,
      nome: (c.name as string | null) || 'Número sem nome',
      temAgenda: resolveConversationCalendarConfig(c.config as Record<string, unknown> | null) !== null,
    });
    porAgente.set(agente, lista);
  }
  return porAgente;
}

async function lerCliente(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await admin.from('organizations').select('id, name').eq('id', tenantId).maybeSingle();
  if (error) throw new Error(`organizations: ${error.message}`);
  return data ? { id: data.id as string, nome: (data.name as string | null) || 'Cliente' } : null;
}

function resumoDaVersao(v: LinhaDaVersao, nomes: Map<string, string>): VersaoResumo {
  return {
    id: v.id,
    versao: v.version,
    origem: v.source,
    restauradaDe: v.restored_from,
    nota: v.note,
    publicadaEm: v.published_at,
    publicadaPor: v.published_by ? nomes.get(v.published_by) ?? ALGUEM : null,
  };
}

function versaoCompleta(v: LinhaDaVersao, nomes: Map<string, string>): VersaoCompleta {
  return { ...resumoDaVersao(v, nomes), prompt: v.prompt ?? '', ajustes: v.settings ?? {}, modelo: v.model ?? null };
}

const comoFalha = (erro: unknown, contexto: string) =>
  traduzirErroDoBanco({ message: erro instanceof Error ? erro.message : String(erro) }, contexto);

export async function listarAgentes(
  c: Clientes,
  tenantId: string,
): Promise<Resultado<{ cliente: { id: string; nome: string }; agentes: AgenteNaLista[] }>> {
  try {
    const cliente = await lerCliente(c.admin, tenantId);
    if (!cliente) return falha(404, 'CLIENTE_INEXISTENTE', 'Cliente não encontrado.');
    const agentes = await c.usuario
      .from('ai_agents')
      .select(CAMPOS_DO_AGENTE)
      .eq('organization_id', tenantId)
      .order('created_at', { ascending: true });
    if (agentes.error) return traduzirErroDoBanco(agentes.error, 'listar agentes');
    const linhas = (agentes.data ?? []) as LinhaDoAgente[];
    const publicadas = linhas.map((a) => a.published_version_id).filter((id): id is string => Boolean(id));
    let versoes: LinhaDaVersao[] = [];
    if (publicadas.length > 0) {
      const lidas = await c.usuario
        .from('ai_agent_versions')
        .select(`${CAMPOS_DA_VERSAO}, prompt`)
        .eq('organization_id', tenantId)
        .in('id', publicadas);
      if (lidas.error) return traduzirErroDoBanco(lidas.error, 'listar versoes publicadas');
      versoes = (lidas.data ?? []) as LinhaDaVersao[];
    }
    const porId = new Map(versoes.map((v) => [v.id, v]));
    const [nomes, numeros] = await Promise.all([
      nomesDasPessoas(c.admin, versoes.map((v) => v.published_by)),
      numerosDosAgentes(c.admin, tenantId, linhas.map((a) => a.id)),
    ]);
    return {
      ok: true,
      dados: {
        cliente,
        agentes: linhas.map((a) => {
          const publicada = a.published_version_id ? porId.get(a.published_version_id) ?? null : null;
          const rascunho = promptDoRascunho(a.draft);
          return {
            id: a.id,
            nome: a.name,
            publicada: publicada ? resumoDaVersao(publicada, nomes) : null,
            rascunhoPendente: rascunho !== null && rascunho !== (publicada?.prompt ?? null),
            numeros: numeros.get(a.id) ?? [],
          };
        }),
      },
    };
  } catch (erro) {
    return comoFalha(erro, 'listar agentes');
  }
}

export async function lerAgente(c: Clientes, tenantId: string, agentId: string): Promise<Resultado<AgenteNoEditor>> {
  try {
    const cliente = await lerCliente(c.admin, tenantId);
    if (!cliente) return falha(404, 'CLIENTE_INEXISTENTE', 'Cliente não encontrado.');
    const lido = await c.usuario
      .from('ai_agents')
      .select(CAMPOS_DO_AGENTE)
      .eq('organization_id', tenantId)
      .eq('id', agentId)
      .maybeSingle();
    if (lido.error) return traduzirErroDoBanco(lido.error, 'ler agente');
    if (!lido.data) return traduzirErroDoBanco({ message: 'agente_inexistente' }, 'ler agente');
    const agente = lido.data as LinhaDoAgente;
    let publicada: LinhaDaVersao | null = null;
    if (agente.published_version_id) {
      const versao = await c.usuario
        .from('ai_agent_versions')
        .select(CAMPOS_DA_VERSAO_COMPLETA)
        .eq('organization_id', tenantId)
        .eq('agent_id', agentId)
        .eq('id', agente.published_version_id)
        .maybeSingle();
      if (versao.error) return traduzirErroDoBanco(versao.error, 'ler versao publicada');
      publicada = (versao.data as LinhaDaVersao | null) ?? null;
    }
    const [nomes, numeros] = await Promise.all([
      nomesDasPessoas(c.admin, [publicada?.published_by ?? null, agente.draft_updated_by]),
      numerosDosAgentes(c.admin, tenantId, [agentId]),
    ]);
    return {
      ok: true,
      dados: {
        id: agente.id,
        nome: agente.name,
        cliente,
        publicada: publicada ? versaoCompleta(publicada, nomes) : null,
        rascunho: {
          prompt: promptDoRascunho(agente.draft),
          revisao: agente.draft_revision,
          atualizadoEm: agente.draft_updated_at,
          atualizadoPor: agente.draft_updated_by ? nomes.get(agente.draft_updated_by) ?? ALGUEM : null,
        },
        numeros: numeros.get(agentId) ?? [],
      },
    };
  } catch (erro) {
    return comoFalha(erro, 'ler agente');
  }
}

async function agenteExiste(c: Clientes, tenantId: string, agentId: string): Promise<Falha | null> {
  const lido = await c.usuario.from('ai_agents').select('id').eq('organization_id', tenantId).eq('id', agentId).maybeSingle();
  if (lido.error) return traduzirErroDoBanco(lido.error, 'conferir agente');
  return lido.data ? null : traduzirErroDoBanco({ message: 'agente_inexistente' }, 'conferir agente');
}

export const VERSOES_POR_PAGINA = 50;

/**
 * Uma página do histórico, da mais nova para a mais antiga. `antesDe` traz as versões de número menor que ele (a
 * página seguinte); sem ele, a primeira. A tela pede mais enquanto `temMais` for verdadeiro: qualquer versão do
 * agente continua comparável e restaurável, por mais longo que o histórico fique (SPEC: "quaisquer duas").
 */
export async function listarVersoes(
  c: Clientes,
  tenantId: string,
  agentId: string,
  pagina: { antesDe?: number; limite?: number } = {},
): Promise<Resultado<PaginaDeVersoes>> {
  try {
    const naoExiste = await agenteExiste(c, tenantId, agentId);
    if (naoExiste) return naoExiste;
    const limite = Math.min(Math.max(pagina.limite ?? VERSOES_POR_PAGINA, 1), 100);
    let consulta = c.usuario
      .from('ai_agent_versions')
      .select(CAMPOS_DA_VERSAO)
      .eq('organization_id', tenantId)
      .eq('agent_id', agentId);
    if (pagina.antesDe !== undefined) consulta = consulta.lt('version', pagina.antesDe);
    // Um a mais que o limite: é assim que se sabe se existe a página seguinte.
    const lidas = await consulta.order('version', { ascending: false }).limit(limite + 1);
    if (lidas.error) return traduzirErroDoBanco(lidas.error, 'listar versoes');
    const linhas = (lidas.data ?? []) as LinhaDaVersao[];
    const versoes = linhas.slice(0, limite);
    const nomes = await nomesDasPessoas(c.admin, versoes.map((v) => v.published_by));
    return {
      ok: true,
      dados: { versoes: versoes.map((v) => resumoDaVersao(v, nomes)), temMais: linhas.length > limite },
    };
  } catch (erro) {
    return comoFalha(erro, 'listar versoes');
  }
}

export async function lerVersao(c: Clientes, tenantId: string, agentId: string, versao: number): Promise<Resultado<VersaoCompleta>> {
  try {
    const lida = await c.usuario
      .from('ai_agent_versions')
      .select(CAMPOS_DA_VERSAO_COMPLETA)
      .eq('organization_id', tenantId)
      .eq('agent_id', agentId)
      .eq('version', versao)
      .maybeSingle();
    if (lida.error) return traduzirErroDoBanco(lida.error, 'ler versao');
    if (!lida.data) return traduzirErroDoBanco({ message: 'versao_inexistente' }, 'ler versao');
    const linha = lida.data as LinhaDaVersao;
    const nomes = await nomesDasPessoas(c.admin, [linha.published_by]);
    return { ok: true, dados: versaoCompleta(linha, nomes) };
  } catch (erro) {
    return comoFalha(erro, 'ler versao');
  }
}

export async function salvarRascunho(
  c: Clientes,
  p: { tenantId: string; agentId: string; revisao: number; prompt: string },
): Promise<Resultado<{ revisao: number }>> {
  const r = await c.usuario.rpc('save_ai_agent_draft', {
    p_organization_id: p.tenantId,
    p_agent_id: p.agentId,
    p_expected_revision: p.revisao,
    p_prompt: p.prompt,
  });
  if (r.error) return traduzirErroDoBanco(r.error, 'salvar rascunho');
  if (typeof r.data !== 'number') return traduzirErroDoBanco({ message: 'salvar rascunho sem revisao de volta' }, 'salvar rascunho');
  return { ok: true, dados: { revisao: r.data } };
}

type LinhaDeVolta = { out_version?: number; out_version_id?: string; out_draft_revision?: number } | null;
const primeiraLinha = (data: unknown): LinhaDeVolta => (Array.isArray(data) ? data[0] ?? null : (data as LinhaDeVolta));

/**
 * Publica o rascunho GRAVADO. Confere revisão e versão contra o que a tela mostrou (409 cedo), roda a verificação
 * ao vivo de novo (erro = 422; aviso não confirmado = 422 com a verificação, para a tela pedir a confirmação) e só então
 * chama a função, que trava a linha e confere tudo de novo: o que foi publicado é o que foi verificado.
 */
export async function publicarComVerificacao(
  c: Clientes,
  p: { tenantId: string; agentId: string; versaoEsperada: number; revisao: number; nota: string | null; confirmarAvisos: string[] },
): Promise<Resultado<{ versao: number; versaoId: string }>> {
  const lido = await lerAgente(c, p.tenantId, p.agentId);
  if (!lido.ok) return lido;
  const agente = lido.dados;
  if (agente.rascunho.revisao !== p.revisao) return traduzirErroDoBanco({ message: 'rascunho_mudou' }, 'publicar');
  if ((agente.publicada?.versao ?? 0) !== p.versaoEsperada) return traduzirErroDoBanco({ message: 'versao_publicada_mudou' }, 'publicar');
  if (agente.rascunho.prompt === null) return traduzirErroDoBanco({ message: 'rascunho_vazio' }, 'publicar');

  const verificacao = verificarPrompt({
    rascunho: agente.rascunho.prompt,
    publicado: agente.publicada?.prompt ?? null,
    numerosLigadosComAgenda: agente.numeros.filter((n) => n.temAgenda).length,
  });
  if (verificacao.erros.length > 0) {
    return falha(422, 'VERIFICACAO_BLOQUEIA', 'A verificação encontrou erro no rascunho. Corrija antes de publicar.', { verificacao });
  }
  if (avisosNaoConfirmados(verificacao, p.confirmarAvisos).length > 0) {
    return falha(422, 'AVISOS_NAO_CONFIRMADOS', 'Confirme os avisos da verificação antes de publicar.', { verificacao });
  }

  const r = await c.usuario.rpc('publish_ai_agent_version', {
    p_organization_id: p.tenantId,
    p_agent_id: p.agentId,
    p_expected_version: p.versaoEsperada,
    p_expected_revision: p.revisao,
    p_note: p.nota,
  });
  if (r.error) return traduzirErroDoBanco(r.error, 'publicar');
  const linha = primeiraLinha(r.data);
  if (!linha?.out_version || !linha.out_version_id) return traduzirErroDoBanco({ message: 'publicar sem linha de volta' }, 'publicar');
  return { ok: true, dados: { versao: linha.out_version, versaoId: linha.out_version_id } };
}

export async function restaurarVersao(
  c: Clientes,
  p: { tenantId: string; agentId: string; versao: number; versaoEsperada: number; revisao: number; nota: string | null },
): Promise<Resultado<{ versao: number; versaoId: string; revisao: number }>> {
  const r = await c.usuario.rpc('restore_ai_agent_version', {
    p_organization_id: p.tenantId,
    p_agent_id: p.agentId,
    p_version: p.versao,
    p_expected_version: p.versaoEsperada,
    p_expected_revision: p.revisao,
    p_note: p.nota,
  });
  if (r.error) return traduzirErroDoBanco(r.error, 'restaurar');
  const linha = primeiraLinha(r.data);
  if (!linha?.out_version || !linha.out_version_id || typeof linha.out_draft_revision !== 'number') {
    return traduzirErroDoBanco({ message: 'restaurar sem linha de volta' }, 'restaurar');
  }
  return { ok: true, dados: { versao: linha.out_version, versaoId: linha.out_version_id, revisao: linha.out_draft_revision } };
}
