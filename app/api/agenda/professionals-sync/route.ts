/**
 * POST /api/agenda/professionals-sync — popula professionals.external_id com o
 * Dentist_PersonId dos dentistas do Clinicorp (mapa local ↔ motor).
 * SEGURANÇA: server-side only. Só clinic_admin/agency_admin sincroniza. Token nunca no JSON.
 */
import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { resolveClinicorpCredentials } from '@/lib/channels/clinicorpCredentials';
import { listProfessionals } from '@/lib/channels/clinicorp';
import { canManageClinicSettings } from '@/lib/auth/scope';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const Schema = z.object({ tenantId: z.string().uuid() }).strict();

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const rawBody = await req.json().catch(() => null);
  const parsed = Schema.safeParse(rawBody);
  if (!parsed.success) return json({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);

  const access = await requireTenantAccess(parsed.data.tenantId);
  if ('error' in access) return access.error;
  if (!canManageClinicSettings(access.profile.role)) {
    return json({ error: 'Apenas o admin da clínica pode sincronizar dentistas.' }, 403);
  }

  const admin = createStaticAdminClient();
  const creds = await resolveClinicorpCredentials({ admin, tenantId: parsed.data.tenantId });
  if (!creds) return json({ error: 'Integração Clinicorp não configurada para esta clínica.' }, 409);

  try {
    const raw = await listProfessionals(creds);
    const professionals = raw.map((p) => ({ externalId: String(p.id), name: p.name }));

    if (professionals.length) {
      const rows = raw.map((p) => ({
        organization_id: parsed.data.tenantId,
        name: p.name,
        external_id: String(p.id),
        updated_at: new Date().toISOString(),
      }));
      await admin
        .from('professionals')
        .upsert(rows, { onConflict: 'organization_id,external_id' });
    }

    return json({ professionals });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao sincronizar dentistas.' }, 502);
  }
}
