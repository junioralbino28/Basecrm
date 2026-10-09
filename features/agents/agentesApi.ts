import type {
  AgenteNaLista,
  AgenteNoEditor,
  InicioDoAgente,
  ModeloCompleto,
  ModeloNaLista,
  MensagemSimulada,
  PaginaDeVersoes,
  RespostaDoRetrato,
  ResultadoDoTeste,
  RetratoDoTeste,
  VersaoCompleta,
} from '@/lib/agents/tiposDoEditor';
import type { ResultadoDaVerificacao } from '@/lib/agents/verificarPrompt';
import type { CursorDeClientes } from '@/lib/platform/cursorDeClientes';

/** Erro de uma rota da Central, com o código e, no 422 de publicar, a verificação feita pelo servidor. */
export class ErroDaApi extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codigo: string | null,
    readonly verificacao: ResultadoDaVerificacao | null,
  ) {
    super(message);
  }
}

async function pedir<T>(url: string, init: RequestInit = {}): Promise<T> {
  const resposta = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new ErroDaApi(corpo?.error || `Falha (HTTP ${resposta.status}).`, resposta.status, corpo?.code ?? null, corpo?.verificacao ?? null);
  }
  return corpo as T;
}

const base = (tenantId: string) => `/api/platform/tenants/${tenantId}/agents`;
const MODELOS = '/api/platform/agency/agent-templates';

type CorpoDoModeloNovo =
  | { nome: string; descricao?: string; prompt: string }
  | { nome: string; descricao?: string; deAgente: { tenantId: string; agenteId: string; versaoEsperada: number } };

export type { CursorDeClientes };

export const agentesApi = {
  /** Bloco 2: cria um agente neste cliente; em modelo e cópia o texto é montado no servidor. */
  criar: (tenantId: string, corpo: { nome: string; inicio: InicioDoAgente }) =>
    pedir<{ agenteId: string }>(base(tenantId), { method: 'POST', body: JSON.stringify(corpo) }),
  /**
   * Os clientes da agência, para a origem de uma cópia: 100 por página, do mais novo ao mais antigo. `busca` filtra pelo
   * nome; `proxima` (o cursor que a página anterior devolveu) traz a página seguinte.
   */
  clientes: (busca = '', proxima?: CursorDeClientes | null) => {
    const q = new URLSearchParams();
    if (busca) q.set('busca', busca);
    if (proxima) {
      q.set('antesDe', proxima.antesDe);
      q.set('antesDeId', proxima.antesDeId);
    }
    const sufixo = q.toString();
    return pedir<{ tenants: Array<{ id: string; name: string; created_at?: string }>; proxima?: CursorDeClientes | null }>(
      `/api/platform/tenants${sufixo ? `?${sufixo}` : ''}`,
    );
  },
  modelos: {
    listar: (arquivados = false) => pedir<{ modelos: ModeloNaLista[] }>(`${MODELOS}${arquivados ? '?arquivados=1' : ''}`),
    ler: (id: string) => pedir<ModeloCompleto>(`${MODELOS}/${id}`),
    criar: (corpo: CorpoDoModeloNovo) => pedir<{ id: string }>(MODELOS, { method: 'POST', body: JSON.stringify(corpo) }),
    salvar: (id: string, corpo: { nome: string; descricao?: string; prompt: string; revisaoEsperada: number }) =>
      pedir<{ id: string; revisao: number }>(`${MODELOS}/${id}`, { method: 'PUT', body: JSON.stringify(corpo) }),
    arquivar: (id: string, corpo: { arquivar: boolean; revisaoEsperada: number }) =>
      pedir<{ revisao: number }>(`${MODELOS}/${id}/archive`, { method: 'POST', body: JSON.stringify(corpo) }),
  },
  listar: (tenantId: string) =>
    pedir<{ cliente: { id: string; nome: string }; agentes: AgenteNaLista[] }>(base(tenantId)),
  ler: (tenantId: string, agentId: string) =>
    pedir<{ agente: AgenteNoEditor }>(`${base(tenantId)}/${agentId}`),
  /** Renomear e excluir (SPEC-renomear-excluir.md). Excluir manda o estado que a tela mostrou; se mudou, 409. */
  renomear: (tenantId: string, agentId: string, nome: string) =>
    pedir<{ nome: string }>(`${base(tenantId)}/${agentId}/rename`, { method: 'POST', body: JSON.stringify({ nome }) }),
  excluir: (
    tenantId: string,
    agentId: string,
    esperado: { nomeEsperado: string; revisaoEsperada: number; versaoPublicadaEsperada: string | null },
  ) =>
    pedir<{ excluido: true; versoesExcluidas: number }>(`${base(tenantId)}/${agentId}/delete`, {
      method: 'POST',
      body: JSON.stringify(esperado),
    }),
  salvarRascunho: (tenantId: string, agentId: string, corpo: { prompt: string; revisao: number }) =>
    pedir<{ revisao: number }>(`${base(tenantId)}/${agentId}/draft`, { method: 'PUT', body: JSON.stringify(corpo) }),
  publicar: (
    tenantId: string,
    agentId: string,
    corpo: { versaoEsperada: number; revisao: number; nota?: string; confirmarAvisos: string[] },
  ) => pedir<{ versao: number; versaoId: string }>(`${base(tenantId)}/${agentId}/publish`, { method: 'POST', body: JSON.stringify(corpo) }),
  /** Uma página do histórico; `antesDe` (o menor número já carregado) traz a seguinte. */
  listarVersoes: (tenantId: string, agentId: string, antesDe?: number) =>
    pedir<PaginaDeVersoes>(`${base(tenantId)}/${agentId}/versions${antesDe ? `?antesDe=${antesDe}` : ''}`),
  lerVersao: (tenantId: string, agentId: string, versao: number) =>
    pedir<{ versao: VersaoCompleta }>(`${base(tenantId)}/${agentId}/versions/${versao}`),
  restaurar: (
    tenantId: string,
    agentId: string,
    corpo: { versao: number; versaoEsperada: number; revisao: number; nota?: string },
  ) => pedir<{ versao: number; versaoId: string; revisao: number }>(`${base(tenantId)}/${agentId}/restore`, { method: 'POST', body: JSON.stringify(corpo) }),
  /** Testa o rascunho numa conversa simulada (fatia 3): nada é enviado nem gravado. */
  testar: (
    tenantId: string,
    agentId: string,
    corpo: { revisao: number; mensagens: MensagemSimulada[]; numeroId?: string | null; nomeDoLead?: string },
  ) => pedir<ResultadoDoTeste>(`${base(tenantId)}/${agentId}/test`, { method: 'POST', body: JSON.stringify(corpo) }),
  /** Explica um teste pelo retrato que a rota do teste devolveu (D7): sem reler agente, agenda nem relógio. */
  explicar: (tenantId: string, agentId: string, corpo: { revisao: number; retrato: RetratoDoTeste; resposta: RespostaDoRetrato }) =>
    pedir<{ explicacao: string }>(`${base(tenantId)}/${agentId}/test/explain`, { method: 'POST', body: JSON.stringify(corpo) }),
};
