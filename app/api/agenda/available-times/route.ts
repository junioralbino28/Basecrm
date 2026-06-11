/**
 * GET /api/agenda/available-times — horários livres do dia (motor Clinicorp).
 * SEGURANÇA: server-side only. resolveClinicorpCredentials lê o token do DB (RLS
 * can_configure) e o adapter chama o Clinicorp. O token NUNCA volta no JSON.
 */
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { listAvailableTimes } from '@/lib/channels/clinicorp';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const QuerySchema = z
  .object({
    tenantId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD.'),
  })
  .strict();

export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    tenantId: url.searchParams.get('tenantId') ?? undefined,
    date: url.searchParams.get('date') ?? undefined,
  });
  if (!parsed.success) {
    return json({ error: 'Parâmetros inválidos', details: parsed.error.flatten() }, 400);
  }

  const access = await requireTenantAccess(parsed.data.tenantId);
  if ('error' in access) return access.error;

  const admin = createStaticAdminClient();
  const creds = await resolveClinicorpCredentials({ admin, tenantId: parsed.data.tenantId });
  if (!creds) {
    return json({ error: 'Integração Clinicorp não configurada para esta clínica.' }, 409);
  }

  try {
    const slots = await listAvailableTimes(creds, parsed.data.date);
    return json({ slots });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao consultar o Clinicorp.' }, 502);
  }
}
