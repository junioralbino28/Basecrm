/**
 * Termo de busca por nome (opcional; Central de Agentes, bloco 2: a cópia de agente precisa alcançar qualquer cliente,
 * não só os 100 mais recentes). Sem o parâmetro, a lista é a de sempre. Os curingas do ILIKE e a barra invertida saem
 * do termo, para ele valer como texto.
 */
export function termoDeBusca(bruto: string | null): string {
  const semCuringa = [...(bruto ?? '')].filter((c) => c !== '%' && c !== '_' && c !== '*' && c.charCodeAt(0) !== 92).join('');
  return semCuringa.trim().slice(0, 80);
}
