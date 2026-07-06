import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fix do achado High 4 (auditoria Codex 2026-07-03): a API pública grava FKs
 * (board_id/stage_id/contact_id/client_company_id/deal_id) vindas do body validadas
 * só como UUID, e o insert roda via service-role (bypassa RLS). Resultado: uma linha
 * na org A podia referenciar um objeto da org B (oráculo de existência + corrupção de
 * join/relatório cross-tenant).
 *
 * Este helper valida no CÓDIGO que o FK pertence à mesma org (defesa 1). A migração
 * `*_fk_cross_org_hardening_crm.sql` adiciona FKs compostas (organization_id, id) que
 * o próprio Postgres impõe — defesa 2, vale até para service-role.
 *
 * Espelha o padrão já existente em `lib/ai/tools.ts` (ensureBoardBelongsToOrganization):
 * checa apenas organization_id + id (sem deleted_at — nem toda tabela tem a coluna, e
 * referenciar um pai soft-deleted não é o risco; o risco é cross-org).
 */
export async function belongsToOrg(
  sb: SupabaseClient,
  table: string,
  id: string | null | undefined,
  organizationId: string
): Promise<boolean> {
  if (!id) return true; // campo opcional ausente = nada a validar
  const { data, error } = await sb
    .from(table)
    .select('id')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export type FkCheck = { table: string; id: string | null | undefined; field: string };

/**
 * Valida vários FKs de uma vez. Retorna o nome do PRIMEIRO campo que não pertence à
 * org (para a rota devolver 422 com a mensagem certa), ou null se todos ok.
 */
export async function firstInvalidFk(
  sb: SupabaseClient,
  organizationId: string,
  checks: FkCheck[]
): Promise<string | null> {
  for (const check of checks) {
    const ok = await belongsToOrg(sb, check.table, check.id, organizationId);
    if (!ok) return check.field;
  }
  return null;
}
