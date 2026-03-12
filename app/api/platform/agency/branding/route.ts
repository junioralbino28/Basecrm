import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isAgencyAdminRole, normalizeAppUserRole } from '@/lib/auth/scope';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const AgencyBrandingSchema = z
  .object({
    displayName: z.string().min(2).max(120).optional(),
    logoUrl: z.string().url().nullable().optional(),
  })
  .strict();

async function requireAgencyAdminProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: json({ error: 'Unauthorized' }, 401) };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (error || !profile?.organization_id) return { error: json({ error: 'Profile not found' }, 404) };
  if (!isAgencyAdminRole(normalizeAppUserRole(profile.role))) return { error: json({ error: 'Forbidden' }, 403) };

  return { profile };
}

export async function GET() {
  const auth = await requireAgencyAdminProfile();
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();
  const { data, error } = await admin
    .from('organization_editions')
    .select('organization_id, branding_config')
    .eq('organization_id', auth.profile.organization_id)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Agency edition not found' }, 404);

  return json({ branding: data.branding_config || {} });
}

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAgencyAdminProfile();
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = AgencyBrandingSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const admin = createStaticAdminClient();
  const current = await admin
    .from('organization_editions')
    .select('branding_config')
    .eq('organization_id', auth.profile.organization_id)
    .maybeSingle();

  if (current.error) return json({ error: current.error.message }, 500);
  if (!current.data) return json({ error: 'Agency edition not found' }, 404);

  const nextBranding = {
    ...(current.data.branding_config || {}),
    ...parsed.data,
  };

  const { error } = await admin
    .from('organization_editions')
    .update({ branding_config: nextBranding, updated_at: new Date().toISOString() })
    .eq('organization_id', auth.profile.organization_id);

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, branding: nextBranding });
}

