import { authReportTokenFromQuery } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { buildSummaryCsv } from '@/lib/reports/summaryCsv';

// Endpoint PÚBLICO read-only: totais agregados da org pra Google Sheets =IMPORTDATA /
// Excel "Dados → Da Web". Token de PLANILHA na QUERY (?token=), validado contra o espaço
// ISOLADO report_tokens (authReportTokenFromQuery) — nunca api_keys. SÓ AGREGADOS, nunca PII.
export const dynamic = 'force-dynamic';

// Endurecimento (achado Medium 6): o token de planilha viaja na query string.
// - no-store: não guardar a resposta autenticada em cache do browser/CDN/proxy.
// - no-referrer: não vazar a URL (com token) no header Referer de recursos externos.
// - noindex: impedir indexação da URL com token caso ela vaze.
const HARDENED_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
} as const;

export async function GET(request: Request) {
  const auth = await authReportTokenFromQuery(request);
  if (!auth.ok) {
    // resposta texto simples: =IMPORTDATA mostra o erro na célula
    return new Response('token invalido ou revogado', {
      status: auth.status,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        ...HARDENED_HEADERS,
      },
    });
  }

  const admin = createStaticAdminClient();
  const csv = await buildSummaryCsv(admin, auth.organizationId);

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      ...HARDENED_HEADERS,
    },
  });
}
