import { resolvePermissionMap } from '@/lib/auth/permissions';
import { loadPermissionOverrides } from '@/lib/auth/permissions.server';
import { normalizeAppUserRole } from '@/lib/auth/scope';
import { createClient } from '@/lib/supabase/server';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single();

  if (error || !profile) return json({ error: 'Profile not found' }, 404);

  const role = normalizeAppUserRole(profile.role);
  const permissionOverrides = await loadPermissionOverrides(user.id);

  return json({
    role,
    permissions: resolvePermissionMap(role, permissionOverrides),
  });
}
