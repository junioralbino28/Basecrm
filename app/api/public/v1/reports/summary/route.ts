import { authPublicApiFromQuery } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { buildSummaryCsv } from '@/lib/reports/summaryCsv';

// Endpoint PÚBLICO read-only: totais agregados da org pra Google Sheets =IMPORTDATA /
// Excel "Dados → Da Web". Token vai na QUERY (?token=). SÓ AGREGADOS — nunca PII.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authPublicApiFromQuery(request);
  if (!auth.ok) {
    // resposta texto simples: =IMPORTDATA mostra o erro na célula
    return new Response('token invalido ou revogado', {
      status: auth.status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const admin = createStaticAdminClient();
  const csv = await buildSummaryCsv(admin, auth.organizationId);

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
