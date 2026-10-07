export type LinhaDaComparacao = { tipo: 'igual' | 'removida' | 'adicionada'; texto: string };

/** Acima disto (linhas de A × linhas de B) a tela não compara linha a linha: a tabela teria uns 16 MB. */
export const LIMITE_DE_CELULAS = 4_000_000;

/** Comparação linha a linha pela subsequência comum mais longa. Null quando o texto é grande demais para a tela. */
export function compararLinhas(antes: string, depois: string): LinhaDaComparacao[] | null {
  const a = antes.split('\n');
  const b = depois.split('\n');
  const n = a.length;
  const m = b.length;
  if (n * m > LIMITE_DE_CELULAS) return null;

  const largura = m + 1;
  const tabela = new Uint32Array((n + 1) * largura);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      tabela[i * largura + j] = a[i] === b[j]
        ? tabela[(i + 1) * largura + j + 1] + 1
        : Math.max(tabela[(i + 1) * largura + j], tabela[i * largura + j + 1]);
    }
  }

  const saida: LinhaDaComparacao[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      saida.push({ tipo: 'igual', texto: a[i] });
      i += 1;
      j += 1;
    } else if (tabela[(i + 1) * largura + j] >= tabela[i * largura + j + 1]) {
      saida.push({ tipo: 'removida', texto: a[i] });
      i += 1;
    } else {
      saida.push({ tipo: 'adicionada', texto: b[j] });
      j += 1;
    }
  }
  while (i < n) saida.push({ tipo: 'removida', texto: a[i++] });
  while (j < m) saida.push({ tipo: 'adicionada', texto: b[j++] });
  return saida;
}

export type DiferencaDeAjuste = { campo: string; antes: string; depois: string };
type LadoDosAjustes = { ajustes: Record<string, unknown>; modelo: string | null };

const mostrar = (valor: unknown) => (valor === undefined ? '(sem valor)' : JSON.stringify(valor));

/** Ajustes campo a campo (ordem alfabética) e o modelo por último. Nesta fatia as versões têm ajustes {} e modelo nulo. */
export function compararAjustes(antes: LadoDosAjustes, depois: LadoDosAjustes): DiferencaDeAjuste[] {
  const campos = [...new Set([...Object.keys(antes.ajustes), ...Object.keys(depois.ajustes)])].sort();
  const diferencas = campos
    .filter((campo) => JSON.stringify(antes.ajustes[campo]) !== JSON.stringify(depois.ajustes[campo]))
    .map((campo) => ({ campo, antes: mostrar(antes.ajustes[campo]), depois: mostrar(depois.ajustes[campo]) }));
  if (antes.modelo !== depois.modelo) {
    diferencas.push({
      campo: 'modelo',
      antes: antes.modelo ?? 'o padrão da organização',
      depois: depois.modelo ?? 'o padrão da organização',
    });
  }
  return diferencas;
}
