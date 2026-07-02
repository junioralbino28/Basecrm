import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { buildAtendimentosCsv } from '@/lib/reports/atendimentosCsv';

// Export COMPLETO de atendimentos/pacientes (com PII) — SÓ ADMIN LOGADO
// (requireAdminTenantContext: clinic_admin/agency_admin; clinic_staff = 403).
// Nunca é servido pelo link público; é o "nível B" (baixar dentro do CRM).
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();
  const csv = await buildAtendimentosCsv(admin, auth.targetOrganizationId);

  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="pacientes-${date}.csv"`,
    },
  });
}
