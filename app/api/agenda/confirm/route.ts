/**
 * POST /api/agenda/confirm — confirma o agendamento no Clinicorp (motor).
 * SEGURANÇA: server-side only. Token resolvido do DB, nunca devolvido ao client.
 */
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { confirmAppointment } from '@/lib/channels/clinicorp';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const Schema = z.object({ tenantId: z.string().uuid(), id: z.number().int().positive() }).strict();

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const rawBody = await req.json().catch(() => null);
  const parsed = Schema.safeParse(rawBody);
  if (!parsed.success) return json({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);

  const access = await requireTenantAccess(parsed.data.tenantId);
  if ('error' in access) return access.error;

  const admin = createStaticAdminClient();
  const creds = await resolveClinicorpCredentials({ admin, tenantId: parsed.data.tenantId });
  if (!creds) return json({ error: 'Integração Clinicorp não configurada para esta clínica.' }, 409);

  try {
    const result = await confirmAppointment(creds, parsed.data.id);
    return json({ ok: true, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao confirmar no Clinicorp.' }, 502);
  }
}
