import { describe, expect, it } from 'vitest';
import {
  criarStorageDeIntencoes,
  gerarChaveDeEnvio,
  lerIntencaoPendente,
  obterChaveDeEnvio,
  resolverIntencao,
} from './intencaoDeEnvio';

/**
 * A chave de idempotencia identifica a TENTATIVA LOGICA, nao o clique: enquanto o pedido for o
 * mesmo (corpo/direcao/anexo), o retry reutiliza a MESMA chave — e o servidor devolve a tentativa
 * original em vez de mandar uma segunda mensagem para o lead.
 */

const THREAD = '33333333-3333-4333-8333-333333333333';
const PEDIDO = { corpo: 'Oi, confirmo amanha as 14h', direcao: 'outbound' as const, anexoPath: null };

/** sessionStorage de mentira, compartilhavel entre "recarregamentos". */
function backingFalso(comportamento: 'normal' | 'quebrado' = 'normal') {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (k: string) => {
      if (comportamento === 'quebrado') throw new Error('storage bloqueado');
      return dados.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (comportamento === 'quebrado') throw new Error('storage bloqueado');
      dados.set(k, v);
    },
    removeItem: (k: string) => {
      if (comportamento === 'quebrado') throw new Error('storage bloqueado');
      dados.delete(k);
    },
  };
}

describe('obterChaveDeEnvio', () => {
  it('o MESMO pedido reutiliza a MESMA chave — o retry nao vira segunda mensagem', () => {
    const storage = criarStorageDeIntencoes(backingFalso());
    const primeira = obterChaveDeEnvio(storage, THREAD, PEDIDO);
    const segunda = obterChaveDeEnvio(storage, THREAD, { ...PEDIDO });
    expect(segunda).toBe(primeira);
    expect(primeira).toMatch(new RegExp(`^manual:${THREAD}:`));
  });

  it('pedido DIFERENTE ganha chave nova — mensagem nova e deliberada', () => {
    const storage = criarStorageDeIntencoes(backingFalso());
    const primeira = obterChaveDeEnvio(storage, THREAD, PEDIDO);
    expect(obterChaveDeEnvio(storage, THREAD, { ...PEDIDO, corpo: 'outro texto' })).not.toBe(primeira);
  });

  it('anexo diferente tambem e pedido diferente', () => {
    const storage = criarStorageDeIntencoes(backingFalso());
    const semAnexo = obterChaveDeEnvio(storage, THREAD, PEDIDO);
    expect(
      obterChaveDeEnvio(storage, THREAD, { ...PEDIDO, corpo: '', anexoPath: 'tenant/foto.jpg' }),
    ).not.toBe(semAnexo);
  });

  it('threads diferentes nao dividem intencao', () => {
    const storage = criarStorageDeIntencoes(backingFalso());
    const daThread = obterChaveDeEnvio(storage, THREAD, PEDIDO);
    expect(obterChaveDeEnvio(storage, 'outra-thread', PEDIDO)).not.toBe(daThread);
    // E a da thread original continua reutilizavel.
    expect(obterChaveDeEnvio(storage, THREAD, PEDIDO)).toBe(daThread);
  });
});

describe('resolverIntencao', () => {
  it('depois do sucesso, o proximo envio identico e INTENCAO NOVA com chave nova', () => {
    const storage = criarStorageDeIntencoes(backingFalso());
    const primeira = obterChaveDeEnvio(storage, THREAD, PEDIDO);
    resolverIntencao(storage, THREAD);
    expect(obterChaveDeEnvio(storage, THREAD, PEDIDO)).not.toBe(primeira);
  });
});

describe('lerIntencaoPendente: a restauracao pos-recarregamento', () => {
  it('a intencao sobrevive a um "reload" (novo wrapper sobre o MESMO backing) com a MESMA chave', () => {
    const backing = backingFalso();
    const antes = criarStorageDeIntencoes(backing);
    const chave = obterChaveDeEnvio(antes, THREAD, PEDIDO);

    // "Recarregou a pagina": wrapper novo, backing igual — como o sessionStorage real.
    const depois = criarStorageDeIntencoes(backing);
    const pendente = lerIntencaoPendente(depois, THREAD);
    expect(pendente).toMatchObject({ chave, corpo: PEDIDO.corpo, direcao: 'outbound' });
    expect(obterChaveDeEnvio(depois, THREAD, PEDIDO)).toBe(chave);
  });

  it('sem nada pendente devolve null; depois de resolver tambem', () => {
    const storage = criarStorageDeIntencoes(backingFalso());
    expect(lerIntencaoPendente(storage, THREAD)).toBeNull();
    obterChaveDeEnvio(storage, THREAD, PEDIDO);
    resolverIntencao(storage, THREAD);
    expect(lerIntencaoPendente(storage, THREAD)).toBeNull();
  });

  it('registro corrompido no storage e tratado como nada pendente', () => {
    const backing = backingFalso();
    const storage = criarStorageDeIntencoes(backing);
    backing.dados.set(`basecrm:intencao-envio:${THREAD}`, '{nao é json');
    expect(lerIntencaoPendente(storage, THREAD)).toBeNull();
  });
});

describe('storage indisponivel (aba privada, quota, bloqueio)', () => {
  it('tudo continua funcionando em memoria, sem lancar', () => {
    const storage = criarStorageDeIntencoes(backingFalso('quebrado'));
    const primeira = obterChaveDeEnvio(storage, THREAD, PEDIDO);
    expect(obterChaveDeEnvio(storage, THREAD, PEDIDO)).toBe(primeira);
    expect(lerIntencaoPendente(storage, THREAD)?.chave).toBe(primeira);
    resolverIntencao(storage, THREAD);
    expect(lerIntencaoPendente(storage, THREAD)).toBeNull();
  });

  it('sem backing nenhum (SSR) tambem funciona', () => {
    const storage = criarStorageDeIntencoes(null);
    expect(obterChaveDeEnvio(storage, THREAD, PEDIDO)).toMatch(/^manual:/);
  });
});

describe('gerarChaveDeEnvio', () => {
  it('gera chave unica por chamada, no formato do servidor', () => {
    const a = gerarChaveDeEnvio(THREAD);
    const b = gerarChaveDeEnvio(THREAD);
    expect(a).toMatch(new RegExp(`^manual:${THREAD}:`));
    expect(a).not.toBe(b);
  });
});
