/** Formas que as rotas da Central de Agentes devolvem e a tela lê (fatia 2). */
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
