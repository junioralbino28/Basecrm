/**
 * @fileoverview Roteador de entrada por anúncio (etapa 2 da automação, 28/09).
 *
 * Decisão do Junior (27-28/09): o anúncio de origem decide em QUAL funil o lead
 * nasce e qual etiqueta de produto ele carrega — a etiqueta liga a régua
 * (gancho tag→régua). Mesmo anúncio pode alimentar dois destinos: a ENTRADA é
 * pela origem; o downsell continua sendo decidido pela conversa (gate).
 *
 * Contrato:
 * - Configuração POR CONEXÃO, para todos os clientes:
 *   channel_connections.config.leadEntryRoutes = [
 *     { "sourceId": "<id do anúncio>", "boardId": "<funil>", "tagId": "<opcional>" }
 *   ]
 * - Sem configuração, sem clique de anúncio ou sem regra casando: NADA muda
 *   (primeiro funil da organização, sem etiqueta, como sempre foi).
 * - Regra malformada é ignorada em silêncio (leitura tolerante): configuração
 *   quebrada nunca derruba a entrada de lead.
 */

export type LeadEntryRoute = {
  sourceId: string;
  boardId: string;
  tagId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lê `config.leadEntryRoutes` tolerante: só entram regras completas e válidas. */
export function readLeadEntryRoutes(config: Record<string, unknown> | null | undefined): LeadEntryRoute[] {
  const bruto = config?.leadEntryRoutes;
  if (!Array.isArray(bruto)) return [];
  const rotas: LeadEntryRoute[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== 'object') continue;
    const registro = item as Record<string, unknown>;
    const sourceId = typeof registro.sourceId === 'string' ? registro.sourceId.trim() : '';
    const boardId = typeof registro.boardId === 'string' ? registro.boardId.trim() : '';
    const tagId = typeof registro.tagId === 'string' ? registro.tagId.trim() : '';
    if (!sourceId || !UUID_RE.test(boardId)) continue;
    rotas.push({ sourceId, boardId, tagId: UUID_RE.test(tagId) ? tagId : null });
  }
  return rotas;
}

/** Casa o anúncio de origem com uma regra (id exato). Sem clique ou sem regra: null. */
export function resolveLeadEntryRoute(
  rotas: LeadEntryRoute[],
  adSourceId: string | null | undefined,
): LeadEntryRoute | null {
  const alvo = typeof adSourceId === 'string' ? adSourceId.trim() : '';
  if (!alvo) return null;
  return rotas.find((rota) => rota.sourceId === alvo) ?? null;
}
