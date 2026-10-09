/** Formas que as rotas da Central de Agentes devolvem e a tela lê (fatias 2 e 3). */
import type { AIReplyTiming } from '@/lib/ai/medicaoResposta';
import type { UsoDoModelo } from '@/lib/conversations/aiReplyCore';

export type OrigemDaVersao = 'migration' | 'publish' | 'restore';

export type VersaoResumo = {
  id: string;
  versao: number;
  origem: OrigemDaVersao;
  restauradaDe: number | null;
  nota: string | null;
  publicadaEm: string;
  /** Nome de quem publicou; null na migração (feita pelo script) ou quando a pessoa foi removida. */
  publicadaPor: string | null;
};

export type VersaoCompleta = VersaoResumo & {
  prompt: string;
  ajustes: Record<string, unknown>;
  modelo: string | null;
};

/** Uma página do histórico, da mais nova para a mais antiga; `temMais` diz se há versões mais antigas. */
export type PaginaDeVersoes = { versoes: VersaoResumo[]; temMais: boolean };

export type NumeroDoAgente = { id: string; nome: string; temAgenda: boolean };

export type AgenteNaLista = {
  id: string;
  nome: string;
  publicada: VersaoResumo | null;
  rascunhoPendente: boolean;
  numeros: NumeroDoAgente[];
};

export type AgenteNoEditor = {
  id: string;
  nome: string;
  cliente: { id: string; nome: string };
  publicada: VersaoCompleta | null;
  rascunho: { prompt: string | null; revisao: number; atualizadoEm: string | null; atualizadoPor: string | null };
  numeros: NumeroDoAgente[];
};

/** Fatia 3, teste sem enviar: uma mensagem da conversa simulada. */
export type MensagemSimulada = { autor: 'lead' | 'agente'; texto: string };

/** O que foi ao modelo no teste, assinado pelo servidor; a explicação confere e explica exatamente isto (D7). */
export type RetratoDoTeste = {
  prompt: string;
  provedor: 'google' | 'openai' | 'anthropic';
  modelo: string;
  expiraEm: number;
  assinatura: string;
};

export type RespostaDoRetrato = { partes: string[]; repasse: { tipo: string; motivo: string | null } | null };

export type ResultadoDoTeste = {
  partes: string[];
  oQueFez: {
    repasse: { tipo: string; motivo: string | null } | null;
    horarioPedido: { em: string | null; texto: string | null } | null;
    lead: { nome: string | null; email: string | null; empresa: string | null; segmento: string | null };
    etiquetas: string[] | null;
    gateDeCapacidade: 'passed' | 'failed' | 'unanswered' | null;
    resumo: string | null;
    conversaEncerrada: boolean;
  };
  tempo: AIReplyTiming;
  uso: UsoDoModelo;
  prompt: { origem: 'rascunho' | 'publicada'; revisao: number; versao: number | null; sha256: string };
  numero: { id: string; nome: string; referenciaHipotetica: boolean } | null;
  modelo: string;
  /** Nulo só se o servidor não tiver segredo para assinar; aí a tela não oferece a explicação. */
  retrato: RetratoDoTeste | null;
};

/** Bloco 2: um modelo da agência na biblioteca (as lacunas são calculadas do texto, nunca guardadas à parte). */
export type ModeloNaLista = {
  id: string;
  nome: string;
  descricao: string | null;
  revisao: number;
  lacunas: string[];
  ambiguas: string[];
  arquivado: boolean;
  atualizadoEm: string;
  atualizadoPor: string | null;
  agentesCriados: number;
};

export type ModeloCompleto = ModeloNaLista & { prompt: string };

/** Bloco 2: de onde o agente novo começa. Em modelo e cópia, o texto é montado no banco, nunca enviado pela tela. */
export type InicioDoAgente =
  | { tipo: 'branco' }
  | { tipo: 'modelo'; modeloId: string; revisaoDoModelo: number; respostas: Record<string, string> }
  | { tipo: 'copia'; clienteDeOrigemId: string; agenteId: string; versaoEsperada: number };
