/**
 * Intencao de envio: a chave de idempotencia identifica a TENTATIVA LOGICA, nao o clique.
 *
 * O caso raiz: a mensagem chegou ao WhatsApp mas a resposta HTTP se perdeu. O compositor mantem o
 * texto (comportamento que ja existia) e, sem isto aqui, o segundo clique gerava chave nova no
 * servidor — segunda mensagem para o lead. Com a intencao pendente, o retry reutiliza a MESMA
 * chave e o servidor devolve a tentativa original.
 *
 * Persistencia em sessionStorage com fallback TOTAL em memoria: aba privada, quota estourada,
 * SSR e storage bloqueado nunca quebram o envio — no pior caso a chave so nao sobrevive ao
 * recarregamento, que e exatamente o comportamento antigo.
 */

export type PedidoDaIntencao = {
  corpo: string;
  direcao: 'outbound' | 'internal';
  anexoPath: string | null;
};

export type IntencaoPendente = PedidoDaIntencao & { chave: string };

export type StorageDeIntencoes = {
  ler(chave: string): string | null;
  gravar(chave: string, valor: string): void;
  remover(chave: string): void;
};

type BackingLike = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};

const PREFIXO = 'basecrm:intencao-envio:';

export function gerarChaveDeEnvio(threadId: string) {
  const aleatorio =
    globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `manual:${threadId}:${aleatorio}`;
}

/**
 * Envelopa o sessionStorage (ou o que for passado) com try/catch em toda operacao e espelho em
 * memoria. Leitura prefere o backing (e o que sobrevive ao reload); qualquer excecao cai no
 * espelho sem propagar.
 */
export function criarStorageDeIntencoes(base?: BackingLike | null): StorageDeIntencoes {
  const backing =
    base !== undefined
      ? base
      : typeof sessionStorage === 'undefined'
        ? null
        : sessionStorage;
  const memoria = new Map<string, string>();

  return {
    ler(chave) {
      try {
        const doBacking = backing?.getItem(chave);
        if (typeof doBacking === 'string') return doBacking;
      } catch {
        // storage bloqueado: segue pela memoria
      }
      return memoria.get(chave) ?? null;
    },
    gravar(chave, valor) {
      memoria.set(chave, valor);
      try {
        backing?.setItem(chave, valor);
      } catch {
        // quota/privado: fica so na memoria
      }
    },
    remover(chave) {
      memoria.delete(chave);
      try {
        backing?.removeItem(chave);
      } catch {
        // nada a fazer
      }
    },
  };
}

function mesmoPedido(a: PedidoDaIntencao, b: PedidoDaIntencao) {
  return a.corpo === b.corpo && a.direcao === b.direcao && a.anexoPath === b.anexoPath;
}

export function lerIntencaoPendente(storage: StorageDeIntencoes, threadId: string): IntencaoPendente | null {
  const cru = storage.ler(`${PREFIXO}${threadId}`);
  if (!cru) return null;
  try {
    const dado = JSON.parse(cru) as Partial<IntencaoPendente> | null;
    if (!dado || typeof dado.chave !== 'string' || typeof dado.corpo !== 'string') return null;
    return {
      chave: dado.chave,
      corpo: dado.corpo,
      direcao: dado.direcao === 'internal' ? 'internal' : 'outbound',
      anexoPath: typeof dado.anexoPath === 'string' ? dado.anexoPath : null,
    };
  } catch {
    return null;
  }
}

/** Mesma intencao -> mesma chave; pedido diferente -> intencao nova (a antiga e substituida). */
export function obterChaveDeEnvio(
  storage: StorageDeIntencoes,
  threadId: string,
  pedido: PedidoDaIntencao,
): string {
  const pendente = lerIntencaoPendente(storage, threadId);
  if (pendente && mesmoPedido(pendente, pedido)) return pendente.chave;

  const chave = gerarChaveDeEnvio(threadId);
  storage.gravar(`${PREFIXO}${threadId}`, JSON.stringify({ chave, ...pedido }));
  return chave;
}

/** O envio foi confirmado (ou rejeitado de vez): a proxima tentativa identica e intencao NOVA. */
export function resolverIntencao(storage: StorageDeIntencoes, threadId: string) {
  storage.remover(`${PREFIXO}${threadId}`);
}
