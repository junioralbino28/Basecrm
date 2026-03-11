import { createClient } from '@/lib/supabase/server';
import { hasPermission, resolvePermissionMap, type AppPermission } from '@/lib/auth/permissions';
import { loadPermissionOverrides } from '@/lib/auth/permissions.server';
import { isAgencyAdminRole, normalizeAppUserRole, type AppUserRole } from '@/lib/auth/scope';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type TenantProfile = {
  id: string;
  email?: string | null;
  role: AppUserRole;
  organization_id: string;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
};

type TenantAccessOptions = {
  adminOnly?: boolean;
  requiredPermissions?: AppPermission[];
};

export async function requireTenantAccess(tenantId: string, options: TenantAccessOptions = {}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: json({ error: 'Unauthorized' }, 401) };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, email, role, organization_id, first_name, last_name, nickname')
    .eq('id', user.id)
    .single();

  if (error || !profile?.organization_id) return { error: json({ error: 'Profile not found' }, 404) };

  const typedProfile = {
    ...(profile as TenantProfile),
    role: normalizeAppUserRole((profile as TenantProfile).role),
  };
  const isPlatformAdmin = isAgencyAdminRole(typedProfile.role);
  const belongsToTenant = typedProfile.organization_id === tenantId;
  const permissionOverrides = await loadPermissionOverrides(typedProfile.id);
  const permissions = resolvePermissionMap(typedProfile.role, permissionOverrides);

  if (!isPlatformAdmin && !belongsToTenant) return { error: json({ error: 'Forbidden' }, 403) };
  if (options.adminOnly && !isPlatformAdmin) return { error: json({ error: 'Forbidden' }, 403) };
  if ((options.requiredPermissions || []).some((permission) => !hasPermission(typedProfile.role, permission, permissionOverrides))) {
    return { error: json({ error: 'Forbidden' }, 403) };
  }

  return {
    profile: typedProfile,
    permissions,
    permissionOverrides,
    canManageChannelConfig: permissions['whatsapp.manage_connection'],
  };
}
