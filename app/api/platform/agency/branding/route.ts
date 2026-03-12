import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isAgencyAdminRole, normalizeAppUserRole } from '@/lib/auth/scope';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
      expires: '0',
    },
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
  const [editionResult, orgResult] = await Promise.all([
    admin
      .from('organization_editions')
      .select('organization_id, branding_config')
      .eq('organization_id', auth.profile.organization_id)
      .maybeSingle(),
    admin
      .from('organizations')
      .select('id, name')
      .eq('id', auth.profile.organization_id)
      .maybeSingle(),
  ]);

  if (editionResult.error) return json({ error: editionResult.error.message }, 500);
  if (orgResult.error) return json({ error: orgResult.error.message }, 500);
  if (!orgResult.data) return json({ error: 'Agency organization not found' }, 404);

  const editionBranding = (editionResult.data?.branding_config || {}) as Record<string, unknown>;
  const displayNameFromEdition =
    typeof editionBranding.displayName === 'string' ? editionBranding.displayName.trim() : '';

  const branding = {
    ...editionBranding,
    displayName: displayNameFromEdition || orgResult.data.name || 'BaseCRM Agencia',
  };

  return json({ branding });
}

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAgencyAdminProfile();
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = AgencyBrandingSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const admin = createStaticAdminClient();
  const orgResult = await admin
    .from('organizations')
    .select('id, name')
    .eq('id', auth.profile.organization_id)
    .maybeSingle();

  if (orgResult.error) return json({ error: orgResult.error.message }, 500);
  if (!orgResult.data) return json({ error: 'Agency organization not found' }, 404);

  const currentEdition = await admin
    .from('organization_editions')
    .select('organization_id, branding_config')
    .eq('organization_id', auth.profile.organization_id)
    .maybeSingle();

  if (currentEdition.error) return json({ error: currentEdition.error.message }, 500);

  const normalizedDisplayName = parsed.data.displayName?.trim();
  const nextBranding = {
    ...((currentEdition.data?.branding_config || {}) as Record<string, unknown>),
    ...parsed.data,
    displayName: normalizedDisplayName || orgResult.data.name || 'BaseCRM Agencia',
  };

  const editionUpsert = await admin
    .from('organization_editions')
    .upsert(
      {
        organization_id: auth.profile.organization_id,
        edition_key: 'agency',
        branding_config: nextBranding,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' }
    );

  if (editionUpsert.error) return json({ error: editionUpsert.error.message }, 500);

  if (normalizedDisplayName && normalizedDisplayName !== orgResult.data.name) {
    const orgUpdate = await admin
      .from('organizations')
      .update({ name: normalizedDisplayName })
      .eq('id', auth.profile.organization_id);
    if (orgUpdate.error) return json({ error: orgUpdate.error.message }, 500);
  }

  const { data: reloadedEdition, error: reloadError } = await admin
    .from('organization_editions')
    .select('branding_config')
    .eq('organization_id', auth.profile.organization_id);

  if (reloadError) return json({ error: reloadError.message }, 500);

  const finalBranding = ((reloadedEdition?.[0]?.branding_config || nextBranding) as Record<string, unknown>);
  return json({ ok: true, branding: finalBranding });
}
