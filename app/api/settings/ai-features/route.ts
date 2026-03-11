import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET() {
  const supabase = await createClient();
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const { data, error } = await supabase
    .from('ai_feature_flags')
    .select('key, enabled, updated_at')
    .eq('organization_id', auth.targetOrganizationId);

  if (error) return json({ error: error.message }, 500);

  const flags: Record<string, boolean> = {};
  for (const row of data || []) flags[row.key] = Boolean(row.enabled);

  return json({
    isAdmin: auth.isAgencyAdmin || auth.isClinicAdmin,
    flags,
  });
}

const UpdateFeatureSchema = z
  .object({
    key: z.string().min(3).max(120),
    enabled: z.boolean(),
  })
  .strict();

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const rawBody = await req.json().catch(() => null);
  const parsed = UpdateFeatureSchema.safeParse(rawBody);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const { key, enabled } = parsed.data;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('ai_feature_flags')
    .upsert(
      {
        organization_id: auth.targetOrganizationId,
        key,
        enabled,
        updated_at: now,
      },
      { onConflict: 'organization_id,key' }
    );

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
