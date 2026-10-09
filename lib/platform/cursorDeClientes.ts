/**
 * Central de Agentes, bloco 2 (revisão do Codex no código, rodada 2, achado 3): a lista de clientes da agência vem em
 * páginas de 100, do mais novo ao mais antigo. O cursor é o par (created_at, id) do último cliente da página anterior;
 * o id desempata clientes criados no mesmo instante, que uma carga em lote produz.
 */
export const PAGINA_DE_CLIENTES = 100;

export type CursorDeClientes = { antesDe: string; antesDeId: string };

const INSTANTE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?(?:Z|[+-][0-9]{2}(?::?[0-9]{2})?)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lê o cursor da URL. `null` é a primeira página; `'invalido'` é um só dos dois parâmetros, ou um fora do formato
 * exato. Os dois valores entram no texto de um filtro do PostgREST: nada além de instante e uuid pode passar daqui.
 */
export function lerCursorDeClientes(parametros: URLSearchParams): CursorDeClientes | null | 'invalido' {
  const antesDe = parametros.get('antesDe');
  const antesDeId = parametros.get('antesDeId');
  if (antesDe === null && antesDeId === null) return null;
  if (antesDe === null || antesDeId === null) return 'invalido';
  if (!INSTANTE.test(antesDe) || !UUID.test(antesDeId)) return 'invalido';
  return { antesDe, antesDeId };
}

/** O filtro `.or()` da página seguinte. Só recebe cursor que passou por `lerCursorDeClientes`. */
export function filtroDoCursor(c: CursorDeClientes): string {
  return `created_at.lt."${c.antesDe}",and(created_at.eq."${c.antesDe}",id.lt.${c.antesDeId})`;
}
