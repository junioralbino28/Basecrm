import { VARIAVEIS_DO_PROMPT, nomeDoMarcador } from './verificarPrompt';

/**
 * Leitura formatada do prompt no editor (mockup aprovado em 29/09: seções com título, texto corrido e as
 * variáveis como etiquetas). Os prompts de hoje marcam seção com uma linha em MAIÚSCULAS terminada em
 * dois-pontos, às vezes com uma nota entre parênteses ("ETIQUETAS DO FUNIL (decisao de 27/09):").
 * Nada se perde: juntarSecoes(dividirEmSecoes(t)) === t, e o teste confere.
 */
export type SecaoDoPrompt = {
  /** A linha original do título; null na abertura (o que vem antes do primeiro título). */
  cabecalho: string | null;
  titulo: string | null;
  nota: string | null;
  /** Texto que veio na mesma linha do título, depois dos dois-pontos. */
  complemento: string | null;
  linhas: string[];
};

/** Medido nos dois prompts em 07/10: acha os 11 títulos da Aurora e os 5 da Julia, e nenhuma linha de texto. */
const TITULO = /^([A-ZÀ-Ý0-9][A-ZÀ-Ý0-9 ,.&'"+–-]*[A-ZÀ-Ý0-9)])(\s*\([^)]*\))?\s*:\s*(.*)$/;
const CONHECIDAS = new Set<string>(VARIAVEIS_DO_PROMPT);

function lerTitulo(linha: string) {
  const m = TITULO.exec(linha);
  return m && /[A-ZÀ-Ý]{3}/.test(m[1]) ? m : null;
}

export function dividirEmSecoes(prompt: string): SecaoDoPrompt[] {
  const secoes: SecaoDoPrompt[] = [{ cabecalho: null, titulo: null, nota: null, complemento: null, linhas: [] }];
  for (const linha of prompt.split('\n')) {
    const m = lerTitulo(linha);
    if (m) {
      secoes.push({
        cabecalho: linha,
        titulo: m[1].trim(),
        nota: m[2] ? m[2].trim().replace(/^\(/, '').replace(/\)$/, '') : null,
        complemento: m[3]?.trim() || null,
        linhas: [],
      });
    } else {
      secoes[secoes.length - 1].linhas.push(linha);
    }
  }
  return secoes;
}

export function juntarSecoes(secoes: SecaoDoPrompt[]): string {
  return secoes.flatMap((s) => (s.cabecalho === null ? s.linhas : [s.cabecalho, ...s.linhas])).join('\n');
}

export type PedacoDaLinha =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'variavel'; texto: string; nome: string; conhecida: boolean };

export function pedacosDaLinha(linha: string): PedacoDaLinha[] {
  const pedacos: PedacoDaLinha[] = [];
  for (const parte of linha.split(/(\{\{[^{}]*\}\})/)) {
    if (!parte) continue;
    const m = /^\{\{([^{}]*)\}\}$/.exec(parte);
    if (m) {
      const nome = nomeDoMarcador(m[1]);
      pedacos.push({ tipo: 'variavel', texto: parte, nome, conhecida: CONHECIDAS.has(nome) });
    } else {
      pedacos.push({ tipo: 'texto', texto: parte });
    }
  }
  return pedacos;
}
