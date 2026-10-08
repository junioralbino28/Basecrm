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

/**
 * A falha do gerador em texto para o registro que o operador lê e para o log, SEM conteúdo do modelo nem do lead (G22,
 * rodada 4 do Codex): nome do erro, status HTTP, motivo de parada e a FORMA da saída quando o SDK a anexa (tamanho, se
 * abre e se fecha com chave; basta para o diagnóstico de 20/09, JSON cortado). A mensagem livre do erro fica de fora:
 * a do SDK pode embutir o texto do modelo ("Text: ...", "Value: ...") e a do provedor é texto de terceiro.
 */
export function descreverFalhaDoModelo(erro: unknown): string {
  if (!erro || typeof erro !== 'object') return 'erro sem detalhes';
  const e = erro as { name?: unknown; finishReason?: unknown; text?: unknown; lastError?: unknown; cause?: unknown };
  const partes = [typeof e.name === 'string' && e.name ? e.name.slice(0, 60) : 'Error'];
  const status = [erro, e.lastError, e.cause]
    .map((x) => (x && typeof x === 'object' ? (x as { statusCode?: unknown }).statusCode : undefined))
    .find((v): v is number => typeof v === 'number');
  if (status) partes.push(`HTTP ${status}`);
  if (typeof e.finishReason === 'string') partes.push(`parada: ${e.finishReason.slice(0, 30)}`);
  if (typeof e.text === 'string') {
    const aparado = e.text.trim();
    partes.push(
      `saida: ${e.text.length} caracteres, ${aparado.startsWith('{') ? 'abre' : 'nao abre'} com chave, ${aparado.endsWith('}') ? 'fecha' : 'nao fecha'}`,
    );
  }
  return partes.join(' | ');
}

/** Lê a medição pendurada num erro lançado pela geração (ver generateConversationAutoReply). */
export function lerMedicaoDoErro(error: unknown): AIReplyTiming | null {
  if (!error || typeof error !== 'object') return null;
  const timing = (error as { aiTiming?: unknown }).aiTiming;
  return timing && typeof timing === 'object' ? (timing as AIReplyTiming) : null;
}
