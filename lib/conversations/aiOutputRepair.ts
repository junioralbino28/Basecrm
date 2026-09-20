/**
 * Reparo do texto cru do modelo quando a saida estruturada nao e um JSON limpo.
 *
 * Ensaio de 20/09 (2a janela): o Gemini devolveu, de vez em quando, algo que o SDK nao conseguiu
 * interpretar (`AI_NoObjectGeneratedError: could not parse the response`) e a conversa caia na fila
 * humana. Os casos classicos sao cerca de ```json, texto de raciocinio antes do objeto ou lixo depois
 * dele. O reparo e conservador: so recorta o primeiro objeto `{...}` completo; se nao houver, devolve
 * null e a geracao e tentada de novo (uma vez) antes de virar falha.
 */
export function repairStructuredOutputText(text: string | null | undefined) {
  if (typeof text !== 'string') return null;
  let candidate = text.trim();
  if (!candidate) return null;

  candidate = candidate
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  const sliced = candidate.slice(start, end + 1);
  try {
    JSON.parse(sliced);
  } catch {
    return null;
  }
  return sliced === text ? null : sliced;
}
