import type { AgenteNaLista, AgenteNoEditor, PaginaDeVersoes, VersaoCompleta } from '@/lib/agents/tiposDoEditor';
import type { ResultadoDaVerificacao } from '@/lib/agents/verificarPrompt';

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

export const agentesApi = {
  listar: (tenantId: string) =>
    pedir<{ cliente: { id: string; nome: string }; agentes: AgenteNaLista[] }>(base(tenantId)),
  ler: (tenantId: string, agentId: string) =>
    pedir<{ agente: AgenteNoEditor }>(`${base(tenantId)}/${agentId}`),
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
};
