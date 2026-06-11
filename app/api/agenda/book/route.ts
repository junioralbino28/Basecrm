/**
 * POST /api/agenda/book — cria o agendamento AO VIVO no Clinicorp (motor).
 * SEGURANÇA: server-side only. Token resolvido do DB (RLS can_configure) e usado só aqui.
 * O JSON de resposta devolve só o `created` ({ Status, id }); nunca credenciais.
 */
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { createAppointment } from '@/lib/channels/clinicorp';
import { buildCreateAppointmentPayload } from '@/lib/channels/clinicorpMappers';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const BookSchema = z
  .object({
    tenantId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fromTime: z.string().regex(/^\d{1,2}:\d{2}$/),
    toTime: z.string().regex(/^\d{1,2}:\d{2}$/),
    dentistPersonId: z.number().int().positive(),
    patientPersonId: z.number().int().positive().optional(),
    patientName: z.string().min(1).optional(),
    patientMobilePhone: z.string().optional(),
    patientEmail: z.string().email().optional(),
    procedimento: z.string().min(1),
  })
  .strict();

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const rawBody = await req.json().catch(() => null);
  const parsed = BookSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);
  }

  const access = await requireTenantAccess(parsed.data.tenantId);
  if ('error' in access) return access.error;

  const admin = createStaticAdminClient();
  const creds = await resolveClinicorpCredentials({ admin, tenantId: parsed.data.tenantId });
  if (!creds) {
    return json({ error: 'Integração Clinicorp não configurada para esta clínica.' }, 409);
  }

  let payload;
  try {
    payload = buildCreateAppointmentPayload({
      slot: { date: parsed.data.date, fromTime: parsed.data.fromTime, toTime: parsed.data.toTime },
      businessId: creds.businessId,
      dentistPersonId: parsed.data.dentistPersonId,
      patient: {
        personId: parsed.data.patientPersonId,
        name: parsed.data.patientName,
        mobilePhone: parsed.data.patientMobilePhone,
        email: parsed.data.patientEmail,
      },
      procedimento: parsed.data.procedimento,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Paciente inválido.' }, 400);
  }

  try {
    const created = await createAppointment(creds, payload);
    return json({ created });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao criar agendamento no Clinicorp.' }, 502);
  }
}
