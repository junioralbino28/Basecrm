import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';
import {
  ERROS_DO_BANCO,
  MENSAGEM_ERRO_INTERNO,
  comoFalha,
  falha,
  nomesDasPessoas,
  traduzirErroDoBanco,
  type Clientes,
  type Resultado,
} from './editorAgentes';
import type { InicioDoAgente, ModeloCompleto, ModeloNaLista } from './tiposDoEditor';
import { lacunasAmbiguas, lacunasDoTexto } from './verificarPrompt';

/**
 * Central de Agentes, bloco 2 (SPEC-bloco-2.md; PLAN-bloco-2.md, Task 4): a biblioteca de modelos da agência e a
 * criação de agentes. Leituras pelo cliente do USUÁRIO (a RLS deixa só a agência ver); escritas só pelas funções da
 * migration 20261009120000, também pelo cliente do usuário (o papel é conferido no banco e o autor vem de auth.uid()).
 * O cliente admin só lê nomes de pessoas.
 */

/** "Padrão em branco": o texto neutro de 8 seções que os números sem agente já usam. */
export const CHAVE_DO_PADRAO_EM_BRANCO = 'task_conversations_whatsapp_auto_reply';

type LinhaDoModelo = {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  revision: number;
  archived_at: string | null;
  updated_at: string;
  updated_by: string | null;
};

const CAMPOS_DO_MODELO = 'id, name, description, prompt, revision, archived_at, updated_at, updated_by';
const PAGINA = 1000;

/** Quantos agentes nasceram de cada modelo, pela origem gravada no banco. Em páginas: o PostgREST corta sem erro. */
async function agentesPorModelo(c: Clientes): Promise<Map<string, number>> {
  const contagem = new Map<string, number>();
  let depoisDe: string | null = null;
  for (;;) {
    let consulta = c.usuario.from('ai_agents').select('id, origin').eq('origin->>kind', 'template').order('id').limit(PAGINA);
    if (depoisDe) consulta = consulta.gt('id', depoisDe);
    const lidas = await consulta;
    if (lidas.error) throw new Error(`agentes por modelo: ${lidas.error.message}`);
    const linhas = (lidas.data ?? []) as Array<{ id: string; origin: { templateId?: unknown } | null }>;
    for (const l of linhas) {
      const id = typeof l.origin?.templateId === 'string' ? l.origin.templateId : null;
      if (id) contagem.set(id, (contagem.get(id) ?? 0) + 1);
    }
    if (linhas.length < PAGINA) return contagem;
    depoisDe = linhas[linhas.length - 1].id;
  }
}

function paraLista(l: LinhaDoModelo, nomes: Map<string, string>, usados: Map<string, number>): ModeloNaLista {
  return {
    id: l.id,
    nome: l.name,
    descricao: l.description,
    revisao: l.revision,
    lacunas: lacunasDoTexto(l.prompt),
    ambiguas: lacunasAmbiguas(l.prompt),
    arquivado: Boolean(l.archived_at),
    atualizadoEm: l.updated_at,
    atualizadoPor: l.updated_by ? nomes.get(l.updated_by) ?? 'Alguém da equipe' : null,
    agentesCriados: usados.get(l.id) ?? 0,
  };
}

export async function listarModelos(c: Clientes, p: { arquivados: boolean }): Promise<Resultado<{ modelos: ModeloNaLista[] }>> {
  try {
    let consulta = c.usuario.from('ai_agent_templates').select(CAMPOS_DO_MODELO).order('updated_at', { ascending: false });
    if (!p.arquivados) consulta = consulta.is('archived_at', null);
    const lidos = await consulta;
    if (lidos.error) return traduzirErroDoBanco(lidos.error, 'listar modelos');
    const linhas = (lidos.data ?? []) as LinhaDoModelo[];
    const [nomes, usados] = await Promise.all([nomesDasPessoas(c.admin, linhas.map((l) => l.updated_by)), agentesPorModelo(c)]);
    return { ok: true, dados: { modelos: linhas.map((l) => paraLista(l, nomes, usados)) } };
  } catch (erro) {
    return comoFalha(erro, 'listar modelos');
  }
}

export async function lerModelo(c: Clientes, id: string): Promise<Resultado<ModeloCompleto>> {
  try {
    const lido = await c.usuario.from('ai_agent_templates').select(CAMPOS_DO_MODELO).eq('id', id).maybeSingle();
    if (lido.error) return traduzirErroDoBanco(lido.error, 'ler modelo');
    if (!lido.data) return traduzirErroDoBanco({ message: 'modelo_inexistente' }, 'ler modelo');
    const l = lido.data as LinhaDoModelo;
    const [nomes, usados] = await Promise.all([nomesDasPessoas(c.admin, [l.updated_by]), agentesPorModelo(c)]);
    return { ok: true, dados: { ...paraLista(l, nomes, usados), prompt: l.prompt } };
  } catch (erro) {
    return comoFalha(erro, 'ler modelo');
  }
}

/** Cria (id nulo) ou salva um modelo. A revisão esperada vem da tela; outra pessoa salvou antes = 409. */
export async function salvarModelo(
  c: Clientes,
  p: { id: string | null; revisaoEsperada: number | null; nome: string; descricao: string | null; prompt: string },
): Promise<Resultado<{ id: string; revisao: number }>> {
  try {
    const r = await c.usuario.rpc('save_ai_agent_template', {
      p_template_id: p.id,
      p_expected_revision: p.revisaoEsperada,
      p_name: p.nome,
      p_description: p.descricao,
      p_prompt: p.prompt,
    });
    if (r.error) return traduzirErroDoBanco(r.error, 'salvar modelo');
    const linha = (Array.isArray(r.data) ? r.data[0] : r.data) as { out_id?: string; out_revision?: number } | null;
    if (!linha?.out_id || typeof linha.out_revision !== 'number') {
      return traduzirErroDoBanco({ message: 'salvar modelo sem id de volta' }, 'salvar modelo');
    }
    return { ok: true, dados: { id: linha.out_id, revisao: linha.out_revision } };
  } catch (erro) {
    return comoFalha(erro, 'salvar modelo');
  }
}

export async function criarModeloDeAgente(
  c: Clientes,
  p: { tenantId: string; agenteId: string; versaoEsperada: number; nome: string; descricao: string | null },
): Promise<Resultado<{ id: string }>> {
  try {
    const r = await c.usuario.rpc('create_ai_agent_template_from_agent', {
      p_organization_id: p.tenantId,
      p_agent_id: p.agenteId,
      p_expected_version: p.versaoEsperada,
      p_name: p.nome,
      p_description: p.descricao,
    });
    if (r.error) return traduzirErroDoBanco(r.error, 'modelo a partir de agente');
    if (typeof r.data !== 'string') return traduzirErroDoBanco({ message: 'modelo sem id de volta' }, 'modelo a partir de agente');
    return { ok: true, dados: { id: r.data } };
  } catch (erro) {
    return comoFalha(erro, 'modelo a partir de agente');
  }
}

export async function arquivarModelo(
  c: Clientes,
  p: { id: string; arquivar: boolean; revisaoEsperada: number },
): Promise<Resultado<{ revisao: number }>> {
  try {
    const r = await c.usuario.rpc('set_ai_agent_template_archived', {
      p_template_id: p.id,
      p_archived: p.arquivar,
      p_expected_revision: p.revisaoEsperada,
    });
    if (r.error) return traduzirErroDoBanco(r.error, 'arquivar modelo');
    if (typeof r.data !== 'number') return traduzirErroDoBanco({ message: 'arquivar sem revisao de volta' }, 'arquivar modelo');
    return { ok: true, dados: { revisao: r.data } };
  } catch (erro) {
    return comoFalha(erro, 'arquivar modelo');
  }
}

function comoId(data: unknown, contexto: string): Resultado<{ agenteId: string }> {
  if (typeof data !== 'string') return traduzirErroDoBanco({ message: `${contexto} sem id de volta` }, contexto);
  return { ok: true, dados: { agenteId: data } };
}

/**
 * Cria o agente nos três começos. No modelo, a ordem é fixa (rodada 2 do Codex na SPEC, ponto 2): modelo existe, não
 * arquivado, REVISÃO, e só então as chaves; o banco repete tudo sob trava. Em modelo e cópia, nenhum texto sai daqui.
 */
export async function criarAgente(
  c: Clientes,
  p: { tenantId: string; nome: string; inicio: InicioDoAgente },
): Promise<Resultado<{ agenteId: string }>> {
  try {
    if (p.inicio.tipo === 'branco') {
      const texto = getPromptCatalogMap()[CHAVE_DO_PADRAO_EM_BRANCO]?.defaultTemplate;
      if (!texto) return falha(500, 'ERRO_INTERNO', MENSAGEM_ERRO_INTERNO);
      const r = await c.usuario.rpc('create_ai_agent_blank', { p_organization_id: p.tenantId, p_name: p.nome, p_prompt: texto });
      return r.error ? traduzirErroDoBanco(r.error, 'criar agente em branco') : comoId(r.data, 'criar agente em branco');
    }
    if (p.inicio.tipo === 'modelo') {
      const lido = await c.usuario
        .from('ai_agent_templates')
        .select('prompt, revision, archived_at')
        .eq('id', p.inicio.modeloId)
        .maybeSingle();
      if (lido.error) return traduzirErroDoBanco(lido.error, 'ler modelo');
      if (!lido.data) return traduzirErroDoBanco({ message: 'modelo_inexistente' }, 'ler modelo');
      const modelo = lido.data as { prompt: string; revision: number; archived_at: string | null };
      if (modelo.archived_at) return traduzirErroDoBanco({ message: 'modelo_arquivado' }, 'ler modelo');
      if (modelo.revision !== p.inicio.revisaoDoModelo) return traduzirErroDoBanco({ message: 'modelo_mudou' }, 'ler modelo');
      const lacunas = new Set(lacunasDoTexto(modelo.prompt));
      if (Object.keys(p.inicio.respostas).some((k) => !lacunas.has(k))) {
        return falha(400, ERROS_DO_BANCO.lacuna_inexistente.codigo, ERROS_DO_BANCO.lacuna_inexistente.erro);
      }
      const r = await c.usuario.rpc('create_ai_agent_from_template', {
        p_organization_id: p.tenantId,
        p_name: p.nome,
        p_template_id: p.inicio.modeloId,
        p_expected_template_revision: p.inicio.revisaoDoModelo,
        p_answers: p.inicio.respostas,
      });
      return r.error ? traduzirErroDoBanco(r.error, 'criar agente de modelo') : comoId(r.data, 'criar agente de modelo');
    }
    const r = await c.usuario.rpc('create_ai_agent_from_copy', {
      p_organization_id: p.tenantId,
      p_name: p.nome,
      p_source_organization_id: p.inicio.clienteDeOrigemId,
      p_source_agent_id: p.inicio.agenteId,
      p_expected_source_version: p.inicio.versaoEsperada,
    });
    return r.error ? traduzirErroDoBanco(r.error, 'copiar agente') : comoId(r.data, 'copiar agente');
  } catch (erro) {
    return comoFalha(erro, 'criar agente');
  }
}
