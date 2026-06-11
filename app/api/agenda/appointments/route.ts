/**
 * GET /api/agenda/appointments — lista os agendamentos do período (motor Clinicorp)
 * e espelha no cache local de resiliência (dedupe por org+source+external_id).
 *
 * SEGURANÇA: server-side only. A resposta crua do Clinicorp tem PII de paciente —
 * mapeamos pro MÍNIMO (mapClinicorpAppointment) antes de devolver. Token nunca no JSON.
 */
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { listAppointments } from '@/lib/channels/clinicorp';
import { mapClinicorpAppointment } from '@/lib/channels/clinicorpMappers';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const QuerySchema = z
  .object({
    tenantId: z.string().uuid(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    tenantId: url.searchParams.get('tenantId') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
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
    const raw = await listAppointments(creds, parsed.data.from, parsed.data.to);
    const appointments = raw.map((item) => mapClinicorpAppointment(item, { organizationId: parsed.data.tenantId }));

    // Espelha no cache local de resiliência (dedupe por org+source+external_id).
    if (appointments.length) {
      const rows = appointments.map((appt) => ({
        organization_id: parsed.data.tenantId,
        external_id: appt.externalId ?? null,
        source: appt.source ?? 'clinicorp_api',
        status: appt.status,
        starts_at: appt.startsAt,
        ends_at: appt.endsAt ?? null,
        notes: appt.notes ?? null,
        updated_at: new Date().toISOString(),
      }));
      await admin
        .from('appointments')
        .upsert(rows, { onConflict: 'organization_id,source,external_id' });
    }

    return json({ appointments });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao consultar o Clinicorp.' }, 502);
  }
}
