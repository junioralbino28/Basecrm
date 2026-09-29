/**
 * Medição do tempo de cada resposta da IA de conversa (29/09).
 *
 * Um lead esperou 51 s pela Aurora e não deu para saber onde o tempo foi: o log de runtime da Vercel
 * só existe ao vivo, e a geração repetida no dia seguinte levou 8 a 13 s. Desde então toda resposta
 * gerada por generateConversationAutoReply (a função única de TODA IA de cliente) grava, junto da
 * mensagem enviada, quanto tempo cada etapa levou e quantas chamadas HTTP o provedor recebeu.
 *
 * As novas tentativas automáticas do SDK (maxRetries) acontecem dentro de uma única chamada a
 * generateText e são invisíveis de fora; por isso a contagem é feita no fetch entregue ao provedor.
 * Status 0 na lista de falhas = erro de rede (sem resposta HTTP).
 */

export type AIReplyTiming = {
  /** Da entrada na função até a resposta pronta. */
  total_ms: number;
  /** Portão, configuração, prompt, anfitrião e etiquetas (tudo que não é agenda nem modelo). */
  setup_ms: number;
  /** Leitura dos horários livres na agenda. */
  calendar_ms: number;
  /** Geração no modelo, somando a segunda geração quando houver. */
  model_ms: number;
  /** Chamadas HTTP ao provedor; acima de `generations` = o SDK tentou de novo. */
  model_http_calls: number;
  /** Status HTTP das chamadas que falharam (ex.: 529 = sobrecarga, 429 = cota); 0 = erro de rede. */
  model_http_errors: number[];
  /** 1 normalmente; 2 quando a primeira saída não veio no formato e foi gerada de novo. */
  generations: number;
  /** A primeira saída veio fora do formato e foi recortada do texto cru, sem gerar de novo. */
  repaired: boolean;
};

export function criarFetchContador(base?: typeof fetch) {
  const contagem = { chamadas: 0, falhas: [] as number[] };
  const fetchContador = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    contagem.chamadas += 1;
    try {
      const resposta = await (base ?? globalThis.fetch)(input, init);
      if (!resposta.ok) contagem.falhas.push(resposta.status);
      return resposta;
    } catch (error) {
      contagem.falhas.push(0);
      throw error;
    }
  }) as typeof fetch;
  return { fetch: fetchContador, contagem };
}

/** Resumo curto para o registro de falha, que o operador lê na tela. */
export function resumirMedicao(timing: AIReplyTiming): string {
  const falhas = timing.model_http_errors.length > 0 ? `, falhas ${timing.model_http_errors.join(',')}` : '';
  return `tempo ${(timing.total_ms / 1000).toFixed(1)}s (modelo ${(timing.model_ms / 1000).toFixed(1)}s, agenda ${(timing.calendar_ms / 1000).toFixed(1)}s), ${timing.model_http_calls} chamada(s)${falhas}`;
}

/** Lê a medição pendurada num erro lançado pela geração (ver generateConversationAutoReply). */
export function lerMedicaoDoErro(error: unknown): AIReplyTiming | null {
  if (!error || typeof error !== 'object') return null;
  const timing = (error as { aiTiming?: unknown }).aiTiming;
  return timing && typeof timing === 'object' ? (timing as AIReplyTiming) : null;
}
