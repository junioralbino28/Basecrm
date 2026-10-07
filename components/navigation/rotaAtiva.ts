import { LISTAS_COM_DETALHE } from '@/lib/tenancy/workspaceRoutes';

/**
 * Telas de detalhe acendem o item da lista no menu: em /platform/tenants/<id>/agents/<agentId>, o item "Agentes"
 * (/platform/tenants/<id>/agents) fica marcado. Os demais itens continuam acendendo por igualdade exata.
 * A lista é a mesma da troca de cliente (Task 8): uma tela de detalhe nova entra num lugar só.
 */
export function abreDetalheDoItem(pathname: string, href: string): boolean {
  return LISTAS_COM_DETALHE.some((lista) => href.endsWith(lista)) && pathname.startsWith(`${href}/`);
}
