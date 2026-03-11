import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { resolvePermissionMap } from '@/lib/auth/permissions';
import { loadPermissionOverrides } from '@/lib/auth/permissions.server';
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

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, role, organization_id, created_at')
    .eq('organization_id', auth.targetOrganizationId)
    .limit(200)
    .order('created_at', { ascending: false });

  if (error) return json({ error: error.message }, 500);

  const users = await Promise.all(
    (profiles || []).map(async (profile) => {
      const permissionOverrides = await loadPermissionOverrides(profile.id);

      return {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        organization_id: profile.organization_id,
        created_at: profile.created_at,
        status: 'active' as const,
        permission_overrides: permissionOverrides,
        permissions: resolvePermissionMap(profile.role, permissionOverrides),
      };
    })
  );

  return json({ users });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  return json({ error: 'Not implemented' }, 501);
}
