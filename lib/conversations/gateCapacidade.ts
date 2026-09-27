/**
 * Gate de capacidade da Aurora (decisao do Junior, 27/09/2026, doc
 * FUNIL-AURORA-GATE-E-CONSULTORIA.md): so vai para a reuniao quem confirma
 * R$1.000/mes de verba + servico a parte; quem nao passa recebe a oferta da
 * Consultoria de Diagnostico.
 *
 * Este modulo so decide COMO o resultado e gravado na metadata da conversa.
 * A sessao da campanha le por anuncio de origem (lastAdClick.sourceId), e o
 * numero dela e o PRIMEIRO resultado — por isso `primeiroResultado` e imutavel.
 * O campo `resultado` reflete o estado atual (um lead pode reprovar hoje e
 * voltar com verba semana que vem), com uma trava: `unanswered` nunca rebaixa
 * um `passed`/`failed` ja decidido.
 */

export type ResultadoDoGate = 'passed' | 'failed' | 'unanswered';

export type GateCapacidadeMetadata = {
  resultado: ResultadoDoGate;
  em: string;
  primeiroResultado: ResultadoDoGate;
  primeiroEm: string;
};

const RESULTADOS: readonly ResultadoDoGate[] = ['passed', 'failed', 'unanswered'];

/** Le o registro do gate da metadata da conversa; formato invalido conta como ausente. */
export function lerGateCapacidade(metadata: unknown): GateCapacidadeMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const bruto = (metadata as Record<string, unknown>).gateCapacidade;
  if (!bruto || typeof bruto !== 'object') return null;
  const g = bruto as Record<string, unknown>;
  if (!RESULTADOS.includes(g.resultado as ResultadoDoGate)) return null;
  if (typeof g.em !== 'string') return null;
  return {
    resultado: g.resultado as ResultadoDoGate,
    em: g.em,
    primeiroResultado: RESULTADOS.includes(g.primeiroResultado as ResultadoDoGate)
      ? (g.primeiroResultado as ResultadoDoGate)
      : (g.resultado as ResultadoDoGate),
    primeiroEm: typeof g.primeiroEm === 'string' ? g.primeiroEm : g.em,
  };
}

/**
 * Aplica um resultado novo do gate sobre a metadata que vai ser gravada.
 * - `resultado` null/undefined: devolve a metadata como esta (turno sem gate).
 * - primeiro registro: grava atual e primeiro iguais.
 * - `unanswered` nunca sobrescreve um `passed`/`failed` ja decidido.
 * - `primeiroResultado`/`primeiroEm` nunca mudam depois de gravados.
 */
export function aplicarGateCapacidade(
  proximaMetadata: Record<string, unknown>,
  metadataAnterior: unknown,
  resultado: ResultadoDoGate | null | undefined,
  em: string,
): Record<string, unknown> {
  if (!resultado) return proximaMetadata;

  const anterior = lerGateCapacidade(metadataAnterior);
  if (!anterior) {
    return {
      ...proximaMetadata,
      gateCapacidade: {
        resultado,
        em,
        primeiroResultado: resultado,
        primeiroEm: em,
      } satisfies GateCapacidadeMetadata,
    };
  }

  const decididoNaoRebaixa = resultado === 'unanswered' && anterior.resultado !== 'unanswered';
  return {
    ...proximaMetadata,
    gateCapacidade: {
      resultado: decididoNaoRebaixa ? anterior.resultado : resultado,
      em: decididoNaoRebaixa ? anterior.em : em,
      primeiroResultado: anterior.primeiroResultado,
      primeiroEm: anterior.primeiroEm,
    } satisfies GateCapacidadeMetadata,
  };
}
